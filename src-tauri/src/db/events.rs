// Port of the `db:getEvents`, `db:getEventsInRange`, `db:createEvent`,
// `db:updateEvent` and `db:deleteEvent` IPC handlers from `electron/main.js`
// (`git show ca805d0:electron/main.js`, lines 259-343). `syncGraphEvents`
// (line 344) is deliberately not here — it belongs to the sync milestone's
// Rust pipeline, not this task's seven commands.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

use super::error::{DbError, DbResult};
use super::models::Event;

/// Every column `Event::from_row` expects, named explicitly rather than
/// `SELECT *`: the real 30MB database's on-disk column order is unverified
/// (see `schema.rs`'s `LEGACY_SCHEMA_FOR_TESTS` comment), so this must never
/// become positional.
///
/// `is_all_day`, `show_as` and `categories` are wrapped in `COALESCE`: none
/// of the three is `NOT NULL` in `schema.rs` (`categories` has no column
/// default at all), but `Event` declares them as non-`Option` `bool`/
/// `String`. `row.get::<_, T>` on a NULL returns `InvalidColumnType`, and
/// because `from_row` runs inside `query_map(...).collect::<Result<Vec<_>,
/// _>>()`, a single NULL row would fail the *entire* query rather than just
/// that row — the calendar goes dark for one bad row among thousands. The
/// `COALESCE` defaults match the schema's own column defaults (`is_all_day`
/// -> 0, `show_as` -> 'busy') or the empty string electron/main.js's
/// `categories.join(',')` would have produced for no categories.
const EVENT_COLUMNS: &str = "id, graph_id, title, description, start_date, end_date, \
     COALESCE(is_all_day, 0) AS is_all_day, COALESCE(show_as, 'busy') AS show_as, \
     COALESCE(categories, '') AS categories, location, organizer, attendees, is_meeting, \
     type_id, type_manually_set, project_id, activity_id, \n     COALESCE(mapping_manually_set, 0) AS mapping_manually_set, \n     created_at, updated_at, synced_at";

/// The same shape as `EVENT_COLUMNS`, but `description` comes back as NULL
/// instead of being read from the row.
///
/// `description` holds the event body, and Outlook sends full HTML. On a real
/// database it averages ~2.2KB per event and totals 8.2MB across 3,685 events
/// — yet nothing in the frontend reads it. A grep across every `.ts` and
/// `.tsx` finds no reader: not the calendar, not the table, not even
/// `EventModal`. So every bulk read was serialising 8.2MB in Rust, pushing it
/// over IPC, JSON-parsing it, and holding it in React state for no one —
/// roughly 90% of the payload, and the direct cause of a multi-second stall
/// after a large sync.
///
/// It is selected as `NULL AS description` rather than dropped from the list so
/// `Event`'s shape does not change: the struct and the TypeScript `Event`
/// interface both still carry the field, and the column is still written by
/// `create_event`, `update_event` and the sync upsert. Only bulk *reads* skip
/// it — `get_event_by_id` still returns the real value. If a feature ever needs
/// to display the body, fetch it for the single event being shown rather than
/// adding it back here.
const EVENT_LIST_COLUMNS: &str = "id, graph_id, title, NULL AS description, start_date, end_date, \
     COALESCE(is_all_day, 0) AS is_all_day, COALESCE(show_as, 'busy') AS show_as, \
     COALESCE(categories, '') AS categories, location, organizer, attendees, is_meeting, \
     type_id, type_manually_set, project_id, activity_id, \n     COALESCE(mapping_manually_set, 0) AS mapping_manually_set, \n     created_at, updated_at, synced_at";

/// The subset of `Event` a caller supplies to create one. No `id` (assigned
/// by SQLite), and no `location`/`organizer`/`attendees`/`is_meeting`/
/// `type_id`/`type_manually_set` — `db:createEvent` never wrote those either;
/// they arrive later from Graph sync or manual type assignment.
#[derive(Debug, Deserialize)]
pub struct NewEvent {
    pub graph_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub is_all_day: bool,
    pub show_as: String,
    pub categories: String,
}

