// CRUD for the `activities` table. Activities are a second, independent
// dimension alongside event types: an event type answers "is this billable",
// an activity answers "what discipline was the work". Nothing references
// activities yet — see `delete_activity`.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

use super::error::DbResult;
use super::models::Activity;

/// Named explicitly rather than `SELECT *` for the same reason
/// `event_types::EVENT_TYPE_COLUMNS` is: on-disk column order is not
/// guaranteed. `color` is `NOT NULL` here (unlike `event_types.color`), so it
/// needs no `COALESCE`.
const ACTIVITY_COLUMNS: &str = "id, name, color, is_active, created_at";

/// What a caller supplies to create or update an activity: no `id` or
/// `created_at`, both assigned by SQLite. One struct serves both operations
/// because every field an activity has is editable — unlike event types,
/// which need separate shapes because `is_default` is set through its own
/// dedicated command.
#[derive(Debug, Deserialize)]
pub struct ActivityInput {
    pub name: String,
    pub color: String,
    /// Defaults to `true`, not `false`. antd's `form.validateFields()` only
    /// returns fields the modal actually registered, so a payload can arrive
    /// without `is_active` — and `#[serde(default)]` on a bool would make
    /// that silently create a *disabled* activity. This is the same trap
    /// `NewEventType::is_default` documents.
    #[serde(default = "default_true")]
    pub is_active: bool,
}

fn default_true() -> bool {
    true
}

pub fn list_activities(conn: &Connection) -> DbResult<Vec<Activity>> {
    let sql = format!("SELECT {ACTIVITY_COLUMNS} FROM activities ORDER BY name COLLATE NOCASE");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], Activity::from_row)?;

    let mut activities = Vec::new();
    for row in rows {
        activities.push(row?);
    }
    Ok(activities)
}

