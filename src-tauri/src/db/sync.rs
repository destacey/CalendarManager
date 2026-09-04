// Port of the `db:syncGraphEvents` IPC handler from `electron/main.js`
// (`git show ca805d0:electron/main.js`, lines 344-467; deleted in this
// branch, recovered via `git show`), plus a replacement for the
// `cleanupEventsInDateRange` half of `src/services/calendar.ts:555-586`.
//
// This module owns two things a sync page needs after Task 2's `transform`
// has already turned a `GraphEvent` into `LocalEventFields`:
//   - `upsert_page`: write a page of events, applying the type-evaluation
//     rules from `rules::evaluate` (Task 2) without reimplementing them.
//   - `cleanup_range`: delete local events that fell out of the current
//     sync's window, replacing the original's full-table-read-plus-N-IPC-
//     calls with one statement.
//
// Neither function talks to Microsoft Graph or knows about pagination — both
// are Task 4's job, wiring this into the HTTP pipeline.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension, ToSql};

use super::error::DbResult;
use super::event_types;
use super::rules::{self, EventFields};
use crate::graph::transform::LocalEventFields;

/// How many events (or ids) a single SQL statement in this module ever binds
/// at once. SQLite's bound-parameter limit is 32,766 in modern builds; a
/// single sync page is 500 events, but the *accumulated* graph-id keep-list
/// `cleanup_range` is handed can be far larger across a wide date range —
/// see `stage_keep_ids`'s doc comment for why that list is staged in chunks
/// rather than bound in one INSERT.
const CHUNK_SIZE: usize = 500;

/// What `upsert_page` did to a page of events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpsertCounts {
    pub created: u32,
    pub updated: u32,
}

/// `main.js:366`'s `SELECT id FROM event_types WHERE is_default = 1 LIMIT 1`.
/// Duplicated from `assignment.rs`'s private helper of the same shape rather
/// than reused: pulling it into a shared location for two call sites isn't
/// worth a public API surface neither module otherwise needs.
fn get_default_type_id(conn: &Connection) -> DbResult<Option<i64>> {
    conn.query_row("SELECT id FROM event_types WHERE is_default = 1 LIMIT 1", [], |row| row.get(0))
        .optional()
        .map_err(Into::into)
}

/// Every `event_types.id` that currently exists, fetched once per
/// `upsert_page` call alongside the rules and default type. Foreign keys are
/// enforced in this build (`events.type_id REFERENCES event_types(id)`), and
/// `rules::evaluate` can return a rule's `target_type_id` verbatim — if that
/// id no longer exists (see `resolve_type_id`'s doc comment), binding it into
/// the INSERT/UPDATE would fail the constraint and, unhandled, the whole
/// page's transaction with it.
fn get_existing_type_ids(conn: &Connection) -> DbResult<HashSet<i64>> {
    let mut stmt = conn.prepare("SELECT id FROM event_types")?;
    let ids = stmt.query_map([], |row| row.get::<_, i64>(0))?.collect::<Result<HashSet<_>, _>>()?;
    Ok(ids)
}

/// Resolves what `rules::evaluate` returned into an id that is safe to bind
/// into `events.type_id`.
///
/// `None` passes through unchanged: it's `rules::evaluate`'s own considered
/// answer (a matching rule with no target, or no match and no default type
/// configured), and FK-legal as NULL — not this function's business to
/// second-guess.
///
/// `Some(id)` is only ever a problem if `id` is no longer a real row in
/// `event_types`. Under normal operation this can't happen — the type/rule
/// tables are themselves FK-linked, and `event_types::delete_event_type`
/// clears out referencing rules before deleting a type. It's reachable
/// nonetheless: a stale rule row written before FK enforcement existed, or a
/// direct edit to the database file. Rather than let one dangling reference
/// fail the INSERT/UPDATE and abort every other event on the page, this
/// falls back to the pre-fetched default type — the same type an unmatched
/// event would have gotten anyway. Losing one event's specific type
/// assignment is far better than losing an entire page's sync.
fn resolve_type_id(evaluated: Option<i64>, default_type_id: Option<i64>, existing_type_ids: &HashSet<i64>) -> Option<i64> {
    match evaluated {
        None => None,
        Some(id) if existing_type_ids.contains(&id) => Some(id),
        Some(_stale_id) => default_type_id,
    }
}

