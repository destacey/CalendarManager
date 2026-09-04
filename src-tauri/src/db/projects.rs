// CRUD for the `projects` table, mirroring `db::activities`. A project is
// user data — name, a unique code, an optional free-text program, and an
// active flag. Nothing references projects yet; see `delete_project`.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::error::DbResult;
use super::models::Project;

/// Named explicitly rather than `SELECT *` for the same reason
/// `activities::ACTIVITY_COLUMNS` is: on-disk column order is not guaranteed.
/// `program` needs no `COALESCE` — it is genuinely nullable and `Project`
/// types it as `Option<String>`.
const PROJECT_COLUMNS: &str = "id, name, code, program, is_active, created_at";

/// What a caller supplies to create or update a project: no `id` or
/// `created_at`, both assigned by SQLite. One struct serves both operations
/// because every field on a project is editable.
#[derive(Debug, Deserialize)]
pub struct ProjectInput {
    pub name: String,
    pub code: String,
    /// `Option<String>`, and the form sends `None` for a blank program rather
    /// than an empty string — see `normalise_program`.
    #[serde(default)]
    pub program: Option<String>,
    /// Defaults to `true`, not `false`. antd's `form.validateFields()` only
    /// returns fields the modal actually registered, so a payload can arrive
    /// without `is_active` — and `#[serde(default)]` on a bool would make that
    /// silently create a *disabled* project. Same trap `ActivityInput` and
    /// `NewEventType::is_default` document.
    #[serde(default = "default_true")]
    pub is_active: bool,
}

fn default_true() -> bool {
    true
}

/// A program the user cleared is an empty string coming out of an antd
/// `Input`, not `None`. Storing that would make "no program" two different
/// values in the column, so blank collapses to `NULL`.
fn normalise_program(program: &Option<String>) -> Option<String> {
    program
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(str::to_string)
}

pub fn list_projects(conn: &Connection) -> DbResult<Vec<Project>> {
    let sql = format!("SELECT {PROJECT_COLUMNS} FROM projects ORDER BY name COLLATE NOCASE");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], Project::from_row)?;

    let mut projects = Vec::new();
    for row in rows {
        projects.push(row?);
    }
    Ok(projects)
}

pub fn create_project(conn: &Connection, input: &ProjectInput) -> DbResult<Project> {
    conn.execute(
        "INSERT INTO projects (name, code, program, is_active) VALUES (?1, ?2, ?3, ?4)",
        params![
            input.name,
            input.code,
            normalise_program(&input.program),
            input.is_active
        ],
    )?;

    let id = conn.last_insert_rowid();
    let sql = format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], Project::from_row)?)
}

pub fn update_project(conn: &Connection, id: i64, input: &ProjectInput) -> DbResult<Option<Project>> {
    let changed = conn.execute(
        "UPDATE projects SET name = ?1, code = ?2, program = ?3, is_active = ?4 WHERE id = ?5",
        params![
            input.name,
            input.code,
            normalise_program(&input.program),
            input.is_active,
            id
        ],
    )?;

    if changed == 0 {
        return Ok(None);
    }

    let sql = format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], Project::from_row).optional()?)
}

/// What deleting a project actually did.
///
/// Migration 4 gave `events` and `mapping_rules` a `project_id`, and foreign
/// keys are enforced in this build, so a bare `DELETE` now fails outright the
/// moment anything references the project. Clearing the references first is
/// the deliberate replacement - the same shape as
/// `event_types::DeleteEventTypeOutcome`, and the Settings screen reports it
/// rather than showing a bare success.
///
/// Events are *unmapped* rather than moved to another project: there is no
/// sensible default to reassign work to, and silently re-filing someone's
/// time would be worse than handing it back to the queue.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectOutcome {
    pub deleted: bool,
    pub events_unmapped: usize,
    pub rules_removed: usize,
}

