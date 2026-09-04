// Ties the two halves of the split together: `migrate` copies the legacy
// *file* into place, then `schema` runs the *migrations* against it.
pub mod assignment;
pub mod categories;
pub mod error;
pub mod event_types;
pub mod events;
pub mod migrate;
pub mod models;
pub mod rules;
pub mod schema;
pub mod sync;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use error::{DbError, DbResult};

/// The connection, shared. An Arc rather than a bare Mutex because every
/// command clones it into `spawn_blocking` — rusqlite is synchronous, and a
/// query over a 30MB database must not run on the IPC thread.
#[derive(Clone)]
pub struct Db(pub Arc<Mutex<Connection>>);

impl Db {
    /// Runs the caller's closure against the connection on a blocking thread.
    pub async fn call<T, F>(&self, f: F) -> DbResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> DbResult<T> + Send + 'static,
    {
        let handle = self.0.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let conn = handle.lock().map_err(|_| DbError::Unavailable)?;
            f(&conn)
        })
        .await
        .map_err(|e| DbError::Other(format!("database task failed: {e}")))?
    }
}

/// Opens the database, copying a legacy one into place on first run, then
/// migrating and seeding. `legacy_candidates` are searched in order.
pub fn open(app_data_dir: &Path, legacy_candidates: &[PathBuf]) -> DbResult<Db> {
    let target = app_data_dir.join("calendar.db");

    if migrate::copy_legacy_if_needed(&target, legacy_candidates)? {
        eprintln!("Copied a legacy database into {}", target.display());
    }

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let conn = Connection::open(&target)?;

    // Lock contention — a second instance, a backup agent, a transient
    // SQLITE_BUSY on the file this session just renamed into place — should
    // make SQLite retry for a while rather than fail the very next
    // statement instantly.
    if let Err(e) = conn.execute_batch("PRAGMA busy_timeout = 5000;") {
        eprintln!("Warning: could not set busy_timeout for {}: {e}", target.display());
    }

    // query_row, not pragma_update or execute_batch: PRAGMA journal_mode
    // returns the mode SQLite actually entered, and that's worth reading back
    // — a network share or a read-only volume can silently refuse WAL, and
    // failing to notice would be silent. Not an error: the app still works
    // in `delete` mode, just without WAL's concurrency benefits. The query
    // itself failing (e.g. a transient SQLITE_BUSY on the freshly renamed
    // file) must not be an error either — that would kill `db::open` for the
    // entire session over what a retry (now backed by the busy_timeout just
    // set) would have ridden out.
    match conn.query_row::<String, _, _>("PRAGMA journal_mode = WAL;", [], |row| row.get(0)) {
        Ok(journal_mode) if journal_mode.eq_ignore_ascii_case("wal") => {}
        Ok(journal_mode) => {
            eprintln!(
                "Warning: expected WAL journal mode for {}, got '{journal_mode}' instead",
                target.display()
            );
        }
        Err(e) => {
            eprintln!("Warning: could not enter WAL journal mode for {}: {e}", target.display());
        }
    }
    schema::run_migrations(&conn)?;
    schema::seed_default_event_type(&conn)?;

    Ok(Db(Arc::new(Mutex::new(conn))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cm-db-open-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The composition of `migrate::copy_legacy_if_needed` and
    /// `schema::run_migrations` — exactly what runs against the real 30MB
    /// database on first launch, which neither module's own tests exercise
    /// together.
    #[test]
    fn open_copies_migrates_and_leaves_the_source_untouched() {
        let legacy_dir = temp_dir("legacy");
        let app_dir = temp_dir("app");
        let legacy_path = legacy_dir.join("calendar.db");

        // A real legacy-shaped database: full schema, version 0, plus the
        // rows that matter most — a type, a rule, a category, and a manual
        // override — none of which Microsoft Graph can recreate.
        {
            let conn = Connection::open(&legacy_path).unwrap();
            conn.execute_batch(super::schema::LEGACY_SCHEMA_FOR_TESTS).unwrap();
            conn.execute(
                "INSERT INTO event_types (name, color, is_default, is_billable) VALUES ('Consulting', '#ff0000', 1, 1)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO event_type_rules (name, priority, field_name, operator, value, target_type_id) \
                 VALUES ('Consulting keyword', 1, 'title', 'contains', 'Consulting', 1)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO categories (name, color) VALUES ('Client Work', '#00ff00')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO events (graph_id, title, start_date, is_all_day, show_as, categories, type_id, type_manually_set) \
                 VALUES ('g1', 'Standup', '2026-01-01T09:00:00', 0, 'busy', '', 1, 1)",
                [],
            )
            .unwrap();
        }
        let source_len_before = fs::metadata(&legacy_path).unwrap().len();

        let db = open(&app_dir, &[legacy_path.clone()]).unwrap();
        let conn = db.0.lock().unwrap();

        let type_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM event_types", [], |r| r.get(0))
            .unwrap();
        assert_eq!(type_count, 1, "seeding must not have added a second type");

        let rule_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM event_type_rules", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rule_count, 1);

        let category_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))
            .unwrap();
        assert_eq!(category_count, 1);

        let (title, manual): (String, bool) = conn
            .query_row(
                "SELECT title, type_manually_set FROM events WHERE graph_id = 'g1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(title, "Standup");
        assert!(manual, "the manual override must survive the migration");

        let version: i64 = conn
            .query_row("SELECT * FROM pragma_user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, schema::SCHEMA_VERSION);

        drop(conn);

        // The user's original must never be modified.
        let source_len_after = fs::metadata(&legacy_path).unwrap().len();
        assert_eq!(source_len_before, source_len_after);

        fs::remove_dir_all(&legacy_dir).ok();
        fs::remove_dir_all(&app_dir).ok();
    }
}