fn event_fields(event: &LocalEventFields) -> EventFields {
    EventFields {
        title: event.title.clone(),
        is_all_day: event.is_all_day,
        show_as: event.show_as.clone(),
        categories: event.categories.clone(),
    }
}

/// Upserts one page of transformed Graph events, in a single transaction.
///
/// Ported from `main.js:344-467`. Per event, looked up by `graph_id`
/// (`main.js:390`'s `checkExistingStmt`):
///   - **Exists, `type_manually_set` true** (`main.js:404-418`): every column
///     updates except `type_id` — a user's manual type choice is never
///     overwritten by a sync. This is the single most important branch in
///     the file; see `upsert_updates_existing_manually_typed_event_and_keeps_its_type_id`
///     below for the regression guard.
///   - **Exists, override not set** (`main.js:419-434`): the type is
///     re-evaluated via `rules::evaluate` and updated along with everything
///     else.
///   - **Does not exist** (`main.js:436-455`): inserted with the evaluated
///     type and `type_manually_set = 0`.
///
/// Rules and the default type are fetched once before the loop
/// (`main.js:366-368`), not per event — a page is 500 events and the user's
/// database holds 8,924, so re-querying per event would be thousands of
/// redundant round-trips. One consequence, spelled out rather than silently
/// relied on: a change to the rules or the default type made *during* this
/// call is not picked up by later events in the same page — only by the
/// next call. See `upsert_page_uses_the_rule_set_captured_before_the_loop_for_the_whole_page`
/// below, which proves this with a trigger that mutates a rule mid-page.
pub fn upsert_page(conn: &Connection, events: &[LocalEventFields]) -> DbResult<UpsertCounts> {
    let tx = conn.unchecked_transaction()?;

    let rules = event_types::get_event_type_rules(&tx)?;
    let default_type_id = get_default_type_id(&tx)?;
    let existing_type_ids = get_existing_type_ids(&tx)?;

    let mut created = 0u32;
    let mut updated = 0u32;

    for event in events {
        let existing: Option<(i64, bool)> = tx
            .query_row(
                "SELECT id, type_manually_set FROM events WHERE graph_id = ?1",
                params![event.graph_id],
                |row| {
                    let manual: Option<bool> = row.get("type_manually_set")?;
                    Ok((row.get("id")?, manual.unwrap_or(false)))
                },
            )
            .optional()?;

        match existing {
            Some((id, true)) => {
                // Manual override: every column except type_id.
                tx.execute(
                    "UPDATE events SET \
                       title = ?1, description = ?2, start_date = ?3, end_date = ?4, \
                       is_all_day = ?5, show_as = ?6, categories = ?7, location = ?8, \
                       organizer = ?9, attendees = ?10, is_meeting = ?11, \
                       synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP \
                     WHERE id = ?12",
                    params![
                        event.title,
                        event.description,
                        event.start_date,
                        event.end_date,
                        event.is_all_day,
                        event.show_as,
                        event.categories,
                        event.location,
                        event.organizer,
                        event.attendees,
                        event.is_meeting,
                        id,
                    ],
                )?;
                updated += 1;
            }
            Some((id, false)) => {
                let evaluated = rules::evaluate(&rules, &event_fields(event), default_type_id);
                let type_id = resolve_type_id(evaluated, default_type_id, &existing_type_ids);
                tx.execute(
                    "UPDATE events SET \
                       title = ?1, description = ?2, start_date = ?3, end_date = ?4, \
                       is_all_day = ?5, show_as = ?6, categories = ?7, location = ?8, \
                       organizer = ?9, attendees = ?10, is_meeting = ?11, type_id = ?12, \
                       synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP \
                     WHERE id = ?13",
                    params![
                        event.title,
                        event.description,
                        event.start_date,
                        event.end_date,
                        event.is_all_day,
                        event.show_as,
                        event.categories,
                        event.location,
                        event.organizer,
                        event.attendees,
                        event.is_meeting,
                        type_id,
                        id,
                    ],
                )?;
                updated += 1;
            }
            None => {
                let evaluated = rules::evaluate(&rules, &event_fields(event), default_type_id);
                let type_id = resolve_type_id(evaluated, default_type_id, &existing_type_ids);
                tx.execute(
                    "INSERT INTO events \
                       (graph_id, title, description, start_date, end_date, is_all_day, show_as, \
                        categories, location, organizer, attendees, is_meeting, type_id, \
                        type_manually_set, synced_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 0, CURRENT_TIMESTAMP)",
                    params![
                        event.graph_id,
                        event.title,
                        event.description,
                        event.start_date,
                        event.end_date,
                        event.is_all_day,
                        event.show_as,
                        event.categories,
                        event.location,
                        event.organizer,
                        event.attendees,
                        event.is_meeting,
                        type_id,
                    ],
                )?;
                created += 1;
            }
        }
    }

    tx.commit()?;
    Ok(UpsertCounts { created, updated })
}

