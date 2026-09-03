# Tauri Migration M3: Rust Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the SQLite database into Rust with a real migration runner, port all 20 database commands, and copy the existing 30MB database into the app data directory on first run — so the calendar, settings and event-type screens work again.

**Architecture:** A `rusqlite` connection behind `Arc<Mutex<Connection>>` in Tauri state. Every command is `async` and does its query inside `spawn_blocking`, so a long query never blocks the IPC thread. Schema evolution moves from ten swallowed `ALTER TABLE` exceptions to a versioned runner keyed on `PRAGMA user_version`. Event-type rule evaluation becomes a pure, exhaustively-tested function with no database access.

**Tech Stack:** Rust (`rusqlite` with `bundled`, `serde`, `thiserror`), Tauri v2, React 19.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-03-electron-to-tauri-migration-design.md`. This plan implements the **data layer** milestone (M3 after the M2/M3 reorder recorded there). Read its "Data layer" section.
- **Branch:** `feat/tauri-migration`. Do not merge to `main` — `main` still holds the working Electron app.
- **The source of truth for every ported behaviour is `git show ca805d0:electron/main.js`.** That file was deleted in this branch; recover it from history rather than guessing. It holds all 28 original IPC handlers.
- **Bundle identifier `com.triowfs.calendarmanager` is permanent.** `app_data_dir()` derives from it and this milestone's migration keys off that path.
- **Domain field names are `snake_case`, not camelCase.** `src/types/index.ts` already defines `Event`, `Category`, `EventType` and `EventTypeRule` with snake_case fields (`start_date`, `is_all_day`, `type_manually_set`, `target_type_id`) matching the database columns, and the calendar components read them directly. Rust structs therefore serialize with serde's default snake_case and **no `rename_all`**. Only *command names* follow the snake_case-Rust / camelCase-`src/api` convention. Do not "fix" the field names — doing so would break every calendar component.
- **Every command that touches the database must be `async fn` and run its query inside `tauri::async_runtime::spawn_blocking`.** A non-async command body runs inline on the IPC thread; `reprocess_event_types` over a 30MB database would stall it. This is why the connection is `Arc<Mutex<Connection>>` rather than a bare `Mutex` — the `Arc` clones into the blocking closure.
- WAL mode stays enabled, as it was at `main.js:70`.
- **Do not touch** `src/components/calendar/`, `src/utils/`, `src/hooks/`, or `src/contexts/` **except** where a task explicitly names a file.

### Data safety — read before Task 1

Your real database is 30MB and holds event types, type rules and manual type
overrides that **Microsoft Graph cannot recreate**. A backup exists at
`~/calendar.db.backup-pre-tauri` (30,625,792 bytes, verified). Task 1 Step 1
re-verifies it. If it is missing, stop.

`electron/main.js` was the only thing that ever opened `calendar.db`, and it is
deleted — so between M1 and this milestone the file is both apparently dead and
the only live copy. It is gitignored, so `git clean -xdf` would destroy it.

### Expected intermediate state

- **Sync stays broken.** `src/services/calendar.ts` is untouched, still 715 lines, still calling `window.electronAPI.syncGraphEvents`. M4 replaces it. The sync button will error.
- `syncGraphEvents` is **not** among the 20 commands — the spec makes it internal to M4's Rust sync pipeline. Do not port it.
- `npx tsc --noEmit` is not clean and never has been. Baseline is **111** errors (108 pre-existing plus three `getGraphClient` errors in `calendar.ts` from M2). Judge by baseline. Task 6 should *reduce* it.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `src-tauri/src/db/mod.rs` | `Db(Arc<Mutex<Connection>>)` in Tauri state; open + init |
| `src-tauri/src/db/schema.rs` | Versioned migrations on `PRAGMA user_version` |
| `src-tauri/src/db/migrate.rs` | One-time legacy `calendar.db` copy |
| `src-tauri/src/db/models.rs` | `Event`, `Category`, `EventType`, `EventTypeRule` |
| `src-tauri/src/db/rules.rs` | Pure rule evaluation, exhaustively tested |
| `src-tauri/src/db/events.rs` | Event queries |
| `src-tauri/src/db/categories.rs` | Category queries |
| `src-tauri/src/db/event_types.rs` | Event-type and rule queries |
| `src-tauri/src/db/assignment.rs` | Evaluate, manual set, reprocess |
| `src-tauri/src/commands/db.rs` | The 20 `#[tauri::command]` wrappers |
| `src/api/events.ts`, `eventTypes.ts`, `rules.ts` | Typed frontend wrappers |

**Modified:** `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`, and in Task 6: `src/components/calendar/CalendarView.tsx`, `src/components/calendar/EventModal.tsx`, `src/components/DataManagement.tsx`, `src/components/settings/EventTypeRulesSettings.tsx`, `src/components/settings/EventTypesSettings.tsx`, `src/types/index.ts`, `src/test/setup.ts`.

---

### Task 1: Migrations and the legacy database copy

**This is the highest-risk task in the whole migration.** Everything else can be redone; a botched migration loses data that Graph cannot rebuild.

**Files:**
- Create: `src-tauri/src/db/mod.rs`, `db/schema.rs`, `db/migrate.rs`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`
- Test: inline `#[cfg(test)]` in `schema.rs` and `migrate.rs`