pub fn delete_project(conn: &Connection, id: i64) -> DbResult<DeleteProjectOutcome> {
    let tx = conn.unchecked_transaction()?;

    let events_unmapped = tx.execute(
        "UPDATE events SET project_id = NULL, activity_id = NULL, mapping_manually_set = 0
         WHERE project_id = ?1",
        params![id],
    )?;

    // A rule cannot survive losing its target: project_id is NOT NULL, and a
    // rule pointing nowhere would be worse than no rule.
    let rules_removed = tx.execute("DELETE FROM mapping_rules WHERE project_id = ?1", params![id])?;

    let deleted = tx.execute("DELETE FROM projects WHERE id = ?1", params![id])? > 0;

    tx.commit()?;

    Ok(DeleteProjectOutcome {
        deleted,
        events_unmapped,
        rules_removed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::run_migrations;

    /// A migrated database. Unlike `activities`, `projects` has no seed, so
    /// there is nothing to clear.
    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    fn input(name: &str, code: &str, program: Option<&str>, is_active: bool) -> ProjectInput {
        ProjectInput {
            name: name.to_string(),
            code: code.to_string(),
            program: program.map(str::to_string),
            is_active,
        }
    }

    #[test]
    fn create_returns_the_project_with_its_generated_id() {
        let conn = setup();

        let created =
            create_project(&conn, &input("Website Rebuild", "PRJ-001", Some("Platform"), true))
                .unwrap();

        assert!(created.id.is_some(), "SQLite must assign an id");
        assert_eq!(created.name, "Website Rebuild");
        assert_eq!(created.code, "PRJ-001");
        assert_eq!(created.program.as_deref(), Some("Platform"));
        assert!(created.is_active);
    }

    #[test]
    fn list_is_alphabetical_by_name_and_case_insensitive() {
        let conn = setup();
        create_project(&conn, &input("zeta", "P3", None, true)).unwrap();
        create_project(&conn, &input("Alpha", "P1", None, true)).unwrap();
        create_project(&conn, &input("mid", "P2", None, true)).unwrap();

        let names: Vec<String> = list_projects(&conn).unwrap().into_iter().map(|p| p.name).collect();

        assert_eq!(names, vec!["Alpha", "mid", "zeta"]);
    }

    #[test]
    fn list_returns_inactive_projects_too() {
        let conn = setup();
        create_project(&conn, &input("Retired", "PRJ-OLD", None, false)).unwrap();

        let all = list_projects(&conn).unwrap();

        assert_eq!(all.len(), 1, "the management screen must see inactive rows to re-enable them");
        assert!(!all[0].is_active);
    }

    #[test]
    fn a_duplicate_code_is_rejected() {
        let conn = setup();
        create_project(&conn, &input("First", "PRJ-001", None, true)).unwrap();

        let err = create_project(&conn, &input("Second", "PRJ-001", None, true));

        assert!(err.is_err(), "the UNIQUE constraint must reject a repeated code");
        assert!(
            format!("{}", err.unwrap_err()).contains("UNIQUE constraint failed"),
            "the frontend keys its readable message off this exact wording"
        );
    }

    /// Deliberately allowed: `code` carries identity, `name` does not.
    #[test]
    fn two_projects_may_share_a_name() {
        let conn = setup();
        create_project(&conn, &input("Migration", "PRJ-001", Some("Billing"), true)).unwrap();

        let second = create_project(&conn, &input("Migration", "PRJ-002", Some("Identity"), true));

        assert!(second.is_ok(), "a repeated name must be accepted");
        assert_eq!(list_projects(&conn).unwrap().len(), 2);
    }

    #[test]
    fn update_changes_every_field() {
        let conn = setup();
        let created = create_project(&conn, &input("Old", "PRJ-001", Some("Platform"), true)).unwrap();

        let updated = update_project(
            &conn,
            created.id.unwrap(),
            &input("New", "PRJ-999", Some("Identity"), false),
        )
        .unwrap()
        .expect("updating an existing row returns it");

        assert_eq!(updated.name, "New");
        assert_eq!(updated.code, "PRJ-999");
        assert_eq!(updated.program.as_deref(), Some("Identity"));
        assert!(!updated.is_active);
    }

    #[test]
    fn updating_a_missing_project_returns_none_rather_than_erroring() {
        let conn = setup();

        let result = update_project(&conn, 9999, &input("Ghost", "PRJ-X", None, true)).unwrap();

        assert!(result.is_none());
    }

    #[test]
    fn delete_removes_the_row_and_reports_whether_it_existed() {
        let conn = setup();
        let created = create_project(&conn, &input("Scrapped", "PRJ-001", None, true)).unwrap();

        assert!(delete_project(&conn, created.id.unwrap()).unwrap().deleted);
        assert_eq!(list_projects(&conn).unwrap().len(), 0);
        assert!(
            !delete_project(&conn, created.id.unwrap()).unwrap().deleted,
            "a second delete is a no-op"
        );
    }

    /// Foreign keys are enforced, so this would fail outright as a bare
    /// DELETE the moment an event referenced the project.
    #[test]
    fn deleting_a_project_in_use_unmaps_its_events_rather_than_failing() {
        let conn = setup();
        let project = create_project(&conn, &input("Doomed", "PRJ-001", None, true)).unwrap();
        let pid = project.id.unwrap();
        conn.execute(
            "INSERT INTO events (id, title, start_date, project_id, mapping_manually_set)
             VALUES (1, 'A', '2026-10-01T09:00:00', ?1, 1), (2, 'B', '2026-10-02T09:00:00', ?1, 1)",
            params![pid],
        )
        .unwrap();

        let outcome = delete_project(&conn, pid).unwrap();

        assert!(outcome.deleted);
        assert_eq!(outcome.events_unmapped, 2);
        let still_mapped: i64 = conn
            .query_row("SELECT COUNT(*) FROM events WHERE project_id IS NOT NULL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(still_mapped, 0, "the events survive, unmapped");
        let surviving: i64 = conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0)).unwrap();
        assert_eq!(surviving, 2, "deleting a project must never delete events");
    }

    /// A rule's project_id is NOT NULL, so a rule cannot outlive its target.
    #[test]
    fn deleting_a_project_removes_the_rules_that_targeted_it() {
        let conn = setup();
        let project = create_project(&conn, &input("Doomed", "PRJ-001", None, true)).unwrap();
        let pid = project.id.unwrap();
        conn.execute(
            "INSERT INTO mapping_rules (priority, name_operator, name_value, project_id)
             VALUES (1, 'is', 'Standup', ?1)",
            params![pid],
        )
        .unwrap();

        let outcome = delete_project(&conn, pid).unwrap();

        assert_eq!(outcome.rules_removed, 1);
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM mapping_rules", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }

    /// A cleared program field arrives as `""` from an antd Input. Storing
    /// that alongside real NULLs would make "no program" two distinct values.
    #[test]
    fn a_blank_or_whitespace_program_is_stored_as_null() {
        let conn = setup();

        let empty = create_project(&conn, &input("A", "PRJ-001", Some(""), true)).unwrap();
        let spaces = create_project(&conn, &input("B", "PRJ-002", Some("   "), true)).unwrap();
        let absent = create_project(&conn, &input("C", "PRJ-003", None, true)).unwrap();

        assert_eq!(empty.program, None, "an empty string must become NULL");
        assert_eq!(spaces.program, None, "whitespace-only must become NULL");
        assert_eq!(absent.program, None);
    }

    #[test]
    fn a_program_is_trimmed_rather_than_stored_with_padding() {
        let conn = setup();

        let created = create_project(&conn, &input("A", "PRJ-001", Some("  Platform  "), true)).unwrap();

        assert_eq!(created.program.as_deref(), Some("Platform"));
    }

    /// The attribute this guards is invisible to every other test in this
    /// file, because they all build `ProjectInput` as a struct literal. Only a
    /// real deserialization can observe serde's field default.
    #[test]
    fn project_input_defaults_is_active_to_true_when_absent_from_payload() {
        let parsed: ProjectInput =
            serde_json::from_str(r#"{"name":"Rebuild","code":"PRJ-001"}"#).unwrap();

        assert!(
            parsed.is_active,
            "a payload without is_active must create an ACTIVE project, not a disabled one"
        );
        assert_eq!(parsed.program, None, "an absent program stays absent");
    }

    #[test]
    fn project_input_honours_an_explicit_false_for_is_active() {
        let parsed: ProjectInput =
            serde_json::from_str(r#"{"name":"Retired","code":"PRJ-OLD","is_active":false}"#)
                .unwrap();

        assert!(!parsed.is_active, "an explicit false must not be overridden by the default");
    }
}