/// Stages `keep_graph_ids` into a temp table, chunked so no single INSERT
/// binds more than `CHUNK_SIZE` parameters.
///
/// This is the chunking half of the parameter-limit fix, and it is safe to
/// chunk precisely because it's positive membership (INSERT these rows),
/// not exclusion: splitting a `NOT IN (...)` list across several statements
/// would be wrong (a row present in chunk 2's keep-list would still get
/// deleted by a `DELETE ... WHERE graph_id NOT IN (chunk 1)` that only knows
/// about chunk 1), but splitting the *inserts that build* one shared table
/// has no such hazard — every id ends up in the same table regardless of
/// which chunk carried it in, and `cleanup_range`'s single `NOT IN (SELECT
/// ... FROM temp table)` subquery is evaluated only once, against the whole,
/// fully-populated table.
fn stage_keep_ids(tx: &Connection, keep_graph_ids: &[String]) -> DbResult<()> {
    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS cleanup_keep_graph_ids (graph_id TEXT PRIMARY KEY); \
         DELETE FROM cleanup_keep_graph_ids;",
    )?;

    for chunk in keep_graph_ids.chunks(CHUNK_SIZE) {
        if chunk.is_empty() {
            continue;
        }
        let placeholders =
            (1..=chunk.len()).map(|i| format!("(?{i})")).collect::<Vec<_>>().join(", ");
        let sql = format!("INSERT OR IGNORE INTO cleanup_keep_graph_ids (graph_id) VALUES {placeholders}");
        let bound: Vec<&dyn ToSql> = chunk.iter().map(|id| id as &dyn ToSql).collect();
        tx.execute(&sql, bound.as_slice())?;
    }

    Ok(())
}

