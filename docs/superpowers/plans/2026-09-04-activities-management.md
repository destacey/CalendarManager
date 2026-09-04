# Activities Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings screen for creating, editing and deleting *activities* — named disciplines with a colour and an active flag — backed by a new SQLite table seeded with eleven starter rows.

**Architecture:** Mirrors the existing Event Types stack exactly: a migration in `db/schema.rs`, a CRUD module in `db/activities.rs`, thin `#[tauri::command]` wrappers in `commands/db.rs`, a typed `src/api/activities.ts` wrapper over `invoke()`, and an `ActivitiesSettings.tsx` component modelled on `EventTypesSettings.tsx`. Activities are a second, independent dimension alongside event types — they do **not** attach to events in this work.

**Tech Stack:** Rust (rusqlite 0.40, serde, Tauri 2), React 19, TypeScript, antd 6, Vitest, Cargo test.

**Design spec:** [`docs/superpowers/specs/2026-09-04-activities-management-design.md`](../specs/2026-09-04-activities-management-design.md)

## Global Constraints

These apply to **every** task below.

- **Run frontend tests from an uppercase drive letter.** `cd /D/Dev/CalendarManager` first. From `d:\` Vitest collects zero tests and reports `no tests` instead of failing — a silent false pass that has already cost time three times.
- **Domain field names stay `snake_case` end to end** — `is_active`, `created_at`. The Rust `Activity` struct gets **no** `#[serde(rename_all = "camelCase")]`; serde's default already produces the `snake_case` JSON keys `src/types/index.ts` expects.
- **Tauri auto-camelCases command *arguments*.** A Rust parameter named `activity_id` must be invoked as `{ activityId }`. Passing the snake_case key does not error — the argument silently arrives missing.
- **Rust command names are `snake_case`** (`get_activities`); `src/api/` exposes `camelCase` functions (`getActivities`).
- **Migrations must be idempotent.** `run_migrations` re-applies the whole ladder for a `user_version` 0 database, which is what the real legacy database still is.
- **Activities do not touch events.** No `events.activity_id`, no `EventModal`/`EventTable`/export changes, no rules targeting activities.
- **Seed colours are exact.** Copy the eleven hex values verbatim from Task 1.

---

### Task 1: Migration 2 — the `activities` table and its seed

**Files:**
- Modify: `src-tauri/src/db/schema.rs` (`SCHEMA_VERSION`, new `MIGRATION_2`, `apply_migration`, tests module)

**Interfaces:**
- Consumes: nothing
- Produces: an `activities` table with columns `id INTEGER`, `name TEXT UNIQUE NOT NULL`, `color TEXT NOT NULL`, `is_active BOOLEAN NOT NULL`, `created_at DATETIME`; seeded with 11 rows. `SCHEMA_VERSION == 2`.

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the existing `mod tests` block in `src-tauri/src/db/schema.rs`, next to `a_fresh_database_gets_every_table`:

```rust
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /D/Dev/CalendarManager/src-tauri && cargo test migration_2_creates_and_seeds
```

Expected: FAIL — `no such table: activities`.

- [ ] **Step 3: Bump the schema version and add the migration**

In `src-tauri/src/db/schema.rs`, change the constant:

```rust
pub const SCHEMA_VERSION: i64 = 2;
```

Add `MIGRATION_2` immediately after the `MIGRATION_1_COLUMNS` definition (before `has_column`):

```rust
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
```

Extend the dispatcher:

```rust
fn apply_migration(conn: &Connection, version: i64) -> Result<(), DbError> {
    match version {
        1 => apply_migration_1(conn),
        2 => apply_migration_2(conn),
        other => Err(DbError::Other(format!("no migration defined for schema version {other}"))),
    }
}

fn apply_migration_2(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch(MIGRATION_2)?;
    Ok(())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /D/Dev/CalendarManager/src-tauri && cargo test migration_2_creates_and_seeds seeded_activities_all_have
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Extend the existing idempotency test to cover the seed**

`migrations_are_idempotent` already resets `user_version` to 0 and re-runs the ladder twice. Add an activity count to it so a non-idempotent seed fails loudly. In `src-tauri/src/db/schema.rs`, inside `migrations_are_idempotent`, add after the `type_count_before` binding:

```rust
        let activity_count_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM activities", [], |r| r.get(0))
            .unwrap();
