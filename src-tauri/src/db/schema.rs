// This half of the split runs the *migrations* — DDL against an already-open
// connection. `migrate.rs` is the other half: it copies the legacy *file*
// into place before a connection is ever opened.

use rusqlite::Connection;

use super::error::DbError;

/// Bumped whenever a migration is added. Stored in SQLite's built-in
/// PRAGMA user_version, so no bookkeeping table is needed.
pub const SCHEMA_VERSION: i64 = 6;

/// Migration 1 is the complete schema as electron/main.js left it. It is
/// written to be idempotent — CREATE TABLE IF NOT EXISTS, and column adds
/// guarded by an actual pragma_table_info check rather than a swallowed
/// exception — so the real database, which already has every column and a
/// user_version of 0, passes through unchanged and is simply stamped.
///
/// It MUST stay idempotent: the ladder in `run_migrations` re-applies it in
/// full for a v0 database rather than skipping it, so it needs to behave
/// whether run against an empty database or the legacy one that already has
/// every table and column.
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

/// The shape a database *aged through* electron/main.js's guarded `ALTER`s
/// ends up with, for tests that need to simulate the real 30MB database.
/// This is not a claim about physical column order: main.js's final
/// `CREATE TABLE events` lists `location, organizer, attendees, is_meeting`
/// before `created_at`, while this fixture appends them after `synced_at`
/// instead — the real file's on-disk column order is unverified.
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

/// Migration 2 adds the `activities` table and seeds it.
///
/// Idempotent for the same reason migration 1 is: `run_migrations` re-applies
/// every migration from `version + 1` for a `user_version` 0 database, which
/// is exactly what the real legacy database still is. `CREATE TABLE IF NOT
/// EXISTS` plus `INSERT OR IGNORE` (against the UNIQUE name) means running it
/// twice is a no-op rather than a duplicate-key failure.
///
/// The seed also runs against that existing database, which is the intended
/// outcome — the alternative is a user staring at an empty list on the one
/// install that matters. A row deleted afterwards does not come back: once
/// `user_version` reaches 2 this never runs again.
const MIGRATION_2: &str = r#"
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#1890ff',
      is_active BOOLEAN NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO activities (name, color) VALUES
      ('Architecture',         '#2f54eb'),
      ('Customer Support',     '#13c2c2'),
      ('DevOps',               '#52c41a'),
      ('Leadership',           '#f5222d'),
      ('Maintenance',          '#fa8c16'),
      ('Manual Testing',       '#a0d911'),
      ('PI Planning',          '#faad14'),
      ('Product Management',   '#fa541c'),
      ('Software Development', '#1890ff'),
      ('Solution Design',      '#722ed1'),
      ('UX Design',            '#eb2f96');
"#;

/// Migration 3 adds the `projects` table.
///
/// Unlike migration 2 there is no seed: projects are the user's own data,
/// with no sensible starter set.
///
/// `code` is `UNIQUE` and carries the identity of a project; `name` is not,
/// because two projects under different programs may legitimately share one.
/// `program` is free text and nullable — a project need not belong to one.
///
/// Idempotent for the same reason the earlier migrations are: `run_migrations`
/// re-applies the whole ladder from `version + 1` for a `user_version` 0
/// database, which the real legacy database still is.
const MIGRATION_3: &str = r#"
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      program TEXT,
      is_active BOOLEAN NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
"#;

/// Migration 4 maps events onto projects and activities.
///
/// Two halves. The `events` columns say where an event was mapped, mirroring
/// `type_id`/`type_manually_set` exactly - a hand-mapped event is never
/// re-mapped by a rule. The `mapping_rules` table is how future events map
/// themselves.
///
/// A rule matches on an event's name, its categories, its event type, or any
/// combination - all supplied conditions must hold. `show_as` is deliberately
/// NOT a condition: the user marks client meetings away from the office as
/// out-of-office, so it means "not at my desk", not "not working". The
/// existing `event_type_rules` already fold `show_as = free` into the Info
/// type, so matching on `type_id` gets that signal second-hand, curated.
///
/// `activity_id` is nullable on both tables: mapping to a project without an
/// activity is a real answer, not a missing one.
///
/// The column adds are guarded by `has_column` for the same reason migration
/// 1's are: `run_migrations` re-applies the whole ladder for a `user_version`
/// 0 database, and the real database is still at 0.
const MIGRATION_4_COLUMNS: &[(&str, &str, &str)] = &[
    ("events", "project_id", "INTEGER REFERENCES projects(id)"),
    ("events", "activity_id", "INTEGER REFERENCES activities(id)"),
    ("events", "mapping_manually_set", "BOOLEAN DEFAULT 0"),
];

