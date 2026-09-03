pub mod error;
pub mod migrate;
pub mod schema;

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
    // execute_batch, not pragma_update: journal_mode returns a row, and
    // pragma_update rejects a statement that produces results.
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    schema::run_migrations(&conn)?;
    schema::seed_default_event_type(&conn)?;

    Ok(Db(Arc::new(Mutex::new(conn))))
}