```

and add this assertion next to the existing `type_count_after` one:

```rust
        let activity_count_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM activities", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            activity_count_after, activity_count_before,
            "re-running the ladder must not duplicate seeded activities"
        );
```

- [ ] **Step 6: Run the whole Rust suite**

```bash
cd /D/Dev/CalendarManager/src-tauri && cargo test
```

Expected: PASS. Count is 218 (the pre-existing suite) + 2 new = **220 passed**.

- [ ] **Step 7: Commit**

```bash
cd /D/Dev/CalendarManager
git add src-tauri/src/db/schema.rs
git commit -m "feat(db): add activities table with eleven seeded starter rows"
```

---

### Task 2: `Activity` model and the `db::activities` CRUD module

**Files:**
- Modify: `src-tauri/src/db/models.rs` (add `Activity`)
- Modify: `src-tauri/src/db/mod.rs` (add `pub mod activities;`)
- Create: `src-tauri/src/db/activities.rs`

**Interfaces:**
- Consumes: the `activities` table from Task 1.
- Produces:
  - `db::models::Activity { id: Option<i64>, name: String, color: String, is_active: bool, created_at: Option<String> }`
  - `db::activities::ActivityInput { name: String, color: String, is_active: bool }`
  - `db::activities::list_activities(conn: &Connection) -> DbResult<Vec<Activity>>`
  - `db::activities::create_activity(conn: &Connection, input: &ActivityInput) -> DbResult<Activity>`
  - `db::activities::update_activity(conn: &Connection, id: i64, input: &ActivityInput) -> DbResult<Option<Activity>>`
  - `db::activities::delete_activity(conn: &Connection, id: i64) -> DbResult<bool>`

- [ ] **Step 1: Add the model**

In `src-tauri/src/db/models.rs`, add after the `EventType` impl block:

```rust
/// Mirrors `Activity` in `src/types/index.ts`.
///
/// No `#[serde(rename_all = "camelCase")]` — deliberately. Domain field names
/// stay `snake_case` across the IPC boundary, and serde's default already
/// serialises `is_active` as `is_active`, which is the key the TypeScript
/// interface reads.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Activity {
    pub id: Option<i64>,
    pub name: String,
    pub color: String,
    pub is_active: bool,
    pub created_at: Option<String>,
}

impl Activity {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            color: row.get("color")?,
            is_active: row.get("is_active")?,
            created_at: row.get("created_at")?,
        })
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/db/mod.rs`, add to the module list, keeping it alphabetical:

```rust
pub mod activities;
pub mod assignment;
```

- [ ] **Step 3: Write the failing tests**

Create `src-tauri/src/db/activities.rs` containing **only** the tests for now, so they fail to compile against missing functions:

```rust
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
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
cd /D/Dev/CalendarManager/src-tauri && cargo test activities
```

Expected: FAIL to compile — `cannot find function 'create_activity' in this scope`.

- [ ] **Step 5: Write the implementation**

Prepend this **above** the `#[cfg(test)] mod tests` block in `src-tauri/src/db/activities.rs`:

```rust
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
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /D/Dev/CalendarManager/src-tauri && cargo test activities
```

Expected: PASS, 7 tests.

- [ ] **Step 7: Run the whole Rust suite**

```bash
cd /D/Dev/CalendarManager/src-tauri && cargo test
```

Expected: **227 passed** (220 + 7).

- [ ] **Step 8: Commit**

```bash
cd /D/Dev/CalendarManager
git add src-tauri/src/db/activities.rs src-tauri/src/db/models.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): add activities CRUD module"
```

---

### Task 3: Tauri commands and registration

**Files:**
- Modify: `src-tauri/src/commands/db.rs`
- Modify: `src-tauri/src/lib.rs` (`invoke_handler`)

**Interfaces:**
- Consumes: `db::activities::{list_activities, create_activity, update_activity, delete_activity, ActivityInput}`, `db::models::Activity`
- Produces: four IPC commands — `get_activities`, `create_activity`, `update_activity`, `delete_activity`

This task has no unit test of its own: `commands/` holds thin wrappers with no logic, and the repo has no command-level tests. Verification is that the crate compiles, the existing suite still passes, and all four names appear in `invoke_handler`. Task 4 is what proves they are reachable.

- [ ] **Step 1: Add the command wrappers**

