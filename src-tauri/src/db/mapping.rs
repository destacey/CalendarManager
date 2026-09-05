// Applying mapping rules to events, and grouping the ones still unmapped.
//
// The queue the user works through groups events by name + categories, so a
// month of recurring standups is one decision rather than twenty-three.

use std::collections::BTreeMap;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::error::DbResult;
use super::mapping_rules::{first_match, list_mapping_rules, EventFields};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MappingRunResult {
    /// Events the rules were offered.
    pub evaluated: usize,
    /// Events whose project or activity changed as a result.
    pub mapped: usize,
    /// Events skipped because they were mapped by hand.
    pub skipped_manual: usize,
}

/// One row in the unmapped queue: every event sharing a title and category set.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmappedGroup {
    /// Stable identity for the group, so the UI can key and select on it.
    pub key: String,
    pub title: String,
    /// As stored - a comma-separated string, or empty.
    pub categories: String,
    pub type_name: Option<String>,
    pub event_count: usize,
    /// Summed for timed events only. All-day events contribute nothing here
    /// because how many hours an all-day event is worth is a configurable
    /// question this code deliberately does not answer - see `all_day_count`.
    pub timed_minutes: i64,
    pub all_day_count: usize,
    /// Every event in the group, so a drop can map them in one statement.
    pub event_ids: Vec<i64>,
}

/// Loads the fields the rules test, for events that rules may still change.
fn events_open_to_rules(conn: &Connection) -> DbResult<Vec<(i64, EventFields)>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, categories, type_id
         FROM events
         WHERE COALESCE(mapping_manually_set, 0) = 0",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            EventFields {
                title: row.get(1)?,
                categories: row.get(2)?,
                type_id: row.get(3)?,
            },
        ))
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Re-runs every rule over every event that was not mapped by hand.
///
/// An event whose rule no longer matches has its mapping cleared rather than
/// left stale - otherwise editing a rule would silently strand events on a
/// project they no longer belong to.
pub fn apply_rules(conn: &Connection) -> DbResult<MappingRunResult> {
    let rules = list_mapping_rules(conn)?;
    let candidates = events_open_to_rules(conn)?;

    let skipped_manual: i64 = conn.query_row(
        "SELECT COUNT(*) FROM events WHERE COALESCE(mapping_manually_set, 0) = 1",
        [],
        |row| row.get(0),
    )?;

    let tx = conn.unchecked_transaction()?;
    let mut mapped = 0usize;

    for (id, fields) in &candidates {
        let (project_id, activity_id) = match first_match(&rules, fields) {
            Some(rule) => (Some(rule.project_id), rule.activity_id),
            None => (None, None),
        };

        let changed = tx.execute(
            "UPDATE events SET project_id = ?1, activity_id = ?2
             WHERE id = ?3
               AND (project_id IS NOT ?1 OR activity_id IS NOT ?2)",
            params![project_id, activity_id, id],
        )?;
        if changed > 0 && project_id.is_some() {
            mapped += 1;
        }
    }

    tx.commit()?;

    Ok(MappingRunResult {
        evaluated: candidates.len(),
        mapped,
        skipped_manual: skipped_manual as usize,
    })
}

/// Maps events by hand and marks them so no rule will move them again.
pub fn map_events(
    conn: &Connection,
    event_ids: &[i64],
    project_id: i64,
    activity_id: Option<i64>,
) -> DbResult<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut changed = 0usize;

    for id in event_ids {
        changed += tx.execute(
            "UPDATE events SET project_id = ?1, activity_id = ?2, mapping_manually_set = 1
             WHERE id = ?3",
            params![project_id, activity_id, id],
        )?;
    }

    tx.commit()?;
    Ok(changed)
}

/// Clears a hand-made mapping and hands the events back to the rules.
pub fn unmap_events(conn: &Connection, event_ids: &[i64]) -> DbResult<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut changed = 0usize;

    for id in event_ids {
        changed += tx.execute(
            "UPDATE events SET project_id = NULL, activity_id = NULL, mapping_manually_set = 0
             WHERE id = ?1",
            params![id],
        )?;
    }

    tx.commit()?;
    Ok(changed)
}

