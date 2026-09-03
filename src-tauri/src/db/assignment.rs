// Port of the `db:evaluateEventType`, `db:setEventTypeManually` and
// `db:reprocessEventTypes` IPC handlers from `electron/main.js`
// (`git show ca805d0:electron/main.js`, lines 625-704), plus
// `reset_event_type_to_auto`, which has no original: it is the inverse of
// `set_event_type_manually` that nothing in the Electron app ever provided,
// added here because its absence is exactly why `EventModal.tsx`'s
// "Reset to auto-assignment" button silently did nothing (see
// `reset_event_type_to_auto`'s doc comment below).
//
// This is the first module in the crate that calls `rules::evaluate` from a
// real command path; `rules.rs` itself only ever called it from its own
// tests.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::error::DbResult;
use super::event_types;
use super::rules::{self, EventFields};

/// What a caller supplies to `evaluate_event_type`: the same four fields
/// `rules::EventFields` carries, but this one derives `Deserialize` so it can
/// arrive straight off an IPC call — `EventFields` itself is Task 2's and is
/// not touched here.
#[derive(Debug, Deserialize)]
pub struct EventFieldsInput {
    pub title: String,
    pub is_all_day: bool,
    pub show_as: String,
    pub categories: String,
}

impl From<EventFieldsInput> for EventFields {
    fn from(input: EventFieldsInput) -> Self {
        EventFields {
            title: input.title,
            is_all_day: input.is_all_day,
            show_as: input.show_as,
            categories: input.categories,
        }
    }
}

/// `main.js:630`'s `SELECT id FROM event_types WHERE is_default = 1 LIMIT 1`.
/// Not reused from `event_types.rs`: that module only exposes lookups that
/// return a full `EventType`, and every caller here wants just the id.
fn get_default_type_id(conn: &Connection) -> DbResult<Option<i64>> {
    conn.query_row("SELECT id FROM event_types WHERE is_default = 1 LIMIT 1", [], |row| row.get(0))
        .optional()
        .map_err(Into::into)
}

/// Port of `db:evaluateEventType` (`main.js:626`). Fetches the rules ordered
/// by priority and the default type, then delegates the actual matching to
/// `rules::evaluate` — this function does no evaluation of its own.
pub fn evaluate_event_type(conn: &Connection, fields: &EventFields) -> DbResult<Option<i64>> {
    let rules = event_types::get_event_type_rules(conn)?;
    let default_type_id = get_default_type_id(conn)?;
    Ok(rules::evaluate(&rules, fields, default_type_id))
}

/// Port of `db:setEventTypeManually` (`main.js:646`). Foreign keys are
/// enforced (see the module-level note in `event_types.rs`), so a `type_id`
/// that doesn't exist in `event_types` now makes this call fail with a
/// `DbError::Sqlite` rather than silently writing a dangling reference the
/// way better-sqlite3 would have.
pub fn set_event_type_manually(conn: &Connection, event_id: i64, type_id: i64) -> DbResult<bool> {
    let changed = conn.execute(
        "UPDATE events SET type_id = ?1, type_manually_set = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![type_id, event_id],
    )?;
    Ok(changed > 0)
}

/// Re-evaluates the rules for one event and clears its manual override, so
/// the event returns to being auto-assigned. The inverse of
/// `set_event_type_manually`.
///
/// Deliberately a command rather than something the frontend composes from
/// `update_event`: `update_event` does not write `type_id` or
/// `type_manually_set` (see `events.rs`'s `EventUpdate`), which is exactly
/// why the old "Reset to auto-assignment" button (`EventModal.tsx:90`)
/// silently did nothing beyond a success toast — `main.js:318`'s
/// `updateEvent` only ever touched eight other columns.
///
/// Runs as one transaction: load the event's fields, load the rules and
/// default type, evaluate, then write both `type_id` and
/// `type_manually_set = 0` together, so a crash between "compute the new
/// type" and "clear the override" can never happen.
pub fn reset_event_type_to_auto(conn: &Connection, event_id: i64) -> DbResult<Option<i64>> {
    let tx = conn.unchecked_transaction()?;

    let row: Option<(String, bool, String, String)> = tx
        .query_row(
            "SELECT title, is_all_day, show_as, categories FROM events WHERE id = ?1",
            params![event_id],
            |row| Ok((row.get("title")?, row.get("is_all_day")?, row.get("show_as")?, row.get("categories")?)),
        )
        .optional()?;

    let Some((title, is_all_day, show_as, categories)) = row else {
        return Ok(None);
    };

    let rules = event_types::get_event_type_rules(&tx)?;
    let default_type_id = get_default_type_id(&tx)?;
    let fields = EventFields { title, is_all_day, show_as, categories };
    let new_type_id = rules::evaluate(&rules, &fields, default_type_id);

    tx.execute(
        "UPDATE events SET type_id = ?1, type_manually_set = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![new_type_id, event_id],
    )?;

    tx.commit()?;
    Ok(new_type_id)
}