const MIGRATION_4: &str = r#"
    CREATE TABLE IF NOT EXISTS mapping_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      priority INTEGER NOT NULL,
      name_operator TEXT,
      name_value TEXT,
      category_value TEXT,
      type_id INTEGER REFERENCES event_types(id),
      project_id INTEGER NOT NULL REFERENCES projects(id),
      activity_id INTEGER REFERENCES activities(id),
      is_active BOOLEAN NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_mapping_rules_priority ON mapping_rules(priority);
    CREATE INDEX IF NOT EXISTS idx_events_project_id ON events(project_id);
"#;

/// Migration 5: how many hours one day of an all-day event is worth, per
/// event type.
///
/// Per type rather than one global number, because a day of Training and a day
/// of PTO are not obviously the same amount of billable time. `0` means "does
/// not count", which is how a Birthday or a company Holiday type opts out
/// without needing a separate flag.
///
/// The default is 8 rather than 24. Until now the billable footer valued an
/// all-day day at 1440 minutes, so a five-day PTO block counted as 120 hours.
const MIGRATION_5_COLUMNS: &[(&str, &str, &str)] = &[
    ("event_types", "all_day_hours", "REAL NOT NULL DEFAULT 8"),
];

/// Migration 6: timecards.
///
/// A timecard is created for a period and PULLS from events; events never
/// depend on it. The calendar is the source of truth for what happened; the
/// timecard is the record of what is billed, and it may differ.
///
/// `event_id` is `ON DELETE SET NULL`, deliberately not CASCADE. `cleanup_range`
/// deletes local events Graph stops returning, so a cascade would erase the
/// record that work was done because someone tidied a calendar months later.
/// An entry outlives its event and keeps its date, hours and attribution.
///
/// `timecard_id` IS cascade: an entry has no meaning without its timecard.
///
/// `source` separates entries generated from events from ones a human made or
/// edited, so regenerating can replace the former without ever touching the
/// latter - the same promise `type_manually_set` and `mapping_manually_set`
/// already make one layer down.
const MIGRATION_6: &str = r#"
    CREATE TABLE IF NOT EXISTS timecards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      generated_at DATETIME,
      submitted_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS timecard_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timecard_id INTEGER NOT NULL REFERENCES timecards(id) ON DELETE CASCADE,
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      date TEXT NOT NULL,
      hours REAL NOT NULL,
      project_id INTEGER REFERENCES projects(id),
      activity_id INTEGER REFERENCES activities(id),
      source TEXT NOT NULL DEFAULT 'event',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_timecard_entries_timecard ON timecard_entries(timecard_id);
    CREATE INDEX IF NOT EXISTS idx_timecard_entries_date ON timecard_entries(date);
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

    if version > SCHEMA_VERSION {
        return Err(DbError::Other(format!(
            "This database was created by a newer version of Calendar Manager \
             (schema v{version}, this build supports v{SCHEMA_VERSION}). \
             Refusing to open it."
        )));
    }
    if version == SCHEMA_VERSION {
        return Ok(());
    }

    // version == 0 falls through: that's the legacy case, where main.js never
    // stamped a version at all, and every pending migration must run.
    let tx = conn.unchecked_transaction()?;

    for next_version in (version + 1)..=SCHEMA_VERSION {
        apply_migration(&tx, next_version)?;
    }

    // pragma_user_version cannot be parameterised via `?`; interpolating it
    // is safe because SCHEMA_VERSION is a compile-time const i64, not a value
    // that could carry untrusted input.
    tx.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;

    tx.commit()?;

    Ok(())
}