/// The queue: unmapped events in a date range, grouped by title + categories.
///
/// `billable_only` defaults the queue to the event types that actually need a
/// project. Info and Personal events are not work to be booked anywhere, and
/// leaving them in makes the user dismiss them one by one forever.
pub fn unmapped_groups(
    conn: &Connection,
    start: &str,
    end: &str,
    billable_only: bool,
) -> DbResult<Vec<UnmappedGroup>> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.title, COALESCE(e.categories, ''), e.start_date, e.end_date,
                COALESCE(e.is_all_day, 0), t.name
         FROM events e
         LEFT JOIN event_types t ON t.id = e.type_id
         WHERE e.project_id IS NULL
           AND e.start_date >= ?1 AND e.start_date <= ?2
           AND (?3 = 0 OR COALESCE(t.is_billable, 0) = 1)
         ORDER BY e.start_date",
    )?;

    let rows = stmt.query_map(params![start, end, billable_only as i64], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, bool>(5)?,
            row.get::<_, Option<String>>(6)?,
        ))
    })?;

    // BTreeMap so the grouping is deterministic without a later sort.
    let mut groups: BTreeMap<String, UnmappedGroup> = BTreeMap::new();

    for row in rows {
        let (id, title, categories, start_date, end_date, is_all_day, type_name) = row?;

        // Title and categories together, lowercased, so "Daily Standup" and
        // "daily standup" are one decision.
        let key = format!("{}|{}", title.to_lowercase(), normalise_categories(&categories));

        let entry = groups.entry(key.clone()).or_insert_with(|| UnmappedGroup {
            key,
            title: title.clone(),
            categories: categories.clone(),
            type_name: type_name.clone(),
            event_count: 0,
            timed_minutes: 0,
            all_day_count: 0,
            event_ids: Vec::new(),
        });

        entry.event_count += 1;
        entry.event_ids.push(id);
        if is_all_day {
            entry.all_day_count += 1;
        } else {
            entry.timed_minutes += minutes_between(&start_date, end_date.as_deref());
        }
    }

    let mut out: Vec<UnmappedGroup> = groups.into_values().collect();
    // Biggest first: the group worth deciding about is the one covering the
    // most events.
    out.sort_by(|a, b| b.event_count.cmp(&a.event_count).then(a.title.cmp(&b.title)));
    Ok(out)
}

/// Sorted and lowercased so "Scrum,Support" and "support, scrum" group together.
fn normalise_categories(categories: &str) -> String {
    let mut parts: Vec<String> = categories
        .split(',')
        .map(|c| c.trim().to_lowercase())
        .filter(|c| !c.is_empty())
        .collect();
    parts.sort();
    parts.join(",")
}