/// Deletes local events that fell out of the current sync's window,
/// replacing `calendar.ts:555-586`'s `cleanupEventsInDateRange`.
///
/// The original fetched *every* local event, filtered it in JavaScript with
/// `isBetween(rangeStart, rangeEnd, null, '[]')` (inclusive both ends) and
/// `event.graph_id && !graphIds.has(event.graph_id)`, then issued one
/// `deleteEvent` IPC call — its own transaction — per row to delete. Against
/// 8,924 events that's a full table read plus N round-trips. This is one
/// statement instead:
///
/// ```sql
/// DELETE FROM events
/// WHERE graph_id IS NOT NULL
///   AND start_date >= ?1 AND start_date <= ?2
///   AND graph_id NOT IN (SELECT graph_id FROM cleanup_keep_graph_ids)
/// ```
///
/// `>=`/`<=` match the original's inclusive-both-ends `isBetween`, not the
/// exclusive `>`/`<`. `graph_id IS NOT NULL` preserves the original's
/// `event.graph_id &&` guard: a locally-created event has no `graph_id` and
/// must survive a sync regardless of the date range.
///
/// `keep_graph_ids` (the ids the current Graph fetch actually returned) is
/// staged into a temp table via `stage_keep_ids` rather than bound directly
/// into a `NOT IN (?1, ?2, ...)` list: SQLite's bound-parameter limit is
/// 32,766 in modern builds, and while one page's 500 ids is comfortably
/// under that, the list this function is handed accumulates across an
/// entire wide sync and can exceed it. Staging avoids the limit entirely —
/// the DELETE itself only ever binds the two date parameters, no matter how
/// long the keep-list is.
pub fn cleanup_range(conn: &Connection, start: &str, end: &str, keep_graph_ids: &[String]) -> DbResult<u32> {
    let tx = conn.unchecked_transaction()?;

    stage_keep_ids(&tx, keep_graph_ids)?;

    let deleted = tx.execute(
        "DELETE FROM events \
         WHERE graph_id IS NOT NULL \
           AND start_date >= ?1 AND start_date <= ?2 \
           AND graph_id NOT IN (SELECT graph_id FROM cleanup_keep_graph_ids)",
        params![start, end],
    )?;

    tx.execute("DROP TABLE cleanup_keep_graph_ids", [])?;

    tx.commit()?;
    Ok(deleted as u32)
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

    fn create_rule(conn: &Connection, name: &str, field_name: &str, operator: &str, value: Option<&str>, target_type_id: i64, priority: i64) {
        event_types::create_event_type_rule(
            conn,
            &NewEventTypeRule {
                name: name.to_string(),
                priority,
                field_name: field_name.to_string(),
                operator: operator.to_string(),
                value: value.map(str::to_string),
                target_type_id,
            },
        )
        .unwrap();
    }

    fn fields(graph_id: &str, title: &str) -> LocalEventFields {
        LocalEventFields {
            graph_id: graph_id.to_string(),
            title: title.to_string(),
            description: String::new(),
            start_date: "2026-03-01T09:00:00".to_string(),
            end_date: "2026-03-01T09:30:00".to_string(),
            is_all_day: false,
            show_as: "busy".to_string(),
            categories: String::new(),
            location: String::new(),
            organizer: String::new(),
            attendees: String::new(),
            is_meeting: false,
        }
    }

    fn event_row(conn: &Connection, graph_id: &str) -> (i64, String, Option<i64>, bool) {
        conn.query_row(
            "SELECT id, title, type_id, type_manually_set FROM events WHERE graph_id = ?1",
            params![graph_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap()
    }

    // --- upsert_page: new event ---

    /// Enumerated case: a new event is inserted with the evaluated type and
    /// `type_manually_set = 0`.
    #[test]
    fn upsert_inserts_a_new_event_with_evaluated_type_and_manual_flag_clear() {
        let conn = setup();
        create_type(&conn, "Default", true);
        let consulting = create_type(&conn, "Consulting", false);
        create_rule(&conn, "Consulting keyword", "title", "contains", Some("consult"), consulting, 1);

        let page = vec![fields("g1", "Consulting call")];
        let counts = upsert_page(&conn, &page).unwrap();

        assert_eq!(counts, UpsertCounts { created: 1, updated: 0 });
        let (_, title, type_id, manual) = event_row(&conn, "g1");
        assert_eq!(title, "Consulting call");
        assert_eq!(type_id, Some(consulting));
        assert!(!manual);
    }

    // --- upsert_page: existing event, no override ---

    /// Enumerated case: an existing event (override not set) is updated, and
    /// `created`/`updated` counts are right.
    #[test]
    fn upsert_updates_an_existing_non_manual_event_and_counts_are_right() {
        let conn = setup();
        let default_type = create_type(&conn, "Default", true);
        let page1 = vec![fields("g1", "Original title")];
        upsert_page(&conn, &page1).unwrap();

        let page2 = vec![fields("g1", "Renamed title")];
        let counts = upsert_page(&conn, &page2).unwrap();

        assert_eq!(counts, UpsertCounts { created: 0, updated: 1 });
        let (_, title, type_id, manual) = event_row(&conn, "g1");
        assert_eq!(title, "Renamed title");
        assert_eq!(type_id, Some(default_type));
        assert!(!manual);
    }

    /// A page mixing a brand-new event and an update to an existing one
    /// reports both counts correctly in the same call.
    #[test]
    fn upsert_reports_mixed_created_and_updated_counts_in_one_page() {
        let conn = setup();
        create_type(&conn, "Default", true);
        upsert_page(&conn, &[fields("existing", "First sync")]).unwrap();

        let page = vec![fields("existing", "Updated"), fields("brand-new", "New event")];
        let counts = upsert_page(&conn, &page).unwrap();

        assert_eq!(counts, UpsertCounts { created: 1, updated: 1 });
    }

    // --- upsert_page: the manual-override guard ---

    /// The regression guard the brief calls "the single most important line
    /// in the file": an existing event with `type_manually_set = 1` keeps
    /// its `type_id` while every other column (here, `title`) still
    /// updates. The event's manual type is deliberately set to something the
    /// rules would *not* choose — a "Personal" event manually typed as
    /// "Consulting" even though a rule would route it to "Personal" — so
    /// that if the `type_manually_set` branch were ever removed, this test
    /// would visibly fail (the type would flip to "Personal").
    #[test]
    fn upsert_updates_existing_manually_typed_event_but_keeps_its_type_id() {
        let conn = setup();
        create_type(&conn, "Default", true);
        let consulting = create_type(&conn, "Consulting", false);
        let personal = create_type(&conn, "Personal", false);
        create_rule(&conn, "Personal keyword", "title", "contains", Some("personal"), personal, 1);

        // First sync: title doesn't match the rule, so it lands on Default.
        upsert_page(&conn, &[fields("g1", "Untitled Event")]).unwrap();
        let (id, _, _, _) = event_row(&conn, "g1");
        conn.execute(
            "UPDATE events SET type_id = ?1, type_manually_set = 1 WHERE id = ?2",
            params![consulting, id],
        )
        .unwrap();

        // Second sync: Graph now sends a title that *would* match the
        // Personal rule if evaluated. type_id must not move.
        let counts = upsert_page(&conn, &[fields("g1", "My personal errand")]).unwrap();

        assert_eq!(counts, UpsertCounts { created: 0, updated: 1 });
        let (_, title, type_id, manual) = event_row(&conn, "g1");
        assert_eq!(title, "My personal errand", "non-type columns must still update");
        assert_eq!(type_id, Some(consulting), "a manual override must never be overwritten by a sync");
        assert!(manual, "the manual flag itself must remain set");
    }

    // --- upsert_page: pre-fetch semantics ---

    /// Documents (and proves, via a trigger that mutates a rule's target
    /// mid-page) the consequence of pre-fetching rules once before the loop
    /// rather than per event: a rule change that happens *during* a single
    /// `upsert_page` call is not picked up by later events in that same
    /// page. The trigger fires only on the first event's insert (matched by
    /// its exact title) and repoints the rule the second event would
    /// otherwise match onto a different type — proving the second event
    /// still resolves against the snapshot captured before the loop started,
    /// not the mutated table.
    #[test]
    fn upsert_page_uses_the_rule_set_captured_before_the_loop_for_the_whole_page() {
        let conn = setup();
        create_type(&conn, "Default", true);
        let type_a = create_type(&conn, "Type A", false);
        let type_b = create_type(&conn, "Type B", false);
        create_rule(&conn, "Trigger Rule", "title", "equals", Some("Trigger Event 2"), type_a, 1);

        // `type_b` is looked up by name inside the trigger body rather than
        // interpolated as a literal: SQLite's CREATE TRIGGER has no bind
        // parameters, but a subquery keeps this test scaffold free of the
        // same string-building it would otherwise be pinning a guard against.
        conn.execute_batch(
            "CREATE TEMP TRIGGER mutate_rule_after_first_insert AFTER INSERT ON events \
             WHEN NEW.title = 'Trigger Event 1' \
             BEGIN \
               UPDATE event_type_rules \
               SET target_type_id = (SELECT id FROM event_types WHERE name = 'Type B') \
               WHERE name = 'Trigger Rule'; \
             END;",
        )
        .unwrap();

        let page = vec![fields("g1", "Trigger Event 1"), fields("g2", "Trigger Event 2")];
        upsert_page(&conn, &page).unwrap();

        // The rule row itself really was mutated by the trigger...
        let live_target: Option<i64> = conn
            .query_row("SELECT target_type_id FROM event_type_rules WHERE name = 'Trigger Rule'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(live_target, Some(type_b), "sanity check: the trigger must have actually mutated the rule");

        // ...but the second event in the page still got Type A, the target
        // captured in the pre-fetched snapshot, not Type B.
        let (_, _, type_id, _) = event_row(&conn, "g2");
        assert_eq!(type_id, Some(type_a), "a mid-page rule mutation must not affect events later in the same page");
    }

    // --- upsert_page: the deleted-type fallback ---

    /// A rule whose `target_type_id` points at a type that no longer exists
    /// (reachable only by bypassing FK enforcement, as here, or from data
    /// written before it existed) must not fail the INSERT and take the
    /// whole page down. The chosen behaviour: fall back to the default
    /// type, and every other event on the page still gets processed.
    #[test]
    fn upsert_falls_back_to_the_default_type_when_a_rule_targets_a_deleted_type() {
        let conn = setup();
        let default_type = create_type(&conn, "Default", true);
        let doomed = create_type(&conn, "Doomed", false);
        create_rule(&conn, "Doomed keyword", "title", "contains", Some("doomed"), doomed, 1);

        // Delete the type out from under the rule, bypassing the FK that
        // would normally prevent this (event_types::delete_event_type
        // handles it safely; this simulates data that predates that
        // enforcement, or a direct edit to the database file).
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        conn.execute("DELETE FROM event_types WHERE id = ?1", params![doomed]).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

        let page = vec![fields("g1", "A doomed meeting"), fields("g2", "An unrelated meeting")];
        let counts = upsert_page(&conn, &page).unwrap();

        assert_eq!(counts, UpsertCounts { created: 2, updated: 0 }, "the whole page must still succeed");
        let (_, _, type_id_1, _) = event_row(&conn, "g1");
        assert_eq!(type_id_1, Some(default_type), "the dangling target must fall back to the default type");
        let (_, _, type_id_2, _) = event_row(&conn, "g2");
        assert_eq!(type_id_2, Some(default_type), "the unrelated event is unaffected and still gets the default");
    }

    // --- cleanup_range ---

    const RANGE_START: &str = "2026-03-01T00:00:00";
    const RANGE_END: &str = "2026-03-31T23:59:59";

    fn insert_raw_event(conn: &Connection, graph_id: Option<&str>, start_date: &str) {
        conn.execute(
            "INSERT INTO events (graph_id, title, start_date) VALUES (?1, 'x', ?2)",
            params![graph_id, start_date],
        )
        .unwrap();
    }

    fn graph_ids_remaining(conn: &Connection) -> Vec<Option<String>> {
        let mut stmt = conn.prepare("SELECT graph_id FROM events ORDER BY id").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().collect::<Result<Vec<_>, _>>().unwrap()
    }

    /// Enumerated case: deletes an in-range event absent from the keep-list.
    #[test]
    fn cleanup_deletes_an_in_range_event_absent_from_keep_list() {
        let conn = setup();
        insert_raw_event(&conn, Some("gone"), "2026-03-15T00:00:00");

        let deleted = cleanup_range(&conn, RANGE_START, RANGE_END, &[]).unwrap();

        assert_eq!(deleted, 1);
        assert!(graph_ids_remaining(&conn).is_empty());
    }

    /// Enumerated case: does not delete an in-range event that is in the
    /// keep-list.
    #[test]
    fn cleanup_does_not_delete_an_in_range_event_in_the_keep_list() {
        let conn = setup();
        insert_raw_event(&conn, Some("kept"), "2026-03-15T00:00:00");

        let deleted = cleanup_range(&conn, RANGE_START, RANGE_END, &["kept".to_string()]).unwrap();

        assert_eq!(deleted, 0);
        assert_eq!(graph_ids_remaining(&conn), vec![Some("kept".to_string())]);
    }

    /// Enumerated case: does not delete an out-of-range event even when it
    /// is absent from the keep-list.
    #[test]
    fn cleanup_does_not_delete_an_out_of_range_event() {
        let conn = setup();
        insert_raw_event(&conn, Some("outside"), "2026-04-15T00:00:00");

        let deleted = cleanup_range(&conn, RANGE_START, RANGE_END, &[]).unwrap();

        assert_eq!(deleted, 0);
        assert_eq!(graph_ids_remaining(&conn), vec![Some("outside".to_string())]);
    }

    /// Enumerated case: does not delete a local-only event with
    /// `graph_id IS NULL`, regardless of the date range or keep-list.
    #[test]
    fn cleanup_does_not_delete_a_local_only_event_with_null_graph_id() {
        let conn = setup();
        insert_raw_event(&conn, None, "2026-03-15T00:00:00");

        let deleted = cleanup_range(&conn, RANGE_START, RANGE_END, &[]).unwrap();

        assert_eq!(deleted, 0);
        assert_eq!(graph_ids_remaining(&conn), vec![None]);
    }

    /// Enumerated case: an empty keep-list deletes everything in range that
    /// has a `graph_id`.
    #[test]
    fn cleanup_with_empty_keep_list_deletes_everything_in_range_with_a_graph_id() {
        let conn = setup();
        insert_raw_event(&conn, Some("a"), "2026-03-05T00:00:00");
        insert_raw_event(&conn, Some("b"), "2026-03-20T00:00:00");
        insert_raw_event(&conn, None, "2026-03-10T00:00:00");

        let deleted = cleanup_range(&conn, RANGE_START, RANGE_END, &[]).unwrap();

        assert_eq!(deleted, 2);
        assert_eq!(graph_ids_remaining(&conn), vec![None]);
    }

    /// Boundary case for the original's `isBetween(..., '[]')`: both range
    /// endpoints are inclusive, so an event starting exactly at the range
    /// start or exactly at the range end is still in range and still
    /// eligible for deletion.
    #[test]
    fn cleanup_range_bounds_are_inclusive_at_both_ends() {
        let conn = setup();
        insert_raw_event(&conn, Some("at-start"), RANGE_START);
        insert_raw_event(&conn, Some("at-end"), RANGE_END);

        let deleted = cleanup_range(&conn, RANGE_START, RANGE_END, &[]).unwrap();

        assert_eq!(deleted, 2);
        assert!(graph_ids_remaining(&conn).is_empty());
    }

    /// The naive-chunking hazard, forced: the keep-list is large enough
    /// (1,200 ids at `CHUNK_SIZE == 500`) to span three staging chunks, and
    /// the one real event's `graph_id` is deliberately placed in the *last*
    /// chunk. A naive per-chunk `NOT IN` (ANDing or OR-ing partial
    /// exclusions across separate DELETE statements) would only "see" one
    /// chunk at a time and could wrongly delete a row that is actually kept
    /// by a different chunk. Staging every chunk into one shared table
    /// before a single DELETE avoids that: the row must survive regardless
    /// of which chunk carried its id in.
    #[test]
    fn cleanup_keep_list_spanning_multiple_chunks_still_protects_an_id_in_the_last_chunk() {
        let conn = setup();
        insert_raw_event(&conn, Some("real-event"), "2026-03-15T00:00:00");

        let mut keep_ids: Vec<String> = (0..1200).map(|i| format!("filler-{i}")).collect();
        keep_ids.push("real-event".to_string()); // lands in the third chunk

        let deleted = cleanup_range(&conn, RANGE_START, RANGE_END, &keep_ids).unwrap();

        assert_eq!(deleted, 0);
        assert_eq!(graph_ids_remaining(&conn), vec![Some("real-event".to_string())]);
    }

    /// Every other `cleanup_range` test above uses bounds like
    /// `"2026-03-01T00:00:00"` and rows like `"2026-03-15T00:00:00"` — a
    /// shape that never occurs at runtime. Real bounds come from
    /// `graph::date_range::sync_window`'s `to_rfc3339()` output (an offset
    /// suffix, milliseconds on the end bound); real rows hold Microsoft
    /// Graph's raw `dateTime` verbatim (seven fractional digits, no offset
    /// at all). This is the most dangerous statement in the sync engine —
    /// the DELETE that runs against the user's real database — so it gets a
    /// test using the formats it will actually see, with the window itself
    /// produced by `sync_window` rather than hardcoded so this test breaks
    /// if that format ever changes.
    #[test]
    fn cleanup_range_handles_the_real_graph_and_sync_window_date_formats() {
        let conn = setup();
        let window =
            crate::graph::date_range::sync_window("2026-03-01", "2026-03-31", "Europe/London")
                .unwrap();

        // Mid-window, absent from the keep-list: deleted.
        insert_raw_event(&conn, Some("deleted"), "2026-03-15T09:00:00.0000000");
        // The same shape, present in the keep-list: survives.
        insert_raw_event(&conn, Some("kept"), "2026-03-15T09:00:00.0000000");
        // Just past the `.999` upper bound: under-deletion is the safe
        // direction, so this must NOT be deleted.
        insert_raw_event(&conn, Some("just-past-end"), "2026-03-31T23:59:59.9999999");
        // Outside the window entirely.
        insert_raw_event(&conn, Some("outside"), "2026-04-15T09:00:00.0000000");
        // Local-only event inside the window: survives regardless of the
        // keep-list or date range.
        insert_raw_event(&conn, None, "2026-03-15T09:00:00.0000000");

        let deleted =
            cleanup_range(&conn, &window.start, &window.end, &["kept".to_string()]).unwrap();

        assert_eq!(deleted, 1, "only the mid-window event absent from the keep-list is deleted");
        let remaining = graph_ids_remaining(&conn);
        assert!(!remaining.contains(&Some("deleted".to_string())));
        assert!(remaining.contains(&Some("kept".to_string())));
        assert!(remaining.contains(&Some("just-past-end".to_string())));
        assert!(remaining.contains(&Some("outside".to_string())));
        assert!(remaining.contains(&None));
    }

    /// `cleanup_range` is called repeatedly against the same long-lived
    /// connection over an app's lifetime (once per sync). The temp table it
    /// stages ids into must not leak state between calls.
    #[test]
    fn cleanup_range_can_be_called_repeatedly_on_the_same_connection() {
        let conn = setup();
        insert_raw_event(&conn, Some("first-call-victim"), "2026-03-05T00:00:00");
        insert_raw_event(&conn, Some("second-call-victim"), "2026-03-20T00:00:00");

        let first = cleanup_range(&conn, RANGE_START, RANGE_END, &["second-call-victim".to_string()]).unwrap();
        assert_eq!(first, 1);

        let second = cleanup_range(&conn, RANGE_START, RANGE_END, &[]).unwrap();
        assert_eq!(second, 1);

        assert!(graph_ids_remaining(&conn).is_empty());
    }
}