In `src-tauri/src/commands/db.rs`, add the imports to the existing `use` block for `db`:

```rust
use crate::db::activities::{self, ActivityInput};
use crate::db::models::Activity;
```

(`Activity` joins the existing `models::{...}` import if one is already present — merge rather than duplicating the line.)

Add the four commands after the `delete_event_type_rule` command:

```rust
#[tauri::command]
pub async fn get_activities(db: State<'_, Db>) -> DbResult<Vec<Activity>> {
    db.call(activities::list_activities).await
}

#[tauri::command]
pub async fn create_activity(db: State<'_, Db>, activity: ActivityInput) -> DbResult<Activity> {
    db.call(move |conn| activities::create_activity(conn, &activity)).await
}

#[tauri::command]
pub async fn update_activity(
    db: State<'_, Db>,
    id: i64,
    activity: ActivityInput,
) -> DbResult<Option<Activity>> {
    db.call(move |conn| activities::update_activity(conn, id, &activity)).await
}

#[tauri::command]
pub async fn delete_activity(db: State<'_, Db>, id: i64) -> DbResult<bool> {
    db.call(move |conn| activities::delete_activity(conn, id)).await
}
```

- [ ] **Step 2: Register them**

In `src-tauri/src/lib.rs`, add to the `invoke_handler` list immediately after `commands::db::delete_event_type_rule,`:

```rust
            commands::db::get_activities,
            commands::db::create_activity,
            commands::db::update_activity,
            commands::db::delete_activity,
```

- [ ] **Step 3: Verify it compiles and the suite still passes**

```bash
cd /D/Dev/CalendarManager/src-tauri && cargo test
```

Expected: **227 passed**, no new warnings about unused functions.

- [ ] **Step 4: Verify all four commands are registered**

```bash
cd /D/Dev/CalendarManager && grep -c "commands::db::\(get_activities\|create_activity\|update_activity\|delete_activity\)" src-tauri/src/lib.rs
```

Expected: `4`. A command that compiles but is missing here fails at runtime with `Command not found`, not at build time — which is why this is checked explicitly.

- [ ] **Step 5: Commit**

```bash
cd /D/Dev/CalendarManager
git add src-tauri/src/commands/db.rs src-tauri/src/lib.rs
git commit -m "feat(commands): expose activities CRUD over IPC"
```

---

### Task 4: TypeScript types and the `src/api/activities.ts` wrapper

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/api/activities.ts`

**Interfaces:**
- Consumes: the four IPC commands from Task 3.
- Produces:
  - `Activity { id?: number; name: string; color: string; is_active: boolean; created_at?: string }` from `src/types`
  - `NewActivity`, `ActivityUpdate`, `DuplicateActivityError` from `src/api/activities`
  - `getActivities(): Promise<Activity[]>`
  - `createActivity(activity: NewActivity): Promise<Activity>`
  - `updateActivity(id: number, activity: ActivityUpdate): Promise<Activity | null>`
  - `deleteActivity(id: number): Promise<boolean>`

- [ ] **Step 1: Add the domain type**

Append to `src/types/index.ts`:

```ts
export interface Activity {
  id?: number
  name: string
  color: string
  is_active: boolean
  created_at?: string
}
```

- [ ] **Step 2: Write the API wrapper**

Create `src/api/activities.ts`:

```ts
import { invoke } from '@tauri-apps/api/core'
import { Activity } from '../types'

/**
 * Activities — named disciplines with a colour and an active flag — backed by
 * SQLite via the Rust `db` commands (`src-tauri/src/commands/db.rs`,
 * `src-tauri/src/db/activities.rs`).
 *
 * Activities are a second dimension alongside event types and are not yet
 * attached to events.
 */

export interface NewActivity {
  name: string
  color: string
  is_active: boolean
}

/** Same shape as `NewActivity` — every field on an activity is editable. */
export type ActivityUpdate = NewActivity

/**
 * Thrown when the backend rejects a name that already exists. A distinct
 * class (rather than a generic `Error`) so the Settings screen can show its
 * message directly while falling back to a generic message for anything else.
 */
export class DuplicateActivityError extends Error {}

/**
 * `activities.name` is `UNIQUE`, so a repeated name fails with a raw
 * `UNIQUE constraint failed: activities.name` wrapped in `DbError`'s
 * `Database error: {0}`. A raw SQLite message must never reach the user, so
 * it is translated here — the same approach `src/api/rules.ts` takes for
 * foreign-key violations.
 */