**Interfaces produced:**
- `pub struct Db(pub Arc<Mutex<Connection>>)`
- `pub fn open(app_data_dir: &Path, legacy_candidates: &[PathBuf]) -> Result<Db, DbError>` — copies a legacy database if needed, opens, sets WAL, runs migrations, seeds the default event type.
- `pub fn run_migrations(conn: &Connection) -> Result<(), DbError>`
- `pub fn copy_legacy_if_needed(target: &Path, candidates: &[PathBuf]) -> Result<bool, DbError>`
- `pub enum DbError` implementing `std::error::Error` and `serde::Serialize` (serializing to its `Display` string, exactly as `AuthError` does in `src-tauri/src/auth/error.rs` — follow that file's pattern).

- [ ] **Step 1: Verify the backup before writing any code**

```bash
ls -la ~/calendar.db.backup-pre-tauri && ls -la calendar.db
```

Both must be 30,625,792 bytes. **If the backup is missing or a different size, stop and report.** Do not proceed.

- [ ] **Step 2: Create the error type and module tree first**

`schema.rs` and `migrate.rs` both `use super::error::DbError`, and a test file
that is not registered as a module is not compiled at all — so these must exist
before the RED steps, or Step 4 reports "0 tests filtered out" instead of the
compile error it expects. (This is the same ordering trap the auth milestone hit.)

Create `src-tauri/src/db/error.rs`, following `src-tauri/src/auth/error.rs`'s
pattern exactly — a `thiserror` enum plus a hand-written `Serialize` emitting
the `Display` string. The spec's M1-review follow-ups ask for a structured error
type rather than the `Result<_, String>` shape used earlier, and this is it:

```rust
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("Could not access the database file: {0}")]
    Io(#[from] std::io::Error),

    #[error("Database is unavailable")]
    Unavailable,

    #[error("{0}")]
    Other(String),
}

impl Serialize for DbError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type DbResult<T> = Result<T, DbError>;
```

Create `src-tauri/src/db/mod.rs` with just the declarations for now:

```rust
pub mod error;
pub mod migrate;
pub mod schema;
```

Add `mod db;` to `src-tauri/src/lib.rs` beside the existing `mod auth;`. Then
create empty `schema.rs` and `migrate.rs` so the crate compiles before you add
their tests. Step 11 fills in the rest of `mod.rs`.

- [ ] **Step 3: Add rusqlite**

In `src-tauri/Cargo.toml` `[dependencies]`:

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
```

`bundled` compiles SQLite from source into the binary. That is the point: it removes the `better-sqlite3` + `electron-rebuild` native-module step this migration exists to escape, and guarantees the SQLite version is the one we tested against.

- [ ] **Step 4: Write the failing migration tests**

Create `src-tauri/src/db/schema.rs` with only the test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn columns(conn: &Connection, table: &str) -> Vec<String> {
        conn.prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    fn user_version(conn: &Connection) -> i64 {
        conn.query_row("SELECT * FROM pragma_user_version", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn a_fresh_database_gets_every_table() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        for table in ["events", "categories", "event_types", "event_type_rules"] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "table {table} was not created");
        }
    }

    #[test]
    fn a_fresh_database_gets_every_events_column() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let cols = columns(&conn, "events");
        for expected in [
            "id", "graph_id", "title", "description", "start_date", "end_date",
            "is_all_day", "show_as", "categories", "location", "organizer",
            "attendees", "is_meeting", "type_id", "type_manually_set",
            "created_at", "updated_at", "synced_at",
        ] {
            assert!(cols.contains(&expected.to_string()), "events lacks {expected}");
        }
    }

    #[test]
    fn a_fresh_database_gets_the_indexes() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        for index in [
            "idx_events_graph_id",
            "idx_events_start_date",
            "idx_events_date_range",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
                    [index],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "index {index} was not created");
        }
    }

    #[test]
    fn migrations_stamp_the_user_version() {
        let conn = Connection::open_in_memory().unwrap();
        assert_eq!(user_version(&conn), 0);

        run_migrations(&conn).unwrap();

        assert_eq!(user_version(&conn), SCHEMA_VERSION);
    }

    #[test]
    fn migrations_are_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let before = columns(&conn, "events");

        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();

        assert_eq!(columns(&conn, "events"), before);
        assert_eq!(user_version(&conn), SCHEMA_VERSION);
    }

    /// The case that matters most: the real 30MB database has every column
    /// already and a user_version of 0, because the Electron code never set
    /// one. Migration must recognise that and not fail or duplicate anything.
    #[test]
    fn a_legacy_shaped_database_passes_through_untouched() {
        let conn = Connection::open_in_memory().unwrap();

        // Exactly what electron/main.js left behind: full schema, version 0.
        conn.execute_batch(LEGACY_SCHEMA_FOR_TESTS).unwrap();
        conn.execute(
            "INSERT INTO event_types (name, color, is_default, is_billable) VALUES ('Consulting', '#ff0000', 1, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO events (graph_id, title, start_date, is_all_day, show_as, categories, type_id, type_manually_set) \
             VALUES ('g1', 'Standup', '2026-01-01T09:00:00', 0, 'busy', '', 1, 1)",
            [],
        )
        .unwrap();
        assert_eq!(user_version(&conn), 0);

        run_migrations(&conn).unwrap();

        // Data survived.
        let title: String = conn
            .query_row("SELECT title FROM events WHERE graph_id = 'g1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Standup");

        // The hand-configured type survived and was not displaced by seeding.
        let type_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM event_types", [], |r| r.get(0))
            .unwrap();
        assert_eq!(type_count, 1);
        let type_name: String = conn
            .query_row("SELECT name FROM event_types WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(type_name, "Consulting");

        // The manual override survived — Graph cannot recreate this.
        let manual: bool = conn
            .query_row("SELECT type_manually_set FROM events WHERE graph_id='g1'", [], |r| r.get(0))
            .unwrap();
        assert!(manual);

        assert_eq!(user_version(&conn), SCHEMA_VERSION);
    }

    #[test]
    fn seeding_adds_the_default_type_only_when_empty() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        seed_default_event_type(&conn).unwrap();

        let (name, is_default, is_billable): (String, bool, bool) = conn
            .query_row(
                "SELECT name, is_default, is_billable FROM event_types",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(name, "Work");
        assert!(is_default);
        assert!(is_billable);

        // Running again must not add a second one.
        seed_default_event_type(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM event_types", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn seeding_leaves_an_existing_type_alone() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO event_types (name, color, is_default, is_billable) VALUES ('Billable', '#123456', 1, 1)",
            [],
        )
        .unwrap();

        seed_default_event_type(&conn).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM event_types", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
```

- [ ] **Step 5: Run the tests to verify they fail**

```bash
cd src-tauri && cargo test db::schema
```

Expected: FAIL to compile — `cannot find function run_migrations`, `cannot find value SCHEMA_VERSION`, `cannot find value LEGACY_SCHEMA_FOR_TESTS`, `cannot find function seed_default_event_type`.

- [ ] **Step 6: Write the migration runner**

Prepend to `src-tauri/src/db/schema.rs`. Recover the exact DDL from
`git show ca805d0:electron/main.js` lines 65-196 — column names, defaults and
index definitions must match byte-for-byte, because the real database was built
by that code:

```rust
use rusqlite::Connection;

use super::error::DbError;

/// Bumped whenever a migration is added. Stored in SQLite's built-in
/// PRAGMA user_version, so no bookkeeping table is needed.
pub const SCHEMA_VERSION: i64 = 1;

/// Migration 1 is the complete schema as electron/main.js left it. It is
/// written to be idempotent — CREATE TABLE IF NOT EXISTS, and column adds
/// guarded by an actual pragma_table_info check rather than a swallowed
/// exception — so the real database, which already has every column and a
/// user_version of 0, passes through unchanged and is simply stamped.
const MIGRATION_1: &str = r#"
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      graph_id TEXT UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT,
      is_all_day BOOLEAN DEFAULT 0,
      show_as TEXT DEFAULT 'busy',
      categories TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      synced_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#1890ff',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS event_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#1890ff',
      is_default BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS event_type_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      priority INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      operator TEXT NOT NULL,
      value TEXT,
      target_type_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(target_type_id) REFERENCES event_types(id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_graph_id ON events(graph_id);
    CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date);
    CREATE INDEX IF NOT EXISTS idx_events_date_range ON events(start_date, end_date);
"#;

/// Columns electron/main.js added after the fact, each in its own guarded
/// ALTER. Kept as data rather than SQL text so the guard is a real check.
const MIGRATION_1_COLUMNS: &[(&str, &str, &str)] = &[
    ("events", "location", "TEXT"),
    ("events", "organizer", "TEXT"),
    ("events", "attendees", "TEXT"),
    ("events", "is_meeting", "BOOLEAN DEFAULT 0"),
    ("events", "type_id", "INTEGER REFERENCES event_types(id)"),
    ("events", "type_manually_set", "BOOLEAN DEFAULT 0"),
    ("event_types", "is_billable", "BOOLEAN DEFAULT 0"),
];

/// The schema exactly as electron/main.js produced it, for tests that need to
/// simulate the real 30MB database's shape.
#[cfg(test)]
pub const LEGACY_SCHEMA_FOR_TESTS: &str = r#"
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      graph_id TEXT UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT,
      is_all_day BOOLEAN DEFAULT 0,
      show_as TEXT DEFAULT 'busy',
      categories TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      synced_at DATETIME,
      location TEXT,
      organizer TEXT,
      attendees TEXT,
      is_meeting BOOLEAN DEFAULT 0,
      type_id INTEGER REFERENCES event_types(id),
      type_manually_set BOOLEAN DEFAULT 0
    );
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#1890ff',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE event_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#1890ff',
      is_default BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_billable BOOLEAN DEFAULT 0
    );
    CREATE TABLE event_type_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      priority INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      operator TEXT NOT NULL,
      value TEXT,
      target_type_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(target_type_id) REFERENCES event_types(id)
    );
    CREATE INDEX idx_events_graph_id ON events(graph_id);
    CREATE INDEX idx_events_start_date ON events(start_date);
    CREATE INDEX idx_events_date_range ON events(start_date, end_date);
"#;

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, DbError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        rusqlite::params![table, column],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

pub fn run_migrations(conn: &Connection) -> Result<(), DbError> {
    let version: i64 = conn.query_row("SELECT * FROM pragma_user_version", [], |row| row.get(0))?;

    if version >= SCHEMA_VERSION {
        return Ok(());
    }

    conn.execute_batch(MIGRATION_1)?;

    for (table, column, definition) in MIGRATION_1_COLUMNS {
        if !has_column(conn, table, column)? {
            conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition};"))?;
        }
    }

    // pragma_user_version cannot be parameterised.
    conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;

    Ok(())
}

/// Gives a brand-new database one usable event type. Deliberately separate
/// from migrations: it is seed data, not schema, and must never touch a
/// database that already has types the user configured.
pub fn seed_default_event_type(conn: &Connection) -> Result<(), DbError> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM event_types", [], |row| row.get(0))?;
    if count == 0 {
        conn.execute(
            "INSERT INTO event_types (name, color, is_default, is_billable) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["Work", "#52c41a", 1, 1],
        )?;
    }
    Ok(())
}
```

Note the version guard means a v0 legacy database still runs migration 1 — which
is exactly right, because migration 1 is idempotent and the legacy database
needs stamping. A database already at v1 skips it entirely.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd src-tauri && cargo test db::schema
```

Expected: PASS, 8 tests. `a_legacy_shaped_database_passes_through_untouched` is
the one that stands between you and losing the user's data — if it fails, stop
and diagnose rather than adjusting the test.

- [ ] **Step 8: Write the failing legacy-copy tests**

Create `src-tauri/src/db/migrate.rs` with only the test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cm-migrate-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn copies_the_first_candidate_that_exists() {
        let dir = temp_dir("copy");
        let legacy = dir.join("legacy.db");
        fs::write(&legacy, b"legacy-bytes").unwrap();
        let target = dir.join("app").join("calendar.db");

        let copied = copy_legacy_if_needed(&target, &[legacy.clone()]).unwrap();

        assert!(copied);
        assert_eq!(fs::read(&target).unwrap(), b"legacy-bytes");
        // The original must survive — it is the user's only other copy.
        assert!(legacy.exists());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copies_the_wal_and_shm_sidecars_too() {
        let dir = temp_dir("sidecars");
        let legacy = dir.join("legacy.db");
        fs::write(&legacy, b"main").unwrap();
        fs::write(dir.join("legacy.db-wal"), b"wal").unwrap();
        fs::write(dir.join("legacy.db-shm"), b"shm").unwrap();
        let target = dir.join("app").join("calendar.db");

        copy_legacy_if_needed(&target, &[legacy]).unwrap();

        assert_eq!(fs::read(dir.join("app").join("calendar.db-wal")).unwrap(), b"wal");
        assert_eq!(fs::read(dir.join("app").join("calendar.db-shm")).unwrap(), b"shm");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn does_nothing_when_the_target_already_exists() {
        let dir = temp_dir("exists");
        let legacy = dir.join("legacy.db");
        fs::write(&legacy, b"legacy").unwrap();
        let target = dir.join("calendar.db");
        fs::write(&target, b"current").unwrap();

        let copied = copy_legacy_if_needed(&target, &[legacy]).unwrap();

        assert!(!copied);
        // Critically: the live database was NOT overwritten.
        assert_eq!(fs::read(&target).unwrap(), b"current");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn does_nothing_when_no_candidate_exists() {
        let dir = temp_dir("none");
        let target = dir.join("calendar.db");

        let copied = copy_legacy_if_needed(&target, &[dir.join("nope.db")]).unwrap();

        assert!(!copied);
        assert!(!target.exists());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn prefers_the_earlier_candidate() {
        let dir = temp_dir("order");
        let first = dir.join("first.db");
        let second = dir.join("second.db");
        fs::write(&first, b"first").unwrap();
        fs::write(&second, b"second").unwrap();
        let target = dir.join("app").join("calendar.db");

        copy_legacy_if_needed(&target, &[first, second]).unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"first");

        fs::remove_dir_all(&dir).ok();
    }
}
```

- [ ] **Step 9: Run the tests to verify they fail**

```bash
cd src-tauri && cargo test db::migrate
```

Expected: FAIL to compile — `cannot find function copy_legacy_if_needed`.

- [ ] **Step 10: Write the legacy copy**

Prepend to `src-tauri/src/db/migrate.rs`:

```rust
use std::fs;
use std::path::{Path, PathBuf};

use super::error::DbError;

/// SQLite's WAL sidecars. Copying the main file alone could lose committed
/// transactions that still live in the write-ahead log.
const SIDECAR_SUFFIXES: [&str; 2] = ["-wal", "-shm"];

/// Copies a legacy database into place if there is nothing at `target` yet.
/// Returns whether a copy happened.
///
/// The original is never moved or deleted: it is the user's only other copy of
/// event types, rules and manual overrides that Microsoft Graph cannot
/// recreate. An existing `target` is never overwritten, so this cannot clobber
/// a live database.
pub fn copy_legacy_if_needed(target: &Path, candidates: &[PathBuf]) -> Result<bool, DbError> {
    if target.exists() {
        return Ok(false);
    }

    let Some(source) = candidates.iter().find(|candidate| candidate.exists()) else {
        return Ok(false);
    };

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::copy(source, target)?;

    for suffix in SIDECAR_SUFFIXES {
        let sidecar_source = with_suffix(source, suffix);
        if sidecar_source.exists() {
            fs::copy(&sidecar_source, with_suffix(target, suffix))?;
        }
    }

    Ok(true)
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}
```

- [ ] **Step 11: Run the tests to verify they pass**

```bash
cd src-tauri && cargo test db::migrate
```

Expected: PASS, 5 tests.

- [ ] **Step 12: Add the connection holder**

Fill in `src-tauri/src/db/mod.rs` (created in Step 2):

```rust
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
```

- [ ] **Step 13: Wire it into the app**

In `src-tauri/src/lib.rs`: add `mod db;`, and inside the existing `setup` hook
(preserve the window-show fallback already there), resolve the paths and manage
the `Db`:

```rust
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("no app data dir: {e}"))?;

            // Where electron/main.js kept it: the repo root, i.e. the parent of
            // src-tauri during development. Also check beside the executable,
            // which is where a packaged Electron build would have left it.
            let mut legacy = Vec::new();
            if let Ok(cwd) = std::env::current_dir() {
                legacy.push(cwd.join("calendar.db"));
                legacy.push(cwd.join("..").join("calendar.db"));
            }
            if let Ok(exe) = std::env::current_exe() {
                if let Some(dir) = exe.parent() {
                    legacy.push(dir.join("calendar.db"));
                }
            }

            app.manage(db::open(&app_data_dir, &legacy)?);
```

- [ ] **Step 14: Verify the whole crate**

```bash
cd src-tauri && cargo test
```

Expected: 54 existing tests plus 13 new (8 schema + 5 migrate) = **67**, all passing.

- [ ] **Step 15: Confirm the real database is untouched**

```bash
ls -la calendar.db && ls -la ~/calendar.db.backup-pre-tauri
```

Both still 30,625,792 bytes. Nothing in this task should have opened the real
file — the copy only happens at app startup, which you are not running.

- [ ] **Step 16: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/db/ src-tauri/src/lib.rs
git commit -m "feat(db): add the migration runner and legacy database copy

Replaces ten swallowed try/catch ALTER TABLE blocks with a runner keyed on
SQLite's built-in PRAGMA user_version. Migration 1 is the complete schema
as electron/main.js left it, written idempotently — CREATE TABLE IF NOT
EXISTS and column adds guarded by a real pragma_table_info check — so the
existing 30MB database, which has every column and a user_version of 0,
passes through unchanged and is simply stamped. Errors now propagate
instead of vanishing.

The database also moves from the repo root to the app data directory,
fixing the packaging bug where it lived beside the source. A legacy copy
runs once on first launch, never overwrites an existing target, never
moves or deletes the original, and brings the WAL sidecars along so no
committed transaction is lost.

Seeding the default Work type is deliberately separate from migration: it
is seed data, and must never touch a database that already has types the
user configured. Thirteen tests cover this, including one that asserts a
legacy-shaped database keeps its events, its hand-configured type and its
manual overrides — the data Graph cannot recreate."
```

---

### Task 2: Rule evaluation as a pure function

**Files:**
- Create: `src-tauri/src/db/models.rs`, `src-tauri/src/db/rules.rs`
- Modify: `src-tauri/src/db/mod.rs`
- Test: inline in `rules.rs`

**Interfaces produced:**
- In `models.rs`: `Event`, `Category`, `EventType`, `EventTypeRule` — all `Serialize`/`Deserialize` with **serde's default snake_case field names** (no `rename_all`), matching `src/types/index.ts`. Each with a `from_row(&rusqlite::Row) -> rusqlite::Result<Self>`.
- In `rules.rs`: `pub struct EventFields { pub title: String, pub is_all_day: bool, pub show_as: String, pub categories: String }` and `pub fn evaluate(rules: &[EventTypeRule], fields: &EventFields, default_type_id: Option<i64>) -> Option<i64>`.

**Semantics to port exactly** from `git show ca805d0:electron/main.js` lines 716-772:

- Fields: `title`, `is_all_day` (compared as the strings `"true"`/`"false"`), `show_as`, `categories`. Any other field name → the rule does not match.
- Operators: `equals` (exact, against `rule.value` or `""` when null), `contains` (case-insensitive substring), `is_empty` (true when the field is empty or whitespace-only). Any other operator → no match.
- Rules are evaluated in the order given; the first match wins and returns its `target_type_id`.
- No match → `default_type_id`.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/db/rules.rs` with only the test module. Write a test for
each of these, using a small helper to build a rule:

1. `equals` matches an exact title and returns that rule's `target_type_id`.
2. `equals` does not match a different title.
3. `equals` treats a null `value` as `""` and so matches an empty title.
4. `contains` matches case-insensitively (`"STANDUP"` in title `"Daily standup"`).
5. `contains` does not match an absent substring.
6. `is_empty` matches an empty `categories`.
7. `is_empty` matches whitespace-only `categories` (`"   "`).
8. `is_empty` does not match non-empty `categories`.
9. `is_all_day` matches `equals` with `value = "true"` when the flag is set.
10. `is_all_day` matches `equals` with `value = "false"` when the flag is clear.
11. An unknown `field_name` never matches.
12. An unknown `operator` never matches.
13. The first matching rule wins even when a later rule would also match — assert the returned id is the earlier rule's.
14. No matching rule returns `default_type_id`.
15. An empty rule list returns `default_type_id`.
16. No match and `default_type_id = None` returns `None`.

- [ ] **Step 2: Run to verify failure**

```bash
cd src-tauri && cargo test db::rules
```

Expected: FAIL to compile — `cannot find function evaluate`, `cannot find type EventFields`.

- [ ] **Step 3: Implement**

Write `models.rs` (structs plus `from_row`) and the evaluation in `rules.rs`.
Use `match` on `field_name` and `operator` rather than chained `if`s — this is
the direct Rust translation of the original's two `switch` statements. Return
`false` from the fall-through arms so an unrecognised field or operator can
never accidentally match.

- [ ] **Step 4: Run to verify pass**

```bash
cd src-tauri && cargo test db::rules
```

Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/
git commit -m "feat(db): port rule evaluation as a pure, exhaustively tested function

evaluateRule and evaluateEventTypeSync took a database handle and were
reachable only through IPC, so nothing about them was tested. They are now
one function over a slice of rules and a struct of event fields, with no
database access at all, and sixteen tests pin every field, every operator
and the fall-through arms.

Semantics are ported unchanged: contains stays case-insensitive, is_empty
stays whitespace-trimming, is_all_day is still compared as the strings
true/false, an unrecognised field or operator still fails to match, and
the first matching rule by priority still wins with the default type as
the fallback."
```

---

> **A deliberate deviation, stated rather than hidden.** Tasks 1, 2 and 7 give
> literal test code. Tasks 3 through 6 instead specify each test as an
> enumerated case naming its input and expected outcome, and point at the exact
> line in `git show ca805d0:electron/main.js` that defines the behaviour. That
> is a departure from this plan format's usual rule of showing every line of
> test code. The reason: these tasks port 20 largely mechanical CRUD commands,
> the original implementation is the precise specification, and inlining ~600
> lines of invented test code would make the plan harder to follow without
> making the requirement clearer. If any enumerated case is ambiguous when you
> reach it, stop and ask rather than guessing.

### Task 3: Event and category commands

**Files:**
- Create: `src-tauri/src/db/events.rs`, `db/categories.rs`, `src-tauri/src/commands/db.rs`
- Modify: `src-tauri/src/db/mod.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

**Seven commands**, each an `async fn` using `Db::call`. Port each from
`git show ca805d0:electron/main.js` — the line numbers are given so you can
compare behaviour directly:

| Command | Original | Notes |
| --- | --- | --- |
| `get_events` | 259 | `ORDER BY start_date`; booleans as real `bool` |
| `get_events_in_range` | 272 | **Port the WHERE clause verbatim.** See below. |
| `create_event` | 300 | Returns the row with its new `id` |
| `update_event` | 318 | Updates only the eight original columns; returns the event |
| `delete_event` | 337 | Returns whether a row changed |
| `get_categories` | 470 | `ORDER BY name` |
| `create_category` | 475 | Returns the row with its new `id` |

**On `get_events_in_range`:** the original compares ISO date strings
lexicographically, which is fragile if Graph ever returns mixed offset formats.
The spec explicitly decides to **port it faithfully** so that a behaviour change
cannot be mistaken for a Tauri regression. Keep the same three OR'd conditions
and the same six bound parameters. Do not improve it.

Boolean coercion disappears: the original mapped `Boolean(event.is_all_day)` in
every handler; rusqlite reads SQLite integers straight into `bool` fields on the
model structs.

- [ ] **Step 1: Write failing tests** in `events.rs` and `categories.rs` against an in-memory database created with `run_migrations`. Cover, at minimum: a created event round-trips every field; `get_events` orders by `start_date`; `delete_event` returns false for a missing id; `update_event` leaves `graph_id` and `type_id` untouched; and for the range query — an event starting inside the range, one ending inside it, one spanning the whole range, one entirely outside it (excluded), and one with a NULL `end_date`.
- [ ] **Step 2: Run to verify failure.** `cd src-tauri && cargo test db::events db::categories`
- [ ] **Step 3: Implement** the query functions, then the seven command wrappers in `commands/db.rs`, then register them in `lib.rs`'s `generate_handler!`.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Verify the whole crate.** `cd src-tauri && cargo test` — all green, and report the total.
- [ ] **Step 6: Commit.** Write your own message: what these commands replace, and that the range query's string comparison was ported deliberately rather than fixed.

---

### Task 4: Event type and rule commands

**Files:** Create `src-tauri/src/db/event_types.rs`; modify `commands/db.rs`, `lib.rs`.

**Ten commands**, ported from `git show ca805d0:electron/main.js`:

| Command | Original | Notes |
| --- | --- | --- |
| `get_event_types` | 485 | `ORDER BY name` |
| `create_event_type` | 496 | |
| `update_event_type` | 515 | Returns `null` when no row changed |
| `delete_event_type` | 536 | **Behaviour change, user-approved.** See below. |
| `set_default_event_type` | 542 | **In one transaction:** clear all `is_default`, then set this one |
| `get_event_type_rules` | 564 | `ORDER BY priority ASC` |
| `create_event_type_rule` | 569 | |
| `update_event_type_rule` | 585 | Returns `null` when no row changed |
| `delete_event_type_rule` | 603 | |
| `update_rule_priorities` | 609 | **In one transaction:** priority = index + 1, in the given order |

**`delete_event_type` is no longer a literal port.** `rusqlite`'s bundled SQLite
is compiled with `-DSQLITE_DEFAULT_FOREIGN_KEYS=1`, so foreign keys are enforced
where `better-sqlite3` left them off. A bare `DELETE FROM event_types` therefore
now *fails* when events or rules still reference the type, rather than silently
orphaning them as Electron did. Measured against the real database: all 8,924
events carry a valid `type_id`, so with only 3 types every delete would fail.

Neither prior behaviour is right — Electron corrupted silently, and a bare error
just blocks the user with no way forward. So, in **one transaction**: reassign
affected events to the default type, delete rules targeting the type, then
delete the type. Return how many events were reassigned so the UI can say what
happened. If the type being deleted *is* the default and another type exists,
promote one to default first; if it is the only type, refuse with a clear error
rather than leaving the database with no default.

Both transactional commands must use a real `rusqlite` transaction so a partial
update cannot leave two default types or a broken priority ordering. The
original wrapped them in `db.transaction(...)` and returned `false` on error;
return `Err(DbError)` instead so the frontend sees why.

- [ ] **Step 1: Write failing tests.** Cover: creating a type round-trips `is_default`/`is_billable` as booleans; `set_default_event_type` leaves exactly one default when called twice with different ids; `update_rule_priorities` renumbers from 1 in the given order; `update_event_type` returns `None` for a missing id; rules come back ordered by priority.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** and register.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Verify the whole crate** and report the total.
- [ ] **Step 6: Commit** with your own message.

---

### Task 5: Assignment commands

**Files:** Create `src-tauri/src/db/assignment.rs`; modify `commands/db.rs`, `lib.rs`.

**Three commands**, ported from `git show ca805d0:electron/main.js`:

| Command | Original | Notes |
| --- | --- | --- |
| `evaluate_event_type` | 626 | Fetch rules + default, delegate to `rules::evaluate` |
| `set_event_type_manually` | 646 | Sets `type_id`, sets `type_manually_set = 1`, bumps `updated_at` |
| `reprocess_event_types` | 656 | See below |
| `reset_event_type_to_auto` | **new** | Fixes a pre-existing bug. See below. |

`reprocess_event_types` is the only one with real logic. Port it exactly:

- Select events where `type_manually_set = 0 OR type_manually_set IS NULL` — a
  manual override is never overwritten.
- Pre-fetch the rules and the default type **once**, before the loop.
- For each event, build the fields, evaluate, and **update only when the type
  actually changed**.
- Run the whole thing in one transaction.
- Return `{ success, processedCount, updatedCount, message }`. Note the frontend
  type at `src/types/index.ts:131` declares those two counts as **camelCase**,
  unlike the domain models — so this one struct does need
  `#[serde(rename_all = "camelCase")]`. The message format is
  `"Processed {processedCount} events, updated {updatedCount} event types"`.
- On error the original returned `{ success: false, error, message }` rather
  than throwing. Keep that shape so `DataManagement.tsx` still works.

**`reset_event_type_to_auto` is new, and it fixes a bug the port uncovered.**
`EventModal.tsx:90`'s "Reset to auto-assignment" calls `updateEvent` with
`type_id` and `type_manually_set: false` — but `main.js:318`'s `updateEvent`
only ever wrote eight columns and **never touched either field**. The reset
silently did nothing beyond a success toast and a local state update; it looked
like it worked until the next reload. Nothing does the inverse of
`set_event_type_manually`, so this command adds it:

```rust
/// Re-evaluates the rules for one event and clears its manual override, so the
/// event goes back to being auto-assigned. The inverse of
/// set_event_type_manually.
///
/// This is deliberately a command rather than something the frontend composes
/// out of update_event: update_event does not write type_id or
/// type_manually_set, which is exactly why the old "reset to auto" button
/// silently did nothing.
pub async fn reset_event_type_to_auto(db: State<'_, Db>, event_id: i64) -> DbResult<Option<i64>>
```

It must, inside **one transaction**: load the event's fields, load the rules and
default type, call `rules::evaluate`, then
`UPDATE events SET type_id = ?, type_manually_set = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`.
It returns the newly assigned type id, or `None` if the event does not exist.

- [ ] **Step 1: Write failing tests.** For `reset_event_type_to_auto`: it clears `type_manually_set`; it writes the type the rules select; it returns that type id; it returns `None` for a missing event id; and — the regression guard — an event that was manually set to type A, whose rules select type B, ends up with type B **and** `type_manually_set = 0`. Then for the rest: reprocess leaves a manually-set event's type alone; reprocess updates an event whose rule now points elsewhere; `updatedCount` counts only actual changes, so a no-op run reports `processedCount > 0` and `updatedCount == 0`; `set_event_type_manually` sets the flag; `evaluate_event_type` returns the default when no rule matches.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** and register. All 21 commands are now in `generate_handler!` (the 20 ported plus `reset_event_type_to_auto`) — count them.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Verify the whole crate** and report the total.
- [ ] **Step 6: Commit** with your own message, noting that the manual-override guard is the behaviour most worth preserving.

---

### Task 6: Frontend rewire and the end of `electronAPI`

**Files:**
- Create: `src/api/events.ts`, `src/api/eventTypes.ts`, `src/api/rules.ts`
- Modify: `src/components/calendar/CalendarView.tsx`, `src/components/calendar/EventModal.tsx`, `src/components/DataManagement.tsx`, `src/components/settings/EventTypeRulesSettings.tsx`, `src/components/settings/EventTypesSettings.tsx`, `src/types/index.ts`, `src/test/setup.ts`
- Test: the existing test files for those components

This is where `window.electronAPI` finally dies. Find every remaining call site:

```bash
grep -rn "electronAPI" src/ --include=*.ts --include=*.tsx
```

`src/services/calendar.ts` will still appear — **leave it alone**, it is M4's, and
its calls will still fail at runtime. Everything else moves to `src/api/`.

- [ ] **Step 1: Write the failing tests.** For each of the five components, retarget its existing test file's mocks from `window.electronAPI` to the relevant `src/api/` module, keeping the existing assertions. Run them and confirm they fail on the missing modules.
- [ ] **Step 2: Create the three `src/api/` modules**, following `src/api/config.ts`'s established shape: one file per domain, typed functions over `invoke`, camelCase names wrapping the snake_case commands, and the existing types from `src/types/index.ts` for the data.
- [ ] **Step 3: Update the five components** to import from `src/api/` instead of reaching for the global.

  **`EventModal.tsx`'s `handleResetToAutoAssign` needs a real change, not just
  an import swap.** It currently calls `evaluateEventType` and then
  `updateEvent(id, { ...event, type_id, type_manually_set: false })`, which
  never wrote either field. Replace the whole body with a single
  `resetEventTypeToAuto(event.id)` call, use its returned type id for
  `setSelectedTypeId`, and only show the success message when it returns a
  type. Keep the existing catch and its error message.
- [ ] **Step 4: Delete the `ElectronAPI` interface and the `declare global` block** from `src/types/index.ts`, keeping every domain type. Delete the `window.electronAPI` mock from `src/test/setup.ts`. Both existed only to keep the database surface compiling.
- [ ] **Step 5: Run the tests.** `cd /d/Dev/CalendarManager && pwd && npm run test:run` — **the `pwd` check matters**: run from a lowercase `d:` and the suite collects zero tests and reports "No test suite found in file". It must show `D:/Dev/CalendarManager`.
- [ ] **Step 6: Check the type-error count.** `npx tsc --noEmit 2>&1 | grep -c "error TS"` — expect **fewer than 111**, since deleting `ElectronAPI` removes the errors from components that used it. `calendar.ts` will gain errors where it referenced `window.electronAPI`; report the count and which file each new one is in.
- [ ] **Step 7: Commit** with your own message.

---

### Task 7: Config-store hardening and the abandoned electron-store config

The spec's M1-review follow-ups assign two items to this milestone. Both are
small, both concern persistent state, and neither belongs in a later one.

**Files:** Modify `src-tauri/src/commands/config.rs`, `src-tauri/src/lib.rs`; test inline.

**Problem 1 — a corrupt `config.json` is silently swallowed, then destroyed.**
`tauri-plugin-store`'s `build()` discards the deserialize error, so an
unparseable file yields an empty store: every read falls through to its default
and the user simply lands back on the setup screen with no indication anything
is wrong. The first write then truncates the bad file, destroying it. This is
the same failure shape the auth milestone fixed for the secret store, and it
matters more now: once a "legacy database already copied" marker lives in that
store, a silent reset of it would re-run the legacy copy against a live database.

`Store::reload()` **does** propagate the deserialize error, unlike `build()`.

**Problem 2 — nothing migrates the old `electron-store` config.** The Electron
app kept its config at `%APPDATA%/calendarmanager/config.json`; the Tauri app
uses `%APPDATA%/com.triowfs.calendarmanager/config.json`. The user re-enters the
client ID (they already have), but `timezone` and `syncConfig` are lost
silently — and a reset timezone means every event renders in the wrong zone
until somebody notices.

- [ ] **Step 1: Write the failing tests** for a pure helper that decides what to
  carry over, so the logic is testable without a Tauri app handle:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn carries_over_only_the_keys_we_recognise() {
        let legacy = json!({
            "appRegistrationId": "abc-123",
            "timezone": "Europe/London",
            "syncConfig": { "startDate": "2026-01-01", "endDate": "2026-01-31" },
            "somethingElse": 42
        });

        let carried = keys_to_carry_over(&legacy);

        assert_eq!(carried.len(), 3);
        assert_eq!(carried.get("timezone").unwrap(), "Europe/London");
        assert!(carried.contains_key("appRegistrationId"));
        assert!(carried.contains_key("syncConfig"));
        assert!(!carried.contains_key("somethingElse"));
    }

    #[test]
    fn skips_keys_that_are_absent() {
        let carried = keys_to_carry_over(&json!({ "timezone": "UTC" }));

        assert_eq!(carried.len(), 1);
        assert!(carried.contains_key("timezone"));
    }

    #[test]
    fn returns_nothing_for_a_non_object() {
        assert!(keys_to_carry_over(&json!("not an object")).is_empty());
        assert!(keys_to_carry_over(&json!(null)).is_empty());
    }
}
```

- [ ] **Step 2: Run to verify failure.** `cd src-tauri && cargo test config` — expected: `cannot find function keys_to_carry_over`.

- [ ] **Step 3: Implement `keys_to_carry_over`**, returning a
  `serde_json::Map<String, Value>` containing only `appRegistrationId`,
  `timezone` and `syncConfig` when present. Deliberately **not** `syncMetadata`:
  the spec records that nothing reads or writes it.

- [ ] **Step 4: Run to verify pass.** Three tests.

- [ ] **Step 5: Add the corrupt-store guard** in the `setup` hook in `lib.rs`,
  before the database is opened: call `store.reload()` once and, on `Err`,
  rename `config.json` to `config.json.corrupt` (overwriting any previous one)
  before continuing, so the bad bytes survive for diagnosis rather than being
  overwritten by the first write. Mirror what `auth/secret_store.rs` does for
  the token file, including preserving rather than deleting.

- [ ] **Step 6: Add the one-time config carry-over**, also in `setup`: if the new
  store has no `appRegistrationId` and a legacy `electron-store` file exists at
  `%APPDATA%/calendarmanager/config.json`, read it, apply `keys_to_carry_over`,
  write those keys, and save. Log what was carried. Never delete the legacy file.

- [ ] **Step 7: Verify.** `cd src-tauri && cargo test` — all green, report the total.

- [ ] **Step 8: Commit** with your own message, noting that the corrupt-store
  guard matters most because of the legacy-copy marker.

---

## Definition of Done

- [ ] `cd src-tauri && cargo test` — all green; report the total (expect roughly 100).
- [ ] `npm run test:run` — 368+ passing, run from an uppercase drive letter.
- [ ] All 20 commands registered in `generate_handler!`.
- [ ] `grep -rn "electronAPI" src/` returns hits only in `src/services/calendar.ts`.
- [ ] `calendar.db` and `~/calendar.db.backup-pre-tauri` are both still 30,625,792 bytes.

**Manual gate — only the user can run this:**

1. **Confirm the backup first:** `ls -la ~/calendar.db.backup-pre-tauri`
2. `npm start`, sign in, open the calendar. **Your real events appear.**
3. Check the copy landed: `ls -la "$APPDATA/com.triowfs.calendarmanager/calendar.db"` — about 30MB.
4. Settings → Event Types: your **hand-configured types** are listed, with the right colours and the right default.
5. Settings → Event Type Rules: your rules are listed **in priority order**. Drag one to reorder and confirm it sticks after a restart.
6. Find an event whose type you had set manually and confirm it **still has that type**.
7. Run "Reprocess event types" from Data Management and confirm the counts look sane and manual overrides survive.
8. Set an event's type by hand, then use **"Reset to auto-assignment"** on it,
   then **restart the app** and check the event again. It should still show the
   auto-assigned type. This never worked before — the reset was silently a
   no-op that reverted on reload — so this step is verifying a fix, not a port.
9. Expected still broken: **sync**. That is M4.

Step 6 is the one that matters most — manual overrides are the data Graph cannot recreate.

## Next

M4 (Rust sync engine) gets its own plan, written once this milestone lands.
