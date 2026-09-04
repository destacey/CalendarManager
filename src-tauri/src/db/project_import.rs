// CSV import for projects. Create-only: an incoming row whose code already
// exists is skipped, never updated, and nothing is ever deleted.
//
// Split into two phases on purpose. `preview_project_import` reads and
// validates the file and reports exactly what *would* happen without touching
// the database; `commit_project_import` takes that plan back and writes it.
// The user confirms between the two, which matters because there is no undo.
//
// The commit takes the previewed rows rather than re-reading the path, so what
// the user approved is what gets written even if the file changes underneath.

use std::collections::HashSet;
use std::path::Path;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::error::{DbError, DbResult};
use super::projects::ProjectInput;

/// Why a row will not be imported. Serialised to the UI so the preview can
/// name the row and the reason rather than just a count.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkippedRow {
    /// 1-based line number in the file as the user sees it in a spreadsheet,
    /// counting the header as line 1.
    pub line: usize,
    pub name: String,
    pub code: String,
    pub reason: String,
}

/// A row that will be created, paired with its line number so the preview can
/// show where each came from.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedProject {
    pub line: usize,
    pub name: String,
    pub code: String,
    pub program: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectImportPreview {
    pub to_create: Vec<PlannedProject>,
    pub skipped: Vec<SkippedRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectImportOutcome {
    pub created: usize,
    /// Rows that were still rejected at commit time. Normally zero — this is
    /// non-zero only if the database changed between preview and confirm.
    pub skipped: usize,
}

/// Locates a column by header name, case- and whitespace-insensitively, so a
/// spreadsheet exported with "Code " or "CODE" still works.
fn column_index(headers: &csv::StringRecord, wanted: &[&str]) -> Option<usize> {
    headers.iter().position(|h| {
        let h = h.trim().to_lowercase();
        wanted.contains(&h.as_str())
    })
}

/// Accepts the spellings a human or a spreadsheet actually produces. Anything
/// unrecognised is treated as active rather than rejected — an odd value in an
/// optional column should not cost the user the row.
fn parse_active(raw: &str) -> bool {
    !matches!(
        raw.trim().to_lowercase().as_str(),
        "false" | "no" | "n" | "0" | "inactive"
    )
}

fn cell(record: &csv::StringRecord, index: Option<usize>) -> String {
    index
        .and_then(|i| record.get(i))
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub fn preview_project_import(conn: &Connection, path: &str) -> DbResult<ProjectImportPreview> {
    let path = Path::new(path);
    if !path.exists() {
        return Err(DbError::Other(format!(
            "That file no longer exists: {}",
            path.display()
        )));
    }

    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_path(path)
        .map_err(|e| DbError::Other(format!("Could not read that CSV: {e}")))?;

    let headers = reader
        .headers()
        .map_err(|e| DbError::Other(format!("Could not read the CSV header row: {e}")))?
        .clone();

    let name_at = column_index(&headers, &["name", "project", "project name"]);
    let code_at = column_index(&headers, &["code", "project code"]);

    if name_at.is_none() || code_at.is_none() {
        return Err(DbError::Other(
            "The CSV needs a header row with at least 'Name' and 'Code' columns.".to_string(),
        ));
    }

    let program_at = column_index(&headers, &["program"]);
    let active_at = column_index(&headers, &["active", "is_active", "is active"]);

    // Existing codes are compared lowercased because SQLite's UNIQUE on a TEXT
    // column is case-sensitive, but a user who already has PRJ-001 does not
    // mean something different by prj-001 — importing it would create a
    // confusing near-duplicate rather than being caught as existing.
    let mut seen: HashSet<String> = existing_codes(conn)?;

    let mut to_create = Vec::new();
    let mut skipped = Vec::new();

    for (offset, record) in reader.records().enumerate() {
        // +2: one for the header row, one to make it 1-based like a spreadsheet.
        let line = offset + 2;
        let record = match record {
            Ok(r) => r,
            Err(e) => {
                skipped.push(SkippedRow {
                    line,
                    name: String::new(),
                    code: String::new(),
                    reason: format!("could not be parsed ({e})"),
                });
                continue;
            }
        };

        let name = cell(&record, name_at);
        let code = cell(&record, code_at);
        let program = cell(&record, program_at);
        let is_active = active_at
            .and_then(|i| record.get(i))
            .map(parse_active)
            .unwrap_or(true);

        if name.is_empty() && code.is_empty() {
            continue; // a wholly blank line, common at the end of a file
        }
        if name.is_empty() {
            skipped.push(SkippedRow { line, name, code, reason: "no name".to_string() });
            continue;
        }
        if code.is_empty() {
            skipped.push(SkippedRow { line, name, code, reason: "no code".to_string() });
            continue;
        }

        let key = code.to_lowercase();
        if !seen.insert(key) {
            // Covers both "already in the database" and "appeared earlier in
            // this same file" — from the user's point of view the outcome is
            // identical, and the reason distinguishes them.
            skipped.push(SkippedRow {
                line,
                name,
                code,
                reason: "that code already exists".to_string(),
            });
            continue;
        }

        to_create.push(PlannedProject {
            line,
            name,
            code,
            program: if program.is_empty() { None } else { Some(program) },
            is_active,
        });
    }

    Ok(ProjectImportPreview { to_create, skipped })
}

fn existing_codes(conn: &Connection) -> DbResult<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT LOWER(code) FROM projects")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;

    let mut codes = HashSet::new();
    for row in rows {
        codes.insert(row?);
    }
    Ok(codes)
}

/// Writes the approved rows in one transaction. A row that has become a
/// duplicate since the preview is skipped rather than aborting the batch, so
/// the user still gets everything else.
pub fn commit_project_import(
    conn: &Connection,
    projects: &[ProjectInput],
) -> DbResult<ProjectImportOutcome> {
    let tx = conn.unchecked_transaction()?;

    let mut created = 0usize;
    let mut skipped = 0usize;

    for project in projects {
        let program = project
            .program
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty());

        // INSERT OR IGNORE rather than a failed statement, so one stale code
        // cannot roll back the whole import.
        let changed = tx.execute(
            "INSERT OR IGNORE INTO projects (name, code, program, is_active)
             VALUES (?1, ?2, ?3, ?4)",
            params![project.name, project.code, program, project.is_active],
        )?;

        if changed > 0 {
            created += 1;
        } else {
            skipped += 1;
        }
    }

    tx.commit()?;

    Ok(ProjectImportOutcome { created, skipped })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::projects::{create_project, list_projects};
    use crate::db::schema::run_migrations;
    use std::fs;
    use std::path::PathBuf;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    /// Writes a CSV to a real file, because the reader takes a path and that
    /// path handling is part of what these tests cover. Follows the same
    /// temp-file idiom as `db::migrate`'s tests rather than pulling in a crate.
    fn csv_file(contents: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cm-import-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("projects.csv");
        fs::write(&path, contents).unwrap();
        path
    }

    fn preview(conn: &Connection, contents: &str) -> ProjectImportPreview {
        let path = csv_file(contents);
        preview_project_import(conn, path.to_str().unwrap()).unwrap()
    }

    fn input(planned: &PlannedProject) -> ProjectInput {
        ProjectInput {
            name: planned.name.clone(),
            code: planned.code.clone(),
            program: planned.program.clone(),
            is_active: planned.is_active,
        }
    }

    #[test]
    fn a_clean_file_plans_every_row_and_skips_nothing() {
        let conn = setup();

        let plan = preview(
            &conn,
            "Name,Code,Program\nWebsite Rebuild,PRJ-001,Platform\nBilling,PRJ-002,Finance\n",
        );

        assert_eq!(plan.skipped, vec![]);
        assert_eq!(plan.to_create.len(), 2);
        assert_eq!(plan.to_create[0].name, "Website Rebuild");
        assert_eq!(plan.to_create[0].code, "PRJ-001");
        assert_eq!(plan.to_create[0].program.as_deref(), Some("Platform"));
        assert!(plan.to_create[0].is_active, "active defaults to true when the column is absent");
    }

    /// The whole point of the feature: existing projects are never touched.
    #[test]
    fn a_code_already_in_the_database_is_skipped_not_updated() {
        let conn = setup();
        create_project(
            &conn,
            &ProjectInput {
                name: "Original name".into(),
                code: "PRJ-001".into(),
                program: Some("Platform".into()),
                is_active: true,
            },
        )
        .unwrap();

        let plan = preview(&conn, "Name,Code\nDifferent name,PRJ-001\nNew one,PRJ-002\n");

        assert_eq!(plan.to_create.len(), 1);
        assert_eq!(plan.to_create[0].code, "PRJ-002");
        assert_eq!(plan.skipped.len(), 1);
        assert_eq!(plan.skipped[0].code, "PRJ-001");
        assert_eq!(plan.skipped[0].reason, "that code already exists");

        // And committing must leave the original untouched.
        let inputs: Vec<ProjectInput> = plan.to_create.iter().map(input).collect();
        commit_project_import(&conn, &inputs).unwrap();

        let existing = list_projects(&conn)
            .unwrap()
            .into_iter()
            .find(|p| p.code == "PRJ-001")
            .unwrap();
        assert_eq!(existing.name, "Original name", "an existing project must not be edited");
    }

    /// SQLite's UNIQUE is case-sensitive, so without lowercasing, prj-001
    /// would import alongside PRJ-001 as a confusing near-duplicate.
    #[test]
    fn an_existing_code_is_matched_regardless_of_case() {
        let conn = setup();
        create_project(
            &conn,
            &ProjectInput {
                name: "Original".into(),
                code: "PRJ-001".into(),
                program: None,
                is_active: true,
            },
        )
        .unwrap();

        let plan = preview(&conn, "Name,Code\nLowercased,prj-001\n");

        assert_eq!(plan.to_create.len(), 0);
        assert_eq!(plan.skipped.len(), 1);
    }

    #[test]
    fn a_code_repeated_within_the_file_is_only_imported_once() {
        let conn = setup();

        let plan = preview(&conn, "Name,Code\nFirst,PRJ-001\nSecond,PRJ-001\n");

        assert_eq!(plan.to_create.len(), 1);
        assert_eq!(plan.to_create[0].name, "First", "the first occurrence wins");
        assert_eq!(plan.skipped.len(), 1);
        assert_eq!(plan.skipped[0].line, 3);
    }

    #[test]
    fn rows_missing_a_name_or_a_code_are_skipped_with_the_reason() {
        let conn = setup();

        let plan = preview(&conn, "Name,Code\n,PRJ-001\nNo code here,\nGood,PRJ-003\n");

        assert_eq!(plan.to_create.len(), 1);
        assert_eq!(plan.to_create[0].code, "PRJ-003");

        let reasons: Vec<&str> = plan.skipped.iter().map(|s| s.reason.as_str()).collect();
        assert_eq!(reasons, vec!["no name", "no code"]);
    }

    /// Line numbers are what make the preview actionable — the user has to be
    /// able to open the file and find the offending row.
    #[test]
    fn skipped_rows_report_the_spreadsheet_line_number() {
        let conn = setup();

        let plan = preview(&conn, "Name,Code\nGood,PRJ-001\n,PRJ-002\n");

        assert_eq!(plan.skipped[0].line, 3, "header is line 1, so the third row is line 3");
    }

    #[test]
    fn a_wholly_blank_line_is_ignored_rather_than_reported_as_an_error() {
        let conn = setup();

        let plan = preview(&conn, "Name,Code\nGood,PRJ-001\n,\n\n");

        assert_eq!(plan.to_create.len(), 1);
        assert_eq!(plan.skipped, vec![], "trailing blank lines are not the user's mistake");
    }

    #[test]
    fn headers_are_matched_case_and_whitespace_insensitively() {
        let conn = setup();

        let plan = preview(&conn, " CODE , Name , PROGRAM \nPRJ-001,Rebuild,Platform\n");

        assert_eq!(plan.to_create.len(), 1);
        assert_eq!(plan.to_create[0].name, "Rebuild");
        assert_eq!(plan.to_create[0].code, "PRJ-001");
        assert_eq!(plan.to_create[0].program.as_deref(), Some("Platform"));
    }

    #[test]
    fn a_file_without_name_and_code_headers_is_rejected_with_a_readable_message() {
        let conn = setup();
        let path = csv_file("Title,Identifier\nRebuild,PRJ-001\n");

        let err = preview_project_import(&conn, path.to_str().unwrap()).unwrap_err();

        assert!(
            format!("{err}").contains("'Name' and 'Code'"),
            "the message must say what the file needs, got: {err}"
        );
    }

    #[test]
    fn the_active_column_accepts_the_spellings_people_actually_use() {
        let conn = setup();

        let plan = preview(
            &conn,
            "Name,Code,Active\nA,P1,false\nB,P2,No\nC,P3,0\nD,P4,inactive\nE,P5,true\nF,P6,yes\n",
        );

        let flags: Vec<bool> = plan.to_create.iter().map(|p| p.is_active).collect();
        assert_eq!(flags, vec![false, false, false, false, true, true]);
    }

    #[test]
    fn an_unrecognised_active_value_defaults_to_active_rather_than_losing_the_row() {
        let conn = setup();

        let plan = preview(&conn, "Name,Code,Active\nA,P1,maybe\n");

        assert_eq!(plan.to_create.len(), 1);
        assert!(plan.to_create[0].is_active);
    }

    #[test]
    fn a_quoted_field_containing_a_comma_survives_parsing() {
        let conn = setup();

        let plan = preview(&conn, "Name,Code\n\"Rebuild, phase 2\",PRJ-001\n");

        assert_eq!(plan.to_create[0].name, "Rebuild, phase 2");
    }

    #[test]
    fn a_missing_file_reports_a_readable_error() {
        let conn = setup();

        let err = preview_project_import(&conn, "Z:/nope/does-not-exist.csv").unwrap_err();

        assert!(format!("{err}").contains("no longer exists"));
    }

    #[test]
    fn commit_creates_the_planned_rows_and_reports_the_count() {
        let conn = setup();
        let plan = preview(&conn, "Name,Code,Program\nA,P1,Platform\nB,P2,\n");
        let inputs: Vec<ProjectInput> = plan.to_create.iter().map(input).collect();

        let outcome = commit_project_import(&conn, &inputs).unwrap();

        assert_eq!(outcome.created, 2);
        assert_eq!(outcome.skipped, 0);
        let stored = list_projects(&conn).unwrap();
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[1].program, None, "a blank program is stored as NULL");
    }

    /// Guards the window between preview and confirm: if the code appeared in
    /// the meantime, that one row is skipped and the rest still land.
    #[test]
    fn commit_skips_a_row_that_became_a_duplicate_since_the_preview() {
        let conn = setup();
        let plan = preview(&conn, "Name,Code\nA,P1\nB,P2\n");
        let inputs: Vec<ProjectInput> = plan.to_create.iter().map(input).collect();

        create_project(
            &conn,
            &ProjectInput { name: "Snuck in".into(), code: "P1".into(), program: None, is_active: true },
        )
        .unwrap();

        let outcome = commit_project_import(&conn, &inputs).unwrap();

        assert_eq!(outcome.created, 1, "P2 must still be created");
        assert_eq!(outcome.skipped, 1);
        let existing = list_projects(&conn)
            .unwrap()
            .into_iter()
            .find(|p| p.code == "P1")
            .unwrap();
        assert_eq!(existing.name, "Snuck in", "the row that got there first must survive");
    }

    #[test]
    fn committing_an_empty_plan_is_a_no_op() {
        let conn = setup();

        let outcome = commit_project_import(&conn, &[]).unwrap();

        assert_eq!(outcome.created, 0);
        assert_eq!(list_projects(&conn).unwrap().len(), 0);
    }
}