/// Applies a single migration step. Each pending version between the
/// database's current one and `SCHEMA_VERSION` is applied in turn, so adding
/// migration 2 later does not re-run migration 1 against a v1 database.
fn apply_migration(conn: &Connection, version: i64) -> Result<(), DbError> {
    match version {
        1 => apply_migration_1(conn),
        2 => apply_migration_2(conn),
        3 => apply_migration_3(conn),
        4 => apply_migration_4(conn),
        5 => apply_migration_5(conn),
        6 => apply_migration_6(conn),
        other => Err(DbError::Other(format!("no migration defined for schema version {other}"))),
    }
}

fn apply_migration_1(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch(MIGRATION_1)?;

    for (table, column, definition) in MIGRATION_1_COLUMNS {
        if !has_column(conn, table, column)? {
            conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition};"))?;
        }
    }

    Ok(())
}

fn apply_migration_2(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch(MIGRATION_2)?;
    Ok(())
}

fn apply_migration_3(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch(MIGRATION_3)?;
    Ok(())
}

fn apply_migration_4(conn: &Connection) -> Result<(), DbError> {
    // Columns first: MIGRATION_4 indexes events(project_id), which does not
    // exist until the ALTER TABLE below has run.
    for (table, column, definition) in MIGRATION_4_COLUMNS {
        if !has_column(conn, table, column)? {
            conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition};"))?;
        }
    }

    conn.execute_batch(MIGRATION_4)?;

    Ok(())
}

fn apply_migration_5(conn: &Connection) -> Result<(), DbError> {
    for (table, column, definition) in MIGRATION_5_COLUMNS {
        if !has_column(conn, table, column)? {
            conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition};"))?;
        }
    }

    Ok(())
}