/// The subset of `Event` `db:updateEvent` touched: title, description, the
/// two dates, is_all_day, show_as and categories. Deliberately excludes
/// `graph_id`, `type_id`, `type_manually_set`, `location`, `organizer`,
/// `attendees` and `is_meeting` — silently clobbering `type_manually_set`
/// would destroy a user's manual event-type override, which Microsoft Graph
/// cannot recreate.
#[derive(Debug, Deserialize)]
pub struct EventUpdate {
    pub title: String,
    pub description: Option<String>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub is_all_day: bool,
    pub show_as: String,
    pub categories: String,
}

pub fn get_events(conn: &Connection) -> DbResult<Vec<Event>> {
    let sql = format!("SELECT {EVENT_LIST_COLUMNS} FROM events ORDER BY start_date");
    let mut stmt = conn.prepare(&sql)?;
    let events = stmt.query_map([], Event::from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(events)
}

/// Ported verbatim from `main.js:272`, not improved. The three OR'd
/// conditions compare ISO date *strings* lexicographically rather than as
/// parsed instants:
///   1. the event starts within the range,
///   2. the event ends within the range,
///   3. the event spans the whole range (starts at/before it, ends at/after it).
/// That's fragile if Microsoft Graph ever returns mixed UTC-offset formats
/// (`+00:00` sorts differently from `Z` for the same instant), but the spec
/// decided a faithful port here so a later behaviour change can't be mistaken
/// for a Tauri regression. It's recorded as a follow-up, not fixed in this
/// task. A NULL `end_date` only ever affects conditions 2 and 3 (both of
/// which reference `end_date`); condition 1 never touches it, so an
/// open-ended event is still found whenever its `start_date` alone falls
/// inside the range.
pub fn get_events_in_range(conn: &Connection, start_date: &str, end_date: &str) -> DbResult<Vec<Event>> {
    let sql = format!(
        "SELECT {EVENT_LIST_COLUMNS} FROM events \
         WHERE ( \
           (start_date >= ?1 AND start_date <= ?2) OR \
           (end_date >= ?3 AND end_date <= ?4) OR \
           (start_date <= ?5 AND end_date >= ?6) \
         ) \
         ORDER BY start_date"
    );
    let mut stmt = conn.prepare(&sql)?;
    let events = stmt
        .query_map(
            params![start_date, end_date, start_date, end_date, start_date, end_date],
            Event::from_row,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(events)
}

/// Reads the row straight back rather than echoing the input plus a
/// generated id (as `main.js`'s object-spread did): this is a strongly typed
/// `Event`, so "the written row" means the row SQLite actually has, defaults
/// (`created_at`, `is_meeting`, ...) included.
fn get_event_by_id(conn: &Connection, id: i64) -> DbResult<Option<Event>> {
    let sql = format!("SELECT {EVENT_COLUMNS} FROM events WHERE id = ?1");
    conn.query_row(&sql, params![id], Event::from_row)
        .optional()
        .map_err(Into::into)
}

pub fn create_event(conn: &Connection, new_event: &NewEvent) -> DbResult<Event> {
    conn.execute(
        "INSERT INTO events (graph_id, title, description, start_date, end_date, is_all_day, show_as, categories) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            new_event.graph_id,
            new_event.title,
            new_event.description,
            new_event.start_date,
            new_event.end_date,
            new_event.is_all_day,
            new_event.show_as,
            new_event.categories,
        ],
    )?;
    let id = conn.last_insert_rowid();
    get_event_by_id(conn, id)?.ok_or_else(|| DbError::Other(format!("event {id} vanished immediately after insert")))
}

/// Returns `None` when `id` doesn't exist, rather than fabricating a
/// response the way `main.js:318` did (it ran the `UPDATE` unconditionally
/// and always returned `{ id, ...eventData }`, whether or not any row
/// matched). `changed == 0` is the same signal `delete_event` already uses
/// for a missing id, so this stays consistent with it.
pub fn update_event(conn: &Connection, id: i64, update: &EventUpdate) -> DbResult<Option<Event>> {
    let changed = conn.execute(
        "UPDATE events SET title = ?1, description = ?2, start_date = ?3, end_date = ?4, \
         is_all_day = ?5, show_as = ?6, categories = ?7, updated_at = CURRENT_TIMESTAMP \
         WHERE id = ?8",
        params![
            update.title,
            update.description,
            update.start_date,
            update.end_date,
            update.is_all_day,
            update.show_as,
            update.categories,
            id,
        ],
    )?;
    if changed == 0 {
        return Ok(None);
    }
    get_event_by_id(conn, id)
}

pub fn delete_event(conn: &Connection, id: i64) -> DbResult<bool> {
    let changed = conn.execute("DELETE FROM events WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}

/// Replaces `DataManagement.tsx`'s old "fetch every event, then await
/// `deleteEvent(id)` in a loop" — against the real database that was 8,924
/// IPC round trips, each its own transaction and fsync, and a failure
/// partway through left a half-emptied table with no way to tell how far it
/// got. A single `DELETE FROM events` is one statement, so SQLite already
/// runs it atomically; no `BEGIN`/`COMMIT` wrapper is needed (and none
/// should be added — one statement is already all-or-nothing).
///
/// The foreign key in this schema points `events.type_id` ->
/// `event_types(id)`, not the other way around, so deleting every event
/// never cascades into `event_types`, `event_type_rules` or `categories` —
/// verified explicitly in this module's tests rather than assumed, because
/// those three tables hold the user's local-only types and rules that
/// Microsoft Graph cannot recreate.
pub fn delete_all_events(conn: &Connection) -> DbResult<u32> {
    let changed = conn.execute("DELETE FROM events", [])?;
    Ok(changed as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::{run_migrations, seed_default_event_type};

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    fn insert(conn: &Connection, title: &str, start_date: &str, end_date: Option<&str>) -> Event {
        create_event(
            conn,
            &NewEvent {
                graph_id: None,
                title: title.to_string(),
                description: None,
                start_date: start_date.to_string(),
                end_date: end_date.map(str::to_string),
                is_all_day: false,
                show_as: "busy".to_string(),
                categories: String::new(),
            },
        )
        .unwrap()
    }

    /// The bulk reads must not carry `description`. It is 8.2MB across a real
    /// 3,685-event database, no frontend code reads it, and shipping it over
    /// IPC on every list load was the direct cause of a multi-second stall
    /// after a sync. This test fails the moment someone points `get_events` or
    /// `get_events_in_range` back at `EVENT_COLUMNS`.
    #[test]
    fn bulk_reads_omit_the_event_body_but_a_single_fetch_still_returns_it() {
        let conn = setup();
        let created = insert(&conn, "Standup", "2026-03-15T09:00:00", Some("2026-03-15T09:30:00"));
        let id = created.id.unwrap();
        conn.execute(
            "UPDATE events SET description = ?1 WHERE id = ?2",
            rusqlite::params!["<html>a long Outlook body</html>", id],
        )
        .unwrap();

        // Bulk: body withheld.
        let all = get_events(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(
            all[0].description, None,
            "get_events must not ship the event body"
        );

        let in_range =
            get_events_in_range(&conn, "2026-03-01T00:00:00", "2026-03-31T23:59:59").unwrap();
        assert_eq!(in_range.len(), 1);
        assert_eq!(
            in_range[0].description, None,
            "get_events_in_range must not ship the event body"
        );

        // Everything else still comes through, so this is not a blanket drop.
        assert_eq!(all[0].title, "Standup");
        assert_eq!(all[0].show_as, "busy");

        // Single fetch: body intact, so the data is stored and retrievable.
        let one = get_event_by_id(&conn, id).unwrap().unwrap();
        assert_eq!(
            one.description.as_deref(),
            Some("<html>a long Outlook body</html>"),
            "the body must still be stored and fetchable for one event"
        );
    }

    #[test]
    fn create_event_round_trips_every_field() {
        let conn = setup();
        let new_event = NewEvent {
            graph_id: Some("graph-1".to_string()),
            title: "Standup".to_string(),
            description: Some("daily sync".to_string()),
            start_date: "2026-01-01T09:00:00".to_string(),
            end_date: Some("2026-01-01T09:30:00".to_string()),
            is_all_day: true,
            show_as: "busy".to_string(),
            categories: "work,team".to_string(),
        };

        let created = create_event(&conn, &new_event).unwrap();

        assert!(created.id.is_some());
        assert_eq!(created.graph_id.as_deref(), Some("graph-1"));
        assert_eq!(created.title, "Standup");
        assert_eq!(created.description.as_deref(), Some("daily sync"));
        assert_eq!(created.start_date, "2026-01-01T09:00:00");
        assert_eq!(created.end_date.as_deref(), Some("2026-01-01T09:30:00"));
        assert!(created.is_all_day);
        assert_eq!(created.show_as, "busy");
        assert_eq!(created.categories, "work,team");
    }

    #[test]
    fn get_events_orders_by_start_date() {
        let conn = setup();
        insert(&conn, "c", "2026-01-03T00:00:00", None);
        insert(&conn, "a", "2026-01-01T00:00:00", None);
        insert(&conn, "b", "2026-01-02T00:00:00", None);

        let events = get_events(&conn).unwrap();

        let titles: Vec<_> = events.iter().map(|e| e.title.clone()).collect();
        assert_eq!(titles, vec!["a", "b", "c"]);
    }

    /// The regression guard for the `COALESCE` fix: none of `is_all_day`,
    /// `show_as` or `categories` is `NOT NULL` in `schema.rs`, but `Event`
    /// declares them as non-`Option` `bool`/`String`. Before the `COALESCE`
    /// was added to `EVENT_COLUMNS`, a single row with an explicit NULL in
    /// any of these columns made `row.get::<_, T>` return
    /// `InvalidColumnType`, and because `from_row` runs inside
    /// `query_map(...).collect::<Result<Vec<_>, _>>()`, that failed the
    /// *entire* `get_events` call — not just the one row. This inserts a row
    /// with all three explicitly NULL (bypassing `create_event`, which never
    /// writes NULL into any of them) and asserts the query still succeeds,
    /// with the same defaults the schema's own column defaults declare.
    #[test]
    fn get_events_survives_a_row_with_null_is_all_day_show_as_and_categories() {
        let conn = setup();
        conn.execute(
            "INSERT INTO events (title, start_date, is_all_day, show_as, categories) \
             VALUES ('Nully', '2026-01-01T00:00:00', NULL, NULL, NULL)",
            [],
        )
        .unwrap();

        let events = get_events(&conn).unwrap();

        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.title, "Nully");
        assert!(!event.is_all_day, "NULL is_all_day must coalesce to false");
        assert_eq!(event.show_as, "busy", "NULL show_as must coalesce to 'busy'");
        assert_eq!(event.categories, "", "NULL categories must coalesce to an empty string");
    }

    #[test]
    fn delete_all_events_returns_count_and_empties_the_table() {
        let conn = setup();
        insert(&conn, "a", "2026-01-01T00:00:00", None);
        insert(&conn, "b", "2026-01-02T00:00:00", None);
        insert(&conn, "c", "2026-01-03T00:00:00", None);

        let deleted = delete_all_events(&conn).unwrap();

        assert_eq!(deleted, 3);
        assert!(get_events(&conn).unwrap().is_empty());
    }

    #[test]
    fn delete_all_events_returns_zero_on_an_already_empty_table() {
        let conn = setup();

        let deleted = delete_all_events(&conn).unwrap();

        assert_eq!(deleted, 0);
    }

    /// The guard that matters most: the user's 3 event types and 2 rules
    /// exist only locally and cannot be re-synced from Microsoft Graph the
    /// way events can. Foreign keys are enforced in this build
    /// (`-DSQLITE_DEFAULT_FOREIGN_KEYS=1`), and the reference runs
    /// `events.type_id` -> `event_types.id` — the opposite direction from
    /// what a cascading delete would need to touch `event_types` — so
    /// clearing every event must leave `event_types`, `event_type_rules`
    /// and `categories` completely untouched. Asserted explicitly rather
    /// than assumed, per the task brief: a wrong table name or a stray
    /// cascade here would silently destroy data Graph cannot recreate,
    /// while `delete_all_events`'s own return value would still look fine.
    #[test]
    fn delete_all_events_leaves_event_types_rules_and_categories_untouched() {
        use crate::db::categories::{create_category, NewCategory};
        use crate::db::event_types::{create_event_type, create_event_type_rule, NewEventType, NewEventTypeRule};

        let conn = setup();

        let event_type = create_event_type(
            &conn,
            &NewEventType {
                name: "Consulting".to_string(),
                color: "#ff0000".to_string(),
                is_default: false,
                is_billable: true,
            },
        )
        .unwrap();
        create_event_type_rule(
            &conn,
            &NewEventTypeRule {
                name: "Consulting keyword".to_string(),
                priority: 1,
                field_name: "title".to_string(),
                operator: "contains".to_string(),
                value: Some("Consulting".to_string()),
                target_type_id: event_type.id.unwrap(),
            },
        )
        .unwrap();
        create_category(
            &conn,
            &NewCategory { name: "Client Work".to_string(), color: "#00ff00".to_string() },
        )
        .unwrap();

        // An event that actually references the type, so a foreign key
        // violation (if the delete somehow ran in the wrong direction)
        // would surface immediately rather than being masked by an empty
        // events table.
        let created = insert(&conn, "Consulting call", "2026-01-01T00:00:00", None);
        conn.execute(
            "UPDATE events SET type_id = ?1, type_manually_set = 1 WHERE id = ?2",
            params![event_type.id.unwrap(), created.id.unwrap()],
        )
        .unwrap();

        let deleted = delete_all_events(&conn).unwrap();
        assert_eq!(deleted, 1);

        let type_count: i64 = conn.query_row("SELECT COUNT(*) FROM event_types", [], |r| r.get(0)).unwrap();
        assert_eq!(type_count, 1, "event_types must survive deleting all events");

        let rule_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM event_type_rules", [], |r| r.get(0)).unwrap();
        assert_eq!(rule_count, 1, "event_type_rules must survive deleting all events");

        let category_count: i64 = conn.query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0)).unwrap();
        assert_eq!(category_count, 1, "categories must survive deleting all events");

        assert!(get_events(&conn).unwrap().is_empty());
    }

    #[test]
    fn delete_event_returns_false_for_missing_id() {
        let conn = setup();
        assert!(!delete_event(&conn, 9999).unwrap());
    }

    #[test]
    fn delete_event_returns_true_when_a_row_is_removed() {
        let conn = setup();
        let created = insert(&conn, "Gone soon", "2026-01-01T00:00:00", None);

        assert!(delete_event(&conn, created.id.unwrap()).unwrap());
        assert!(get_events(&conn).unwrap().is_empty());
    }

    /// The case the note in the task brief calls out by name: `type_id` and
    /// `graph_id` are populated only by Graph sync / manual assignment, never
    /// by `update_event`, so they must survive an update untouched — along
    /// with `type_manually_set`, since clobbering that would silently discard
    /// a user's manual override.
    #[test]
    fn update_event_leaves_untouched_columns_alone() {
        let conn = setup();
        seed_default_event_type(&conn).unwrap();
        let created = insert(&conn, "Original", "2026-01-01T00:00:00", None);
        let id = created.id.unwrap();
        conn.execute(
            "UPDATE events SET graph_id = 'graph-xyz', type_id = 1, type_manually_set = 1, location = 'Room 1' WHERE id = ?1",
            params![id],
        )
        .unwrap();

        let updated = update_event(
            &conn,
            id,
            &EventUpdate {
                title: "Updated title".to_string(),
                description: Some("new desc".to_string()),
                start_date: "2026-02-01T00:00:00".to_string(),
                end_date: None,
                is_all_day: true,
                show_as: "free".to_string(),
                categories: "personal".to_string(),
            },
        )
        .unwrap()
        .unwrap();

        // Columns update_event is supposed to change.
        assert_eq!(updated.title, "Updated title");
        assert_eq!(updated.description.as_deref(), Some("new desc"));
        assert_eq!(updated.start_date, "2026-02-01T00:00:00");
        assert_eq!(updated.end_date, None);
        assert!(updated.is_all_day);
        assert_eq!(updated.show_as, "free");
        assert_eq!(updated.categories, "personal");

        // Columns it must leave alone.
        assert_eq!(updated.graph_id.as_deref(), Some("graph-xyz"));
        assert_eq!(updated.type_id, Some(1));
        assert_eq!(updated.type_manually_set, Some(true));
        assert_eq!(updated.location.as_deref(), Some("Room 1"));
    }

    #[test]
    fn update_event_returns_none_for_missing_id() {
        let conn = setup();
        let result = update_event(
            &conn,
            9999,
            &EventUpdate {
                title: "x".to_string(),
                description: None,
                start_date: "2026-01-01T00:00:00".to_string(),
                end_date: None,
                is_all_day: false,
                show_as: "busy".to_string(),
                categories: String::new(),
            },
        )
        .unwrap();

        assert!(result.is_none());
    }

    // The range query's five enumerated cases. Range is 2026-01-10..2026-01-20
    // throughout, and each test is built so only one of the three OR'd
    // conditions can be responsible for a match.

    const RANGE_START: &str = "2026-01-10T00:00:00";
    const RANGE_END: &str = "2026-01-20T00:00:00";

    #[test]
    fn range_query_includes_event_starting_within_range() {
        let conn = setup();
        // Starts inside [10, 20], ends after it: only condition 1 can match.
        insert(&conn, "StartsInside", "2026-01-12T00:00:00", Some("2026-01-25T00:00:00"));

        let results = get_events_in_range(&conn, RANGE_START, RANGE_END).unwrap();

        let titles: Vec<_> = results.iter().map(|e| e.title.clone()).collect();
        assert_eq!(titles, vec!["StartsInside"]);
    }

    #[test]
    fn range_query_includes_event_ending_within_range() {
        let conn = setup();
        // Starts before [10, 20], ends inside it: only condition 2 can match.
        insert(&conn, "EndsInside", "2026-01-05T00:00:00", Some("2026-01-15T00:00:00"));

        let results = get_events_in_range(&conn, RANGE_START, RANGE_END).unwrap();

        let titles: Vec<_> = results.iter().map(|e| e.title.clone()).collect();
        assert_eq!(titles, vec!["EndsInside"]);
    }

    #[test]
    fn range_query_includes_event_spanning_entire_range() {
        let conn = setup();
        // Starts before the range and ends after it: only condition 3 can match.
        insert(&conn, "Spans", "2026-01-01T00:00:00", Some("2026-01-31T00:00:00"));

        let results = get_events_in_range(&conn, RANGE_START, RANGE_END).unwrap();

        let titles: Vec<_> = results.iter().map(|e| e.title.clone()).collect();
        assert_eq!(titles, vec!["Spans"]);
    }

    #[test]
    fn range_query_excludes_event_entirely_outside_range() {
        let conn = setup();
        insert(&conn, "Outside", "2026-02-01T00:00:00", Some("2026-02-05T00:00:00"));

        let results = get_events_in_range(&conn, RANGE_START, RANGE_END).unwrap();

        assert!(results.is_empty());
    }

    #[test]
    fn range_query_includes_event_with_null_end_date_starting_within_range() {
        let conn = setup();
        // NULL end_date only affects conditions 2 and 3, both of which
        // reference end_date; condition 1 never looks at it, so a
        // start_date inside the range must still be found.
        insert(&conn, "OpenEnded", "2026-01-12T00:00:00", None);

        let results = get_events_in_range(&conn, RANGE_START, RANGE_END).unwrap();

        let titles: Vec<_> = results.iter().map(|e| e.title.clone()).collect();
        assert_eq!(titles, vec!["OpenEnded"]);
    }
}