function toReadableError(error: unknown, name: string): unknown {
  const message =
    typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)
  if (message.includes('UNIQUE constraint failed: activities.name')) {
    return new DuplicateActivityError(`An activity called "${name}" already exists.`)
  }
  return error
}

export function getActivities(): Promise<Activity[]> {
  return invoke<Activity[]>('get_activities')
}

export async function createActivity(activity: NewActivity): Promise<Activity> {
  try {
    return await invoke<Activity>('create_activity', { activity })
  } catch (error) {
    throw toReadableError(error, activity.name)
  }
}

export async function updateActivity(
  id: number,
  activity: ActivityUpdate
): Promise<Activity | null> {
  try {
    return await invoke<Activity | null>('update_activity', { id, activity })
  } catch (error) {
    throw toReadableError(error, activity.name)
  }
}

export function deleteActivity(id: number): Promise<boolean> {
  return invoke<boolean>('delete_activity', { id })
}
```

- [ ] **Step 3: Write the failing tests**

Create `src/api/activities.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  getActivities,
  createActivity,
  updateActivity,
  deleteActivity,
  DuplicateActivityError
} from './activities'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('activities api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads the list through get_activities', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([])

    await getActivities()

    expect(invoke).toHaveBeenCalledWith('get_activities')
  })

  /* Tauri auto-camelCases command arguments, and a mis-cased key is not an
     error - the argument just arrives missing on the Rust side. Asserting the
     exact payload is the only thing that catches that. */
  it('passes the activity under an "activity" key', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({})
    const activity = { name: 'DevOps', color: '#52c41a', is_active: true }

    await createActivity(activity)

    expect(invoke).toHaveBeenCalledWith('create_activity', { activity })
  })

  it('passes both id and activity when updating', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({})
    const activity = { name: 'DevOps', color: '#52c41a', is_active: false }

    await updateActivity(7, activity)

    expect(invoke).toHaveBeenCalledWith('update_activity', { id: 7, activity })
  })

  it('passes the id when deleting', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true)

    await deleteActivity(3)

    expect(invoke).toHaveBeenCalledWith('delete_activity', { id: 3 })
  })

  it('translates a UNIQUE violation into a readable duplicate error', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      'Database error: UNIQUE constraint failed: activities.name'
    )

    await expect(
      createActivity({ name: 'DevOps', color: '#52c41a', is_active: true })
    ).rejects.toBeInstanceOf(DuplicateActivityError)
  })

  it('names the offending activity in the duplicate message', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      'Database error: UNIQUE constraint failed: activities.name'
    )

    await expect(
      createActivity({ name: 'DevOps', color: '#52c41a', is_active: true })
    ).rejects.toThrow('An activity called "DevOps" already exists.')
  })

  /* Anything that is not a duplicate must pass through untouched, or a real
     failure gets misreported as a naming collision. */
  it('leaves unrelated errors alone', async () => {
    vi.mocked(invoke).mockRejectedValueOnce('Database is unavailable')

    await expect(
      createActivity({ name: 'DevOps', color: '#52c41a', is_active: true })
    ).rejects.not.toBeInstanceOf(DuplicateActivityError)
  })
})
```

- [ ] **Step 4: Run the tests**

```bash
cd /D/Dev/CalendarManager && npm run test:run -- activities
```

Expected: PASS, 7 tests. (Implementation was written in Step 2, so these pass immediately — they exist to lock the IPC argument names, which nothing else checks.)

- [ ] **Step 5: Commit**

```bash
cd /D/Dev/CalendarManager
git add src/types/index.ts src/api/activities.ts src/api/activities.test.ts
git commit -m "feat(api): add typed activities wrapper with duplicate-name translation"
```

---

### Task 5: The `ActivitiesSettings` component

**Files:**
- Create: `src/components/settings/ActivitiesSettings.tsx`
- Create: `src/components/settings/ActivitiesSettings.test.tsx`

**Interfaces:**
- Consumes: `getActivities`, `createActivity`, `updateActivity`, `deleteActivity`, `DuplicateActivityError` from `src/api/activities`; `Activity` from `src/types`.
- Produces: default-exported `ActivitiesSettings` taking `{ searchTerm?: string }`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/settings/ActivitiesSettings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import ActivitiesSettings from './ActivitiesSettings'
import {
  getActivities,
  createActivity,
  updateActivity,
  deleteActivity,
  DuplicateActivityError
} from '../../api/activities'

vi.mock('../../api/activities')

const mockActivities = [
  { id: 1, name: 'Architecture', color: '#2f54eb', is_active: true },
  { id: 2, name: 'DevOps', color: '#52c41a', is_active: true },
  { id: 3, name: 'Retired Work', color: '#f5222d', is_active: false }
]

describe('ActivitiesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActivities).mockResolvedValue(mockActivities)
  })

  it('lists the activities it loads', async () => {
    render(<ActivitiesSettings />)

    await waitFor(() => {
      expect(screen.getByText('Architecture')).toBeInTheDocument()
    })
    expect(screen.getByText('DevOps')).toBeInTheDocument()
  })

  it('shows inactive activities as well as active ones', async () => {
    render(<ActivitiesSettings />)

    await waitFor(() => {
      expect(screen.getByText('Retired Work')).toBeInTheDocument()
    })
  })

  it('filters the list by the settings search term', async () => {
    render(<ActivitiesSettings searchTerm="devops" />)

    await waitFor(() => {
      expect(screen.getByText('DevOps')).toBeInTheDocument()
    })
    expect(screen.queryByText('Architecture')).not.toBeInTheDocument()
  })

  it('creates an activity from the add modal', async () => {
    const user = userEvent.setup()
    vi.mocked(createActivity).mockResolvedValue({
      id: 4, name: 'UX Design', color: '#eb2f96', is_active: true
    })
    render(<ActivitiesSettings />)
    await waitFor(() => expect(screen.getByText('Architecture')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /add activity/i }))
    await user.type(await screen.findByLabelText('Name'), 'UX Design')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(createActivity).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'UX Design' })
      )
    })
  })

  it('updates an existing activity through the edit modal', async () => {
    const user = userEvent.setup()
    vi.mocked(updateActivity).mockResolvedValue({
      id: 2, name: 'Platform DevOps', color: '#52c41a', is_active: true
    })
    render(<ActivitiesSettings />)
    await waitFor(() => expect(screen.getByText('DevOps')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Edit DevOps' }))
    const nameField = await screen.findByLabelText('Name')
    await user.clear(nameField)
    await user.type(nameField, 'Platform DevOps')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(updateActivity).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ name: 'Platform DevOps' })
      )
    })
  })

  it('deletes an activity after the confirmation is accepted', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteActivity).mockResolvedValue(true)
    render(<ActivitiesSettings />)
    await waitFor(() => expect(screen.getByText('Architecture')).toBeInTheDocument())

    await user.click(screen.getAllByRole('button', { name: /delete/i })[0])
    await user.click(await screen.findByRole('button', { name: /^yes$/i }))

    await waitFor(() => {
      expect(deleteActivity).toHaveBeenCalledWith(1)
    })
  })

  /* The duplicate case is the one error with a message worth showing; every
     other failure gets the generic fallback. */
  it('shows the duplicate-name message rather than a generic failure', async () => {
    const user = userEvent.setup()
    vi.mocked(createActivity).mockRejectedValue(
      new DuplicateActivityError('An activity called "DevOps" already exists.')
    )
    render(<ActivitiesSettings />)
    await waitFor(() => expect(screen.getByText('Architecture')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /add activity/i }))
    await user.type(await screen.findByLabelText('Name'), 'DevOps')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(screen.getByText('An activity called "DevOps" already exists.')).toBeInTheDocument()
    })
  })

  it('reports a load failure instead of rendering an empty list silently', async () => {
    vi.mocked(getActivities).mockRejectedValue(new Error('boom'))
    render(<ActivitiesSettings />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load activities')).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /D/Dev/CalendarManager && npm run test:run -- ActivitiesSettings
```