fn apply_migration_6(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch(MIGRATION_6)?;
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

    /// Foreign keys are enforced only because `libsqlite3-sys`'s bundled
    /// build sets `SQLITE_DEFAULT_FOREIGN_KEYS=1` - SQLite's own default is
    /// OFF, and nothing in this codebase issues `PRAGMA foreign_keys = ON`.
    /// `event_types::delete_event_type` and the rule-creation error path both
    /// depend on that, so if a future `rusqlite` bump drops the flag they
    /// would silently stop enforcing instead of failing loudly. This guards
    /// the invariant at the point it is actually relied on.
    #[test]
    fn foreign_keys_are_enforced_by_default() {
        let conn = Connection::open_in_memory().unwrap();

        let enforced: i64 = conn
            .query_row("SELECT * FROM pragma_foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(enforced, 1, "the bundled SQLite must default foreign_keys to ON");

        run_migrations(&conn).unwrap();
        let err = conn.execute(
            "INSERT INTO event_type_rules (name, field_name, operator, value, target_type_id, priority)
             VALUES ('orphan', 'title', 'contains', 'x', 99999, 1)",
            [],
        );
        assert!(
            err.is_err(),
            "a rule targeting a non-existent event type must be rejected by the FK"
        );
    }

    /// The eleven starter activities, in the order `list_activities` will
    /// return them (alphabetical). Kept here rather than in the migration
    /// string so a typo in the seed shows up as a test failure naming the
    /// exact row, not a silent difference in a blob of SQL.
    const EXPECTED_ACTIVITIES: [&str; 11] = [
        "Architecture",
        "Customer Support",
        "DevOps",
        "Leadership",
        "Maintenance",
        "Manual Testing",
        "PI Planning",
        "Product Management",
        "Software Development",
        "Solution Design",
        "UX Design",
    ];

    #[test]
    fn migration_2_creates_and_seeds_the_activities_table() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let mut stmt = conn
            .prepare("SELECT name FROM activities ORDER BY name COLLATE NOCASE")
            .unwrap();
        let names: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert_eq!(names, EXPECTED_ACTIVITIES, "seeded activities do not match");
    }

    /// Every seeded row must have a colour and be active, because the
    /// Settings screen renders a swatch per row and `Activity::color` is a
    /// non-Option String on the Rust side.
    #[test]
    fn seeded_activities_all_have_a_colour_and_are_active() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let bad: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM activities
                 WHERE color IS NULL OR color = '' OR is_active != 1",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(bad, 0, "every seeded activity needs a colour and is_active = 1");
    }

    /// Projects are user data, so unlike the activities seed there is nothing
    /// to assert about content — only that the table exists with the shape the
    /// CRUD module and the UI expect.
    #[test]
    fn migration_3_creates_an_empty_projects_table() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
            .unwrap();

        assert_eq!(count, 0, "projects must start empty - there is no seed");
        assert_eq!(
            columns(&conn, "projects"),
            vec!["id", "name", "code", "program", "is_active", "created_at"]
        );
    }

    /// `code` carries a project's identity, so the UNIQUE constraint is what
    /// the readable duplicate-code error in src/api/projects.ts keys off.
    /// `name` deliberately has no such constraint.
    #[test]
    fn project_code_is_unique_but_name_is_not() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO projects (name, code, program) VALUES ('Rebuild', 'PRJ-001', 'Platform')",
            [],
        )
        .unwrap();

        let duplicate_code = conn.execute(
            "INSERT INTO projects (name, code) VALUES ('Something else', 'PRJ-001')",
            [],
        );
        assert!(duplicate_code.is_err(), "a repeated code must be rejected");

        let duplicate_name = conn.execute(
            "INSERT INTO projects (name, code) VALUES ('Rebuild', 'PRJ-002')",
            [],
        );
        assert!(duplicate_name.is_ok(), "two projects may share a name");
    }

    #[test]
    fn migration_4_adds_the_mapping_columns_to_events() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let cols = columns(&conn, "events");
        for expected in ["project_id", "activity_id", "mapping_manually_set"] {
            assert!(cols.contains(&expected.to_string()), "events is missing {expected}");
        }
    }

    #[test]
    fn migration_4_creates_an_empty_mapping_rules_table() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM mapping_rules", [], |row| row.get(0))
            .unwrap();

        assert_eq!(count, 0, "mapping rules are the user's own - there is no seed");
        assert_eq!(
            columns(&conn, "mapping_rules"),
            vec![
                "id", "priority", "name_operator", "name_value", "category_value",
                "type_id", "project_id", "activity_id", "is_active", "created_at"
            ]
        );
    }

    /// A rule must point at a project that exists; the activity is optional
    /// because "project, no activity" is a real answer.
    #[test]
    fn a_mapping_rule_requires_a_real_project_but_not_an_activity() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, code) VALUES (1, 'Rebuild', 'PRJ-001')",
            [],
        )
        .unwrap();

        let no_activity = conn.execute(
            "INSERT INTO mapping_rules (priority, name_operator, name_value, project_id)
             VALUES (1, 'is', 'Standup', 1)",
            [],
        );
        assert!(no_activity.is_ok(), "a rule may map to a project with no activity");

        let dangling_project = conn.execute(
            "INSERT INTO mapping_rules (priority, name_operator, name_value, project_id)
             VALUES (2, 'is', 'Ghost', 9999)",
            [],
        );
        assert!(dangling_project.is_err(), "a rule may not target a missing project");
    }

    /// 8, not 24: the billable footer valued an all-day day at 1440 minutes,
    /// so a five-day PTO block counted as 120 hours.
    #[test]
    fn migration_5_gives_every_event_type_eight_all_day_hours() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute("INSERT INTO event_types (name) VALUES ('Work')", []).unwrap();

        let hours: f64 = conn
            .query_row("SELECT all_day_hours FROM event_types WHERE name = 'Work'", [], |r| {
                r.get(0)
            })
            .unwrap();

        assert_eq!(hours, 8.0);
    }

    /// 0 is how a Birthday or Holiday type opts out of counting at all.
    #[test]
    fn all_day_hours_may_be_zero() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let inserted = conn.execute(
            "INSERT INTO event_types (name, all_day_hours) VALUES ('Holiday', 0)",
            [],
        );

        assert!(inserted.is_ok());
    }

    #[test]
    fn migration_6_creates_the_timecard_tables() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        for table in ["timecards", "timecard_entries"] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "{table} was not created");
        }
    }

    /// The crux of the whole design. `cleanup_range` deletes events Graph
    /// stops returning, so a CASCADE here would erase the record that work was
    /// done because someone tidied a calendar. The entry must outlive the
    /// event, keeping its date, hours and attribution.
    #[test]
    fn deleting_an_event_detaches_its_timecard_entry_rather_than_deleting_it() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute("INSERT INTO projects (id, name, code) VALUES (1, 'P', 'PRJ-001')", []).unwrap();
        conn.execute(
            "INSERT INTO events (id, title, start_date) VALUES (7, 'Standup', '2026-10-05T09:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO timecards (id, name, start_date, end_date)
             VALUES (1, 'October', '2026-10-01', '2026-10-31')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO timecard_entries (timecard_id, event_id, date, hours, project_id)
             VALUES (1, 7, '2026-10-05', 0.25, 1)",
            [],
        )
        .unwrap();

        conn.execute("DELETE FROM events WHERE id = 7", []).unwrap();

        let (event_id, hours, project_id): (Option<i64>, f64, Option<i64>) = conn
            .query_row(
                "SELECT event_id, hours, project_id FROM timecard_entries",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();

        assert_eq!(event_id, None, "the entry is detached, not deleted");
        assert_eq!(hours, 0.25, "and it keeps what it recorded");
        assert_eq!(project_id, Some(1));
    }

    /// An entry has no meaning without its timecard, so that direction IS a
    /// cascade.
    #[test]
    fn deleting_a_timecard_takes_its_entries_with_it() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO timecards (id, name, start_date, end_date)
             VALUES (1, 'October', '2026-10-01', '2026-10-31')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO timecard_entries (timecard_id, date, hours, source)
             VALUES (1, '2026-10-05', 8, 'manual')",
            [],
        )
        .unwrap();

        conn.execute("DELETE FROM timecards WHERE id = 1", []).unwrap();

        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM timecard_entries", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
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
        let type_count_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM event_types", [], |r| r.get(0))
            .unwrap();
        let activity_count_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM activities", [], |r| r.get(0))
            .unwrap();

        // Reset the version stamp so the DDL genuinely re-executes against a
        // fully-migrated database — otherwise the version guard short-circuits
        // and this only proves the guard works, not that MIGRATION_1 is safe
        // to run twice.
        conn.execute_batch("PRAGMA user_version = 0;").unwrap();
        run_migrations(&conn).unwrap();
        conn.execute_batch("PRAGMA user_version = 0;").unwrap();
        run_migrations(&conn).unwrap();

        assert_eq!(columns(&conn, "events"), before);
        let type_count_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM event_types", [], |r| r.get(0))
            .unwrap();
        assert_eq!(type_count_after, type_count_before);
        let activity_count_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM activities", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            activity_count_after, activity_count_before,
            "re-running the ladder must not duplicate seeded activities"
        );
        assert_eq!(user_version(&conn), SCHEMA_VERSION);
    }

    #[test]
    fn a_database_from_a_newer_schema_version_is_refused() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO event_types (name, color, is_default, is_billable) VALUES ('Future', '#000000', 1, 1)",
            [],
        )
        .unwrap();
        conn.execute_batch(&format!("PRAGMA user_version = {};", SCHEMA_VERSION + 1))
            .unwrap();

        let result = run_migrations(&conn);

        assert!(result.is_err());
        // Refusing to open it must not touch the data that's already there.
        assert_eq!(user_version(&conn), SCHEMA_VERSION + 1);
        let type_name: String = conn
            .query_row("SELECT name FROM event_types WHERE name = 'Future'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(type_name, "Future");
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

        // The rule and the category survived too — neither is recreatable
        // from Graph any more than the type or the override are.
        let (rule_name, rule_target): (String, i64) = conn
            .query_row(
                "SELECT name, target_type_id FROM event_type_rules WHERE name = 'Consulting keyword'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(rule_name, "Consulting keyword");
        assert_eq!(rule_target, 1);

        let category_name: String = conn
            .query_row("SELECT name FROM categories WHERE name = 'Client Work'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(category_name, "Client Work");

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