pub fn create_activity(conn: &Connection, input: &ActivityInput) -> DbResult<Activity> {
    conn.execute(
        "INSERT INTO activities (name, color, is_active) VALUES (?1, ?2, ?3)",
        params![input.name, input.color, input.is_active],
    )?;

    let id = conn.last_insert_rowid();
    let sql = format!("SELECT {ACTIVITY_COLUMNS} FROM activities WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], Activity::from_row)?)
}

pub fn update_activity(
    conn: &Connection,
    id: i64,
    input: &ActivityInput,
) -> DbResult<Option<Activity>> {
    let changed = conn.execute(
        "UPDATE activities SET name = ?1, color = ?2, is_active = ?3 WHERE id = ?4",
        params![input.name, input.color, input.is_active, id],
    )?;

    if changed == 0 {
        return Ok(None);
    }

    let sql = format!("SELECT {ACTIVITY_COLUMNS} FROM activities WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], Activity::from_row).optional()?)
}

/// A bare `DELETE`, which is only safe because nothing references activities
/// yet.
///
/// When events gain an `activity_id`, this needs the treatment
/// `event_types::delete_event_type` already got: reassign or clear
/// referencing rows inside one transaction before deleting. Foreign keys are
/// enforced in this build, so the failure would at least be loud rather than
/// silently orphaning rows — but it would still be a failure the user sees.
pub fn delete_activity(conn: &Connection, id: i64) -> DbResult<bool> {
    let changed = conn.execute("DELETE FROM activities WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::run_migrations;

    /// A migrated database, with the eleven seeded rows removed so each test
    /// starts from a known-empty table. Deleting rather than skipping the
    /// migration keeps the schema (and its UNIQUE constraint) real.
    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute("DELETE FROM activities", []).unwrap();
        conn
    }

    fn input(name: &str, color: &str, is_active: bool) -> ActivityInput {
        ActivityInput { name: name.to_string(), color: color.to_string(), is_active }
    }

    /// The regression guard for the bug `ActivityInput::is_active`'s
    /// `#[serde(default = "default_true")]` exists to fix. Every other test
    /// in this file builds `ActivityInput` with the `input()` helper — a
    /// plain struct literal that always sets `is_active` explicitly and so
    /// can never observe what serde does when the field is missing. Only
    /// deserializing real JSON, the way `create_activity`/`update_activity`
    /// actually receive their payload from the frontend, exercises the
    /// default at all. If this attribute were reverted to a plain
    /// `#[serde(default)]` — which silently means `false` for a bool — every
    /// other test would keep compiling and passing while the activity-management
    /// modal started creating disabled activities behind the user's back.
    #[test]
    fn activity_input_defaults_is_active_to_true_when_absent_from_payload() {
        let json = r##"{"name":"Architecture","color":"#2f54eb"}"##;
        let parsed: ActivityInput = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.is_active, true);
        assert_eq!(parsed.name, "Architecture");
        assert_eq!(parsed.color, "#2f54eb");
    }

    /// The companion case: an explicit `false` must still be honoured, so the
    /// default can't be satisfied by an implementation that ignores the
    /// payload and always returns `true`.
    #[test]
    fn activity_input_honours_an_explicit_false_for_is_active() {
        let json = r##"{"name":"Retired","color":"#f5222d","is_active":false}"##;
        let parsed: ActivityInput = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.is_active, false);
    }

    #[test]
    fn create_returns_the_activity_with_its_generated_id() {
        let conn = setup();

        let created = create_activity(&conn, &input("Architecture", "#2f54eb", true)).unwrap();

        assert!(created.id.is_some(), "SQLite must assign an id");
        assert_eq!(created.name, "Architecture");
        assert_eq!(created.color, "#2f54eb");
        assert!(created.is_active);
    }

    #[test]
    fn list_is_alphabetical_and_case_insensitive() {
        let conn = setup();
        create_activity(&conn, &input("uX Design", "#eb2f96", true)).unwrap();
        create_activity(&conn, &input("Architecture", "#2f54eb", true)).unwrap();
        create_activity(&conn, &input("devOps", "#52c41a", true)).unwrap();

        let names: Vec<String> =
            list_activities(&conn).unwrap().into_iter().map(|a| a.name).collect();

        assert_eq!(names, vec!["Architecture", "devOps", "uX Design"]);
    }

    #[test]
    fn list_returns_inactive_activities_too() {
        let conn = setup();
        create_activity(&conn, &input("Retired", "#f5222d", false)).unwrap();

        let all = list_activities(&conn).unwrap();

        assert_eq!(all.len(), 1, "the management screen has to see inactive rows to re-enable them");
        assert!(!all[0].is_active);
    }

    #[test]
    fn a_duplicate_name_is_rejected() {
        let conn = setup();
        create_activity(&conn, &input("DevOps", "#52c41a", true)).unwrap();

        let err = create_activity(&conn, &input("DevOps", "#1890ff", true));

        assert!(err.is_err(), "the UNIQUE constraint must reject a second DevOps");
        assert!(
            format!("{}", err.unwrap_err()).contains("UNIQUE constraint failed"),
            "the frontend keys its readable message off this exact wording"
        );
    }

    #[test]
    fn update_changes_name_colour_and_active_flag() {
        let conn = setup();
        let created = create_activity(&conn, &input("Testing", "#a0d911", true)).unwrap();

        let updated = update_activity(
            &conn,
            created.id.unwrap(),
            &input("Manual Testing", "#faad14", false),
        )
        .unwrap();

        let updated = updated.expect("updating an existing row returns it");
        assert_eq!(updated.name, "Manual Testing");
        assert_eq!(updated.color, "#faad14");
        assert!(!updated.is_active);
    }

    #[test]
    fn updating_a_missing_activity_returns_none_rather_than_erroring() {
        let conn = setup();

        let result = update_activity(&conn, 9999, &input("Ghost", "#000000", true)).unwrap();

        assert!(result.is_none());
    }

    #[test]
    fn delete_removes_the_row_and_reports_whether_it_existed() {
        let conn = setup();
        let created = create_activity(&conn, &input("Scrapped", "#f5222d", true)).unwrap();

        assert!(delete_activity(&conn, created.id.unwrap()).unwrap());
        assert_eq!(list_activities(&conn).unwrap().len(), 0);
        assert!(!delete_activity(&conn, created.id.unwrap()).unwrap(), "a second delete is a no-op");
    }
}