Expected: FAIL — cannot resolve `./ActivitiesSettings`.

- [ ] **Step 3: Write the component**

Create `src/components/settings/ActivitiesSettings.tsx`:

```tsx
import React, { useState, useEffect } from 'react'
import { Typography, Space, Button, Table, Modal, Form, Input, ColorPicker, Switch, Popconfirm, theme, Flex } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { Activity } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import {
  getActivities,
  createActivity,
  updateActivity,
  deleteActivity,
  DuplicateActivityError
} from '../../api/activities'

const { Text } = Typography

interface ActivitiesSettingsProps {
  searchTerm?: string
}

const ActivitiesSettings: React.FC<ActivitiesSettingsProps> = ({ searchTerm = '' }) => {
  const messageApi = useMessage()
  const { token } = theme.useToken()
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    loadActivities()
  }, [])

  const loadActivities = async () => {
    try {
      setLoading(true)
      setActivities(await getActivities())
    } catch (error) {
      console.error('Error loading activities:', error)
      messageApi.error('Failed to load activities')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingActivity(null)
    form.resetFields()
    form.setFieldsValue({ name: '', color: token.colorPrimary, is_active: true })
    setModalVisible(true)
  }

  const handleEdit = (activity: Activity) => {
    setEditingActivity(activity)
    form.setFieldsValue({ ...activity })
    setModalVisible(true)
  }

  const handleDelete = async (activity: Activity) => {
    try {
      await deleteActivity(activity.id!)
      messageApi.success('Activity deleted')
      loadActivities()
    } catch (error) {
      console.error('Error deleting activity:', error)
      messageApi.error('Failed to delete activity')
    }
  }

  const handleSave = async () => {
    let values
    try {
      values = await form.validateFields()
    } catch {
      return // antd already marks the invalid fields
    }

    // ColorPicker hands back a Color object when the user picks one, but the
    // original string when the field was only ever seeded by setFieldsValue.
    let color = values.color
    if (typeof color === 'object' && color !== null) {
      color = color.toHexString?.() ?? token.colorPrimary
    }
    if (typeof color !== 'string') {
      color = token.colorPrimary
    }

    const payload = { name: values.name, color, is_active: values.is_active ?? true }

    try {
      if (editingActivity) {
        await updateActivity(editingActivity.id!, payload)
        messageApi.success('Activity updated')
      } else {
        await createActivity(payload)
        messageApi.success('Activity created')
      }
      setModalVisible(false)
      loadActivities()
    } catch (error) {
      console.error('Error saving activity:', error)
      // A duplicate name is the one failure with a message worth showing
      // verbatim; it is already user-facing prose from src/api/activities.ts.
      if (error instanceof DuplicateActivityError) {
        messageApi.error(error.message)
      } else {
        messageApi.error('Failed to save activity')
      }
    }
  }

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Activity) => (
        <Space>
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              backgroundColor: record.color,
              border: `1px solid ${token.colorBorder}`
            }}
          />
          <Text type={record.is_active ? undefined : 'secondary'}>{text}</Text>
        </Space>
      )
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (is_active: boolean) => (
        <Text type={is_active ? 'success' : 'secondary'}>{is_active ? 'Yes' : 'No'}</Text>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      render: (_: unknown, record: Activity) => (
        <Space>
          <Button
            icon={<EditOutlined />}
            size="small"
            title="Edit"
            aria-label={`Edit ${record.name}`}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="Delete this activity?"
            description="This cannot be undone."
            okText="Yes"
            cancelText="No"
            onConfirm={() => handleDelete(record)}
          >
            <Button
              icon={<DeleteOutlined />}
              size="small"
              danger
              title="Delete"
              aria-label={`Delete ${record.name}`}
            />
          </Popconfirm>
        </Space>
      )
    }
  ]

  const filteredActivities = activities.filter(activity =>
    activity.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const shouldShow =
    searchTerm === '' ||
    'activities'.includes(searchTerm.toLowerCase()) ||
    filteredActivities.length > 0

  if (!shouldShow) return null

  return (
    <Space orientation="vertical" style={{ width: '100%', marginBottom: 16 }}>
      <Flex justify="space-between" align="center">
        <Text strong>Activities</Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          Add Activity
        </Button>
      </Flex>

      <Text type="secondary">
        The disciplines work falls under. Inactive activities are kept for history but hidden from
        future pickers.
      </Text>

      <Table
        columns={columns}
        dataSource={filteredActivities}
        loading={loading}
        rowKey="id"
        pagination={false}
        size="small"
      />

      <Modal
        title={editingActivity ? 'Edit Activity' : 'Create Activity'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        okText="Save"
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: 'Please enter a name' }]}
          >
            <Input placeholder="e.g., Software Development, UX Design" />
          </Form.Item>

          <Form.Item
            label="Color"
            name="color"
            rules={[{ required: true, message: 'Please select a color' }]}
          >
            <ColorPicker showText />
          </Form.Item>

          <Form.Item label="Active" name="is_active" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            Inactive activities stay in the list but will not be offered when assigning work.
          </Text>
        </Form>
      </Modal>
    </Space>
  )
}

export default ActivitiesSettings
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /D/Dev/CalendarManager && npm run test:run -- ActivitiesSettings
```