/// Naive difference in minutes. Both ends are stored as ISO strings in the
/// same zone, so this needs no timezone handling - and a malformed or absent
/// end simply contributes nothing rather than failing the whole query.
fn minutes_between(start: &str, end: Option<&str>) -> i64 {
    let Some(end) = end else { return 0 };
    let parse = |s: &str| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").ok();
    match (parse(start), parse(end)) {
        (Some(a), Some(b)) => (b - a).num_minutes().max(0),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::mapping_rules::{create_mapping_rule, MappingRuleInput};
    use crate::db::schema::run_migrations;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, code) VALUES (1, 'Rebuild', 'PRJ-001')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO activities (id, name, color) VALUES (500, 'Custom Activity', '#1890ff')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO event_types (id, name, is_billable) VALUES (10, 'Work', 1), (11, 'Info', 0)",
            [],
        )
        .unwrap();
        conn
    }

    fn add_event(conn: &Connection, id: i64, title: &str, cats: &str, type_id: i64, start: &str, end: &str) {
        conn.execute(
            "INSERT INTO events (id, title, categories, type_id, start_date, end_date, is_all_day)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
            params![id, title, cats, type_id, start, end],
        )
        .unwrap();
    }

    fn name_rule(value: &str, activity_id: Option<i64>) -> MappingRuleInput {
        MappingRuleInput {
            name_operator: Some("is".into()),
            name_value: Some(value.into()),
            category_value: None,
            type_id: None,
            project_id: 1,
            activity_id,
            is_active: true,
        }
    }

    fn mapping_of(conn: &Connection, id: i64) -> (Option<i64>, Option<i64>) {
        conn.query_row(
            "SELECT project_id, activity_id FROM events WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    }

    #[test]
    fn apply_rules_maps_matching_events_and_leaves_others_alone() {
        let conn = setup();
        add_event(&conn, 1, "Standup", "", 10, "2026-10-01T09:00:00", "2026-10-01T09:15:00");
        add_event(&conn, 2, "Something else", "", 10, "2026-10-01T10:00:00", "2026-10-01T11:00:00");
        create_mapping_rule(&conn, &name_rule("Standup", Some(500))).unwrap();

        let result = apply_rules(&conn).unwrap();

        assert_eq!(result.evaluated, 2);
        assert_eq!(result.mapped, 1);
        assert_eq!(mapping_of(&conn, 1), (Some(1), Some(500)));
        assert_eq!(mapping_of(&conn, 2), (None, None));
    }

    /// The promise the UI makes: a hand-mapped event is never moved by a rule.
    #[test]
    fn apply_rules_never_touches_a_hand_mapped_event() {
        let conn = setup();
        add_event(&conn, 1, "Standup", "", 10, "2026-10-01T09:00:00", "2026-10-01T09:15:00");
        map_events(&conn, &[1], 1, None).unwrap();
        create_mapping_rule(&conn, &name_rule("Standup", Some(500))).unwrap();

        let result = apply_rules(&conn).unwrap();

        assert_eq!(result.evaluated, 0, "a manual event is not even a candidate");
        assert_eq!(result.skipped_manual, 1);
        assert_eq!(mapping_of(&conn, 1), (Some(1), None), "the hand-picked 'no activity' survives");
    }

    /// Editing a rule so it no longer matches must not strand the event on a
    /// project it no longer belongs to.
    #[test]
    fn apply_rules_clears_a_mapping_whose_rule_stopped_matching() {
        let conn = setup();
        add_event(&conn, 1, "Standup", "", 10, "2026-10-01T09:00:00", "2026-10-01T09:15:00");
        let rule = create_mapping_rule(&conn, &name_rule("Standup", Some(500))).unwrap();
        apply_rules(&conn).unwrap();
        assert_eq!(mapping_of(&conn, 1), (Some(1), Some(500)));

        crate::db::mapping_rules::delete_mapping_rule(&conn, rule.id.unwrap()).unwrap();
        apply_rules(&conn).unwrap();

        assert_eq!(mapping_of(&conn, 1), (None, None));
    }

    #[test]
    fn map_events_marks_them_manual_so_they_stick() {
        let conn = setup();
        add_event(&conn, 1, "A", "", 10, "2026-10-01T09:00:00", "2026-10-01T10:00:00");
        add_event(&conn, 2, "B", "", 10, "2026-10-01T09:00:00", "2026-10-01T10:00:00");

        let n = map_events(&conn, &[1, 2], 1, Some(500)).unwrap();

        assert_eq!(n, 2);
        let manual: i64 = conn
            .query_row("SELECT COUNT(*) FROM events WHERE mapping_manually_set = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(manual, 2);
    }

    #[test]
    fn unmap_hands_the_events_back_to_the_rules() {
        let conn = setup();
        add_event(&conn, 1, "Standup", "", 10, "2026-10-01T09:00:00", "2026-10-01T09:15:00");
        map_events(&conn, &[1], 1, None).unwrap();
        create_mapping_rule(&conn, &name_rule("Standup", Some(500))).unwrap();

        unmap_events(&conn, &[1]).unwrap();
        apply_rules(&conn).unwrap();

        assert_eq!(mapping_of(&conn, 1), (Some(1), Some(500)), "the rule takes over again");
    }

    // --- grouping ---

    #[test]
    fn unmapped_groups_collapse_recurrences_into_one_row() {
        let conn = setup();
        add_event(&conn, 1, "Daily Standup", "Scrum", 10, "2026-10-01T09:00:00", "2026-10-01T09:15:00");
        add_event(&conn, 2, "Daily Standup", "Scrum", 10, "2026-10-02T09:00:00", "2026-10-02T09:15:00");
        add_event(&conn, 3, "Daily Standup", "Scrum", 10, "2026-10-05T09:00:00", "2026-10-05T09:15:00");

        let groups = unmapped_groups(&conn, "2026-10-01", "2026-10-31", false).unwrap();

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].event_count, 3);
        assert_eq!(groups[0].timed_minutes, 45);
        assert_eq!(groups[0].event_ids.len(), 3);
    }

    #[test]
    fn a_different_category_set_is_a_different_group() {
        let conn = setup();
        add_event(&conn, 1, "Review", "Design", 10, "2026-10-01T09:00:00", "2026-10-01T10:00:00");
        add_event(&conn, 2, "Review", "Release", 10, "2026-10-02T09:00:00", "2026-10-02T10:00:00");

        let groups = unmapped_groups(&conn, "2026-10-01", "2026-10-31", false).unwrap();

        assert_eq!(groups.len(), 2, "same name, different categories - different decisions");
    }

    /// Graph does not promise category order, so the same two categories in a
    /// different order must not split one group in two.
    #[test]
    fn category_order_and_case_do_not_split_a_group() {
        let conn = setup();
        add_event(&conn, 1, "Review", "Scrum,Support", 10, "2026-10-01T09:00:00", "2026-10-01T10:00:00");
        add_event(&conn, 2, "review", "support, scrum", 10, "2026-10-02T09:00:00", "2026-10-02T10:00:00");

        let groups = unmapped_groups(&conn, "2026-10-01", "2026-10-31", false).unwrap();

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].event_count, 2);
    }

    #[test]
    fn an_already_mapped_event_is_not_in_the_queue() {
        let conn = setup();
        add_event(&conn, 1, "Standup", "", 10, "2026-10-01T09:00:00", "2026-10-01T09:15:00");
        add_event(&conn, 2, "Standup", "", 10, "2026-10-02T09:00:00", "2026-10-02T09:15:00");
        map_events(&conn, &[1], 1, None).unwrap();

        let groups = unmapped_groups(&conn, "2026-10-01", "2026-10-31", false).unwrap();

        assert_eq!(groups[0].event_count, 1, "only the unmapped one is left to decide");
    }

    /// The filter that removes Info and Personal noise without a single rule.
    #[test]
    fn billable_only_hides_non_billable_types() {
        let conn = setup();
        add_event(&conn, 1, "Work thing", "", 10, "2026-10-01T09:00:00", "2026-10-01T10:00:00");
        add_event(&conn, 2, "Info thing", "", 11, "2026-10-01T11:00:00", "2026-10-01T12:00:00");

        let filtered = unmapped_groups(&conn, "2026-10-01", "2026-10-31", true).unwrap();
        let all = unmapped_groups(&conn, "2026-10-01", "2026-10-31", false).unwrap();

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].title, "Work thing");
        assert_eq!(all.len(), 2, "the filter is a default, not a restriction");
    }

    #[test]
    fn groups_outside_the_date_range_are_excluded() {
        let conn = setup();
        add_event(&conn, 1, "In range", "", 10, "2026-10-15T09:00:00", "2026-10-15T10:00:00");
        add_event(&conn, 2, "Out of range", "", 10, "2026-11-15T09:00:00", "2026-11-15T10:00:00");

        let groups = unmapped_groups(&conn, "2026-10-01", "2026-10-31", false).unwrap();

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].title, "In range");
    }

    #[test]
    fn the_biggest_group_comes_first() {
        let conn = setup();
        add_event(&conn, 1, "Rare", "", 10, "2026-10-01T09:00:00", "2026-10-01T10:00:00");
        for id in 2..=4 {
            add_event(&conn, id, "Common", "", 10, "2026-10-02T09:00:00", "2026-10-02T10:00:00");
        }

        let groups = unmapped_groups(&conn, "2026-10-01", "2026-10-31", false).unwrap();

        assert_eq!(groups[0].title, "Common", "the decision covering most events comes first");
    }

    /// All-day events are counted but contribute no minutes: how many hours
    /// one is worth is a separate, configurable question.
    #[test]
    fn all_day_events_are_counted_separately_from_timed_minutes() {
        let conn = setup();
        conn.execute(
            "INSERT INTO events (id, title, categories, type_id, start_date, end_date, is_all_day)
             VALUES (1, 'PTO', '', 10, '2026-10-05T00:00:00', '2026-10-10T00:00:00', 1)",
            [],
        )
        .unwrap();

        let groups = unmapped_groups(&conn, "2026-10-01", "2026-10-31", false).unwrap();

        assert_eq!(groups[0].all_day_count, 1);
        assert_eq!(groups[0].timed_minutes, 0, "not 120 hours, and not a guess either");
    }
}
