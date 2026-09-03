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