Expected: PASS, 8 tests.

If the delete test cannot find the confirm button, check the rendered `Popconfirm` text — antd renders `okText` as the button label, and this plan uses `Yes`.

- [ ] **Step 5: Commit**

```bash
cd /D/Dev/CalendarManager
git add src/components/settings/ActivitiesSettings.tsx src/components/settings/ActivitiesSettings.test.tsx
git commit -m "feat(settings): add the Activities management screen"
```

---

### Task 6: Wire the Activities tab into Settings

**Files:**
- Modify: `src/components/settings/Settings.tsx`
- Modify: `src/components/settings/Settings.test.tsx`

**Interfaces:**
- Consumes: `ActivitiesSettings` from Task 5.
- Produces: a second Settings tab keyed `activities`.

- [ ] **Step 1: Write the failing tests**

Add this block inside the top-level `describe` in `src/components/settings/Settings.test.tsx`:

```tsx
  describe('Activities tab', () => {
    it('offers an Activities tab alongside General', () => {
      render(<Settings />)

      expect(screen.getByRole('tab', { name: /activities/i })).toBeInTheDocument()
    })

    it('keeps General as the tab shown first', () => {
      render(<Settings />)

      expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    })
  })
```

`Settings.test.tsx` already mocks the child settings components; add `ActivitiesSettings` to that set of mocks alongside the existing ones so this suite stays a test of `Settings`, not of the table:

```tsx
vi.mock('./ActivitiesSettings', () => ({
  default: ({ searchTerm }: { searchTerm?: string }) => (
    <div data-testid="activities-settings">{searchTerm}</div>
  )
}))
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /D/Dev/CalendarManager && npm run test:run -- Settings
```

Expected: FAIL — no tab named Activities.

- [ ] **Step 3: Add the tab**

In `src/components/settings/Settings.tsx`, add the import:

```tsx
import ActivitiesSettings from "./ActivitiesSettings";
```

Replace the `// Future tabs can be added here` comment block in `tabItems` with:

```tsx
    {
      key: "activities",
      label: "Activities",
      children: (
        <div style={{ maxWidth: "800px" }}>
          <ActivitiesSettings searchTerm={searchTerm} />
        </div>
      ),
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /D/Dev/CalendarManager && npm run test:run -- Settings
```

Expected: PASS, including the pre-existing Settings tests.

- [ ] **Step 5: Run everything**

```bash
cd /D/Dev/CalendarManager && npm run test:run
cd /D/Dev/CalendarManager/src-tauri && cargo test
```

Expected: frontend **389 + 17 new = 406 passed**; Rust **227 passed**. If the frontend reports `no tests`, the shell is on a lowercase drive letter — see Global Constraints.

- [ ] **Step 6: Verify the production build**

```bash
cd /D/Dev/CalendarManager && npm run build
```

Expected: `✓ built in <1s`, no errors.

- [ ] **Step 7: Commit**

```bash
cd /D/Dev/CalendarManager
git add src/components/settings/Settings.tsx src/components/settings/Settings.test.tsx
git commit -m "feat(settings): add the Activities tab"
```

---

## Manual verification

Automated tests cannot confirm the seed reached the *real* database, because
every test runs against an in-memory one. After Task 6:

```bash
cd /D/Dev/CalendarManager && npm start
```

Then check:

1. Settings shows an **Activities** tab beside General.
2. It lists all eleven activities, alphabetically, each with a distinct colour swatch.
3. Adding an activity named `DevOps` reports `An activity called "DevOps" already exists.` rather than a raw SQLite message.
4. Editing an activity's colour persists across an app restart — this is what proves the migration ran against `%APPDATA%/com.triowfs.calendarmanager/calendar.db` and not just a test fixture.
5. Toggling one inactive dims its row and it stays in the list.