/// What `reprocess_event_types` returns. `success`/`message` are always
/// present, matching the original's shape in both branches; `processed_count`
/// / `updated_count` / `error` are each present in exactly one branch, the
/// same way the JS object literals differed field-for-field between the
/// `try` and `catch` arms of `main.js:656`. `src/types/index.ts:131` declares
/// this counterpart with the two counts as optional camelCase fields, hence
/// the rename (unlike the domain models in `models.rs`, which stay
/// `snake_case` on purpose).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReprocessEventTypesResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processed_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_count: Option<i64>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

struct ReprocessRow {
    id: i64,
    title: String,
    is_all_day: bool,
    show_as: String,
    categories: String,
    type_id: Option<i64>,
}

/// Does the actual work; kept separate from `reprocess_event_types` so the
/// `?`-propagation stays readable and the public function's job is purely
/// "turn a `DbResult` into the two possible response shapes," matching how
/// the original's `try`/`catch` split success construction from error
/// construction.
fn reprocess_event_types_inner(conn: &Connection) -> DbResult<(i64, i64)> {
    let tx = conn.unchecked_transaction()?;

    // Pre-fetch rules and the default type once, before the loop — not per
    // event. `main.js:665-667` did the same; re-querying per event would be
    // thousands of redundant queries against the user's 8,924-event database.
    let rules = event_types::get_event_type_rules(&tx)?;
    let default_type_id = get_default_type_id(&tx)?;

    // A manual override is never overwritten: only events where
    // `type_manually_set` is `0` or `NULL` are even candidates, exactly
    // `main.js:660`'s `WHERE type_manually_set = 0 OR type_manually_set IS NULL`.
    let rows: Vec<ReprocessRow> = {
        let mut stmt = tx.prepare(
            "SELECT id, title, is_all_day, show_as, categories, type_id FROM events \
             WHERE type_manually_set = 0 OR type_manually_set IS NULL",
        )?;
        let mapped = stmt
            .query_map([], |row| {
                Ok(ReprocessRow {
                    id: row.get("id")?,
                    title: row.get("title")?,
                    is_all_day: row.get("is_all_day")?,
                    show_as: row.get("show_as")?,
                    categories: row.get("categories")?,
                    type_id: row.get("type_id")?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        mapped
    };

    let mut processed_count: i64 = 0;
    let mut updated_count: i64 = 0;

    for row in rows {
        let fields = EventFields {
            title: row.title,
            is_all_day: row.is_all_day,
            show_as: row.show_as,
            categories: row.categories,
        };
        let new_type_id = rules::evaluate(&rules, &fields, default_type_id);
        processed_count += 1;

        // Only update when the type actually changed — main.js:684's
        // `if (newTypeId !== event.type_id)`.
        if new_type_id != row.type_id {
            tx.execute(
                "UPDATE events SET type_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                params![new_type_id, row.id],
            )?;
            updated_count += 1;
        }
    }

    tx.commit()?;
    Ok((processed_count, updated_count))
}

/// Port of `db:reprocessEventTypes` (`main.js:656`). Unlike the other three
/// commands in this file, a database error here does not propagate as
/// `Err` — the original wrapped the whole thing in `try`/`catch` and
/// resolved with `{ success: false, error, message }` rather than rejecting
/// the promise, and `DataManagement.tsx` still expects that shape.
pub fn reprocess_event_types(conn: &Connection) -> ReprocessEventTypesResult {
    match reprocess_event_types_inner(conn) {
        Ok((processed_count, updated_count)) => ReprocessEventTypesResult {
            success: true,
            processed_count: Some(processed_count),
            updated_count: Some(updated_count),
            message: format!("Processed {processed_count} events, updated {updated_count} event types"),
            error: None,
        },
        Err(e) => ReprocessEventTypesResult {
            success: false,
            processed_count: None,
            updated_count: None,
            message: "Failed to reprocess event types".to_string(),
            error: Some(e.to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::event_types::{NewEventType, NewEventTypeRule};
    use crate::db::schema::run_migrations;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    fn create_type(conn: &Connection, name: &str, is_default: bool) -> i64 {
        event_types::create_event_type(
            conn,
            &NewEventType { name: name.to_string(), color: "#123456".to_string(), is_default, is_billable: false },
        )
        .unwrap()
        .id
        .unwrap()
    }

    fn create_rule(conn: &Connection, field_name: &str, operator: &str, value: Option<&str>, target_type_id: i64, priority: i64) {
        event_types::create_event_type_rule(
            conn,
            &NewEventTypeRule {
                name: "test rule".to_string(),
                priority,
                field_name: field_name.to_string(),
                operator: operator.to_string(),
                value: value.map(str::to_string),
                target_type_id,
            },
        )
        .unwrap();
    }

    /// Inserts a bare event row with full control over the fields that
    /// matter to rule evaluation and to the manual-override guard, bypassing
    /// `events::create_event` the same way `event_types.rs`'s tests do.
    fn insert_event(conn: &Connection, title: &str, type_id: Option<i64>, type_manually_set: bool) -> i64 {
        conn.execute(
            "INSERT INTO events (title, start_date, is_all_day, show_as, categories, type_id, type_manually_set) \
             VALUES (?1, '2026-01-01T09:00:00', 0, 'busy', '', ?2, ?3)",
            params![title, type_id, type_manually_set],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn event_type_and_manual(conn: &Connection, event_id: i64) -> (Option<i64>, bool) {
        conn.query_row(
            "SELECT type_id, type_manually_set FROM events WHERE id = ?1",
            params![event_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    }

    // --- evaluate_event_type ---

    /// Enumerated case: `evaluate_event_type` returns the default when no
    /// rule matches. This exercises the command-level wiring (fetching rules
    /// + default type from the database) — the matching logic itself is
    /// `rules::evaluate`'s job and is covered by its own 16 tests.
    #[test]
    fn evaluate_event_type_returns_the_default_when_no_rule_matches() {
        let conn = setup();
        let default_type = create_type(&conn, "Default", true);
        let other_type = create_type(&conn, "Consulting", false);
        create_rule(&conn, "title", "equals", Some("Retro"), other_type, 1);

        let fields =
            EventFields { title: "Standup".to_string(), is_all_day: false, show_as: "busy".to_string(), categories: String::new() };

        let result = evaluate_event_type(&conn, &fields).unwrap();

        assert_eq!(result, Some(default_type));
    }

    // --- set_event_type_manually ---

    /// Enumerated case: `set_event_type_manually` sets the flag.
    #[test]
    fn set_event_type_manually_sets_type_id_and_the_manual_flag() {
        let conn = setup();
        let type_a = create_type(&conn, "A", true);
        let type_b = create_type(&conn, "B", false);
        let event_id = insert_event(&conn, "Standup", Some(type_a), false);

        let changed = set_event_type_manually(&conn, event_id, type_b).unwrap();

        assert!(changed);
        let (type_id, manual) = event_type_and_manual(&conn, event_id);
        assert_eq!(type_id, Some(type_b));
        assert!(manual);
    }

    /// Global constraint, pinned as a test: foreign keys are enforced, so a
    /// `type_id` that doesn't exist in `event_types` makes this call fail
    /// rather than silently writing a dangling reference the way
    /// better-sqlite3 (no FK enforcement by default) would have.
    #[test]
    fn set_event_type_manually_errors_for_a_nonexistent_type_id() {
        let conn = setup();
        create_type(&conn, "Default", true);
        let event_id = insert_event(&conn, "Standup", None, false);

        let result = set_event_type_manually(&conn, event_id, 9999);

        assert!(result.is_err(), "a bogus type_id must be rejected by the events.type_id foreign key");
    }

    // --- reset_event_type_to_auto ---

    /// Enumerated case: it writes the type the rules select, and returns
    /// that type id.
    #[test]
    fn reset_event_type_to_auto_writes_and_returns_the_rule_selected_type() {
        let conn = setup();
        create_type(&conn, "Default", true);
        let consulting = create_type(&conn, "Consulting", false);
        create_rule(&conn, "title", "contains", Some("consult"), consulting, 1);
        let event_id = insert_event(&conn, "Consulting call", None, false);

        let result = reset_event_type_to_auto(&conn, event_id).unwrap();

        assert_eq!(result, Some(consulting));
        let (type_id, _) = event_type_and_manual(&conn, event_id);
        assert_eq!(type_id, Some(consulting));
    }

    /// Enumerated case: it clears `type_manually_set`.
    #[test]
    fn reset_event_type_to_auto_clears_the_manual_flag() {
        let conn = setup();
        let default_type = create_type(&conn, "Default", true);
        let event_id = insert_event(&conn, "Standup", Some(default_type), true);

        reset_event_type_to_auto(&conn, event_id).unwrap();

        let (_, manual) = event_type_and_manual(&conn, event_id);
        assert!(!manual, "type_manually_set must be cleared by reset_event_type_to_auto");
    }

    /// Enumerated case: it returns `None` for a missing event id.
    #[test]
    fn reset_event_type_to_auto_returns_none_for_a_missing_event() {
        let conn = setup();
        create_type(&conn, "Default", true);

        let result = reset_event_type_to_auto(&conn, 9999).unwrap();

        assert_eq!(result, None);
    }

    /// The regression guard this command exists for: an event manually set
    /// to type A, whose rules now select type B, ends up with type B *and*
    /// `type_manually_set = 0` — proving this is a genuine re-evaluation and
    /// override-clear, not a no-op.
    #[test]
    fn reset_event_type_to_auto_replaces_a_manual_type_with_the_rules_selected_type() {
        let conn = setup();
        create_type(&conn, "Default", true);
        let type_a = create_type(&conn, "Type A", false);
        let type_b = create_type(&conn, "Type B", false);
        create_rule(&conn, "title", "contains", Some("consult"), type_b, 1);
        // Manually set to A, even though the title matches the rule for B.
        let event_id = insert_event(&conn, "Consulting call", Some(type_a), true);

        let result = reset_event_type_to_auto(&conn, event_id).unwrap();

        assert_eq!(result, Some(type_b));
        let (type_id, manual) = event_type_and_manual(&conn, event_id);
        assert_eq!(type_id, Some(type_b));
        assert!(!manual);
    }

    // --- reprocess_event_types ---

    /// Enumerated case, and the guard most worth preserving in this whole
    /// task: reprocess leaves a manually-set event's type alone, even though
    /// its title matches a rule that would send it elsewhere. A test that
    /// would fail if the `type_manually_set = 0 OR ... IS NULL` clause were
    /// ever dropped from the SELECT.
    #[test]
    fn reprocess_event_types_leaves_a_manually_set_events_type_alone() {
        let conn = setup();
        create_type(&conn, "Default", true);
        let type_a = create_type(&conn, "Type A", false);
        let type_b = create_type(&conn, "Type B", false);
        create_rule(&conn, "title", "contains", Some("consult"), type_b, 1);
        let event_id = insert_event(&conn, "Consulting call", Some(type_a), true);

        let result = reprocess_event_types(&conn);

        assert!(result.success);
        assert_eq!(result.updated_count, Some(0), "a manually-set event must not be touched at all");
        let (type_id, manual) = event_type_and_manual(&conn, event_id);
        assert_eq!(type_id, Some(type_a), "the manual override must never be overwritten by reprocessing");
        assert!(manual);
    }

    /// Enumerated case: reprocess updates an event whose rule now points
    /// elsewhere.
    #[test]
    fn reprocess_event_types_updates_an_event_whose_rule_now_points_elsewhere() {
        let conn = setup();
        create_type(&conn, "Default", true);
        let stale_type = create_type(&conn, "Stale", false);
        let correct_type = create_type(&conn, "Correct", false);
        create_rule(&conn, "title", "contains", Some("consult"), correct_type, 1);
        // Not manually set, and currently pointing at the wrong type — as if
        // the rule was added or edited after this event was first assigned.
        let event_id = insert_event(&conn, "Consulting call", Some(stale_type), false);

        let result = reprocess_event_types(&conn);

        assert!(result.success);
        assert_eq!(result.updated_count, Some(1));
        let (type_id, _) = event_type_and_manual(&conn, event_id);
        assert_eq!(type_id, Some(correct_type));
    }

    /// Enumerated case: `updatedCount` counts only actual changes, so a
    /// no-op run (every non-manual event already has the type its rules
    /// would assign) reports `processedCount > 0` and `updatedCount == 0`.
    #[test]
    fn reprocess_event_types_reports_zero_updates_when_nothing_changes() {
        let conn = setup();
        let default_type = create_type(&conn, "Default", true);
        // No rules at all: every non-manual event should already resolve to
        // the default type, so nothing should need updating.
        insert_event(&conn, "Standup", Some(default_type), false);
        insert_event(&conn, "Retro", Some(default_type), false);

        let result = reprocess_event_types(&conn);

        assert!(result.success);
        assert_eq!(result.processed_count, Some(2), "both non-manual events must have been examined");
        assert_eq!(result.updated_count, Some(0), "neither event's type actually changed");
    }
}
