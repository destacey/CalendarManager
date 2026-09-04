# Activities Management — Design

**Date:** 2026-09-04
**Status:** approved, not yet implemented

A new Settings area for managing a list of *activities* — the disciplines work
falls under, such as Software Development, UX Design or Customer Support.

---

## 1. What this is, and what it deliberately is not

An activity is a named discipline with a colour and an active flag. This spec
covers **the list and its management screen only**.

Activities do **not** attach to calendar events in this work. There is no
`events.activity_id`, no picker in `EventModal`, no column in `EventTable`, no
export change, no rule that targets an activity, and no per-activity reporting.
Those are a separate piece of work, and the schema here is shaped so that work
does not need a rewrite.

### Relationship to Event Types

Activities are a **second, independent dimension** — not a replacement for
event types.

| | Event Type | Activity |
| --- | --- | --- |
| Answers | Is this billable? What kind of entry is it? | What discipline was the work? |
| Assigned by | Rules (`event_type_rules`) or manual override | Nothing yet |
| Referenced by | `events.type_id`, rules, billable totals | Nothing yet |

The two are structurally similar (name, colour, flag), and that similarity is
**not** abstracted into a shared table or shared component. Event types carry
`is_default` and `is_billable` and are the target of a rules engine; activities
carry none of that. A shared abstraction would have to grow holes for both.

---

## 2. Data layer

### Schema

Migration 2 in `src-tauri/src/db/schema.rs`. `SCHEMA_VERSION` goes `1` → `2`.

```sql
CREATE TABLE IF NOT EXISTS activities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#1890ff',
  is_active  BOOLEAN NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

`name` is `UNIQUE`. That constraint is load-bearing twice over: it is what makes
the seed idempotent, and it is what produces the duplicate-name error the UI
reports.

### Seed

The same migration seeds eleven rows:

| Name | Colour |
| --- | --- |
| Architecture | `#2f54eb` |
| Customer Support | `#13c2c2` |
| DevOps | `#52c41a` |
| Leadership | `#f5222d` |
| Maintenance | `#fa8c16` |
| Manual Testing | `#a0d911` |
| PI Planning | `#faad14` |
| Product Management | `#fa541c` |
| Software Development | `#1890ff` |
| Solution Design | `#722ed1` |
| UX Design | `#eb2f96` |

Colours are eleven distinct antd preset hues rather than eleven identical blues,
so the list is legible the moment it appears. They are arbitrary and every one
is editable.

Seeding uses `INSERT OR IGNORE`, relying on the `UNIQUE` name.

### Why the migration must stay idempotent

`run_migrations` re-applies **every** migration from `version + 1` for a
database whose `user_version` is 0 — which is exactly the state of the real
legacy database, because the Electron build never stamped a version. Migration 1
carries an explicit doc comment demanding idempotency for this reason, and
migration 2 inherits the same requirement: `CREATE TABLE IF NOT EXISTS` plus
`INSERT OR IGNORE`.

This is also what causes the existing install to end up seeded rather than
holding an empty table, which is the intended outcome.

A deleted seed row does **not** come back on next launch: once `user_version`
reaches 2, migration 2 never runs again.

---

## 3. Rust backend

### `src-tauri/src/db/models.rs`

```rust
pub struct Activity {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub is_active: bool,
    pub created_at: String,
}
```

**No `#[serde(rename_all = "camelCase")]`.** Per CLAUDE.md, domain field names
stay `snake_case` end to end; serde's default already serialises a Rust
`snake_case` field to the same JSON key, which is what the TypeScript interface
expects.

### `src-tauri/src/db/activities.rs`

| Function | Behaviour |
| --- | --- |
| `list_activities` | All rows, ordered by `name COLLATE NOCASE` |
| `create_activity` | Insert; a duplicate name surfaces the SQLite `UNIQUE` error |
| `update_activity` | Update name, colour and `is_active` by id |
| `delete_activity` | Plain `DELETE` by id |

Ordering is alphabetical in SQL rather than in the component, so every consumer
gets the same order without repeating the sort.

**`delete_activity` is deliberately a bare delete, and that is only safe while
nothing references activities.** When events gain an `activity_id`, this
function needs the treatment `db::event_types::delete_event_type` already got —
reassign referencing rows and remove dependent records in one transaction, or
refuse. Foreign keys are enforced in this build, so the failure would at least
be loud rather than silent. A comment in the function will say so.

### `src-tauri/src/commands/db.rs` and `lib.rs`

Four thin `#[tauri::command]` wrappers — `get_activities`, `create_activity`,
`update_activity`, `delete_activity` — registered in `lib.rs`'s
`invoke_handler`, matching how every other db command is plumbed.

---

## 4. Frontend

### `src/types/index.ts`

```ts
export interface Activity {
  id?: number
  name: string
  color: string
  is_active: boolean
  created_at?: string
}
```

### `src/api/activities.ts`

Typed wrappers over `invoke()`, exposing `camelCase` functions over
`snake_case` command names, exactly as `src/api/eventTypes.ts` does:

```ts
export interface NewActivity {
  name: string
  color: string
  is_active: boolean
}

/** Same shape as NewActivity — every field is editable. */
export type ActivityUpdate = NewActivity

getActivities(): Promise<Activity[]>
createActivity(activity: NewActivity): Promise<Activity>
updateActivity(id: number, activity: ActivityUpdate): Promise<Activity | null>
deleteActivity(id: number): Promise<boolean>
```

`getActivities` returns **all** rows, active and inactive. Filtering inactive
ones out is a concern for the future picker, not for the management screen,
which has to show them in order to toggle them back.

**Tauri auto-camelCases command arguments.** A Rust parameter named
`activity_id` must be invoked as `{ activityId }`; passing the snake_case key
does not error, the argument simply arrives missing. The wrappers here take the
same care the existing ones do.

`createActivity` and `updateActivity` translate the raw SQLite
`UNIQUE constraint failed: activities.name` into
`An activity called "<name>" already exists`, mirroring how `src/api/rules.ts`
already translates foreign-key errors rather than letting them reach the user.

### `src/components/settings/ActivitiesSettings.tsx`

Modelled on `EventTypesSettings.tsx` (330 lines, the closest existing
equivalent): antd `Table` + `Modal` + `Form` + `ColorPicker` + `Switch` +
`Popconfirm`, and it honours the `searchTerm` prop so the Settings search box
filters it like every other section.

Columns: colour swatch, name, active, actions (edit / delete).
Inactive rows render dimmed.

### `src/components/settings/Settings.tsx`

A new `Activities` tab beside `General`, filling the placeholder comment that
already sits in `tabItems` for future tabs. No existing section moves, so no
existing Settings test changes.

---

## 5. Testing

### Rust

Unit tests in `db/activities.rs`, co-located as every other db module does:

- creating an activity returns it with its generated id
- listing is alphabetical and case-insensitive
- a duplicate name is rejected
- rename, recolour and `is_active` toggle all persist
- delete removes the row

In `db/schema.rs`:

- migration 2 seeds exactly eleven rows with the expected names
- re-running the ladder against a `user_version` 0 database does not duplicate
  seed rows — the existing `migrations_are_idempotent` test extended to cover it

### Frontend

`ActivitiesSettings.test.tsx`, mocking `src/api/activities` and asserting on the
calls the component makes, per the project's testing conventions. Covers: the
list renders, add creates, edit updates, delete confirms then deletes, the
duplicate-name error is shown, and `searchTerm` filters.

One case added to `Settings.test.tsx` for the new tab.

### Known environment trap

Frontend tests must be run from an **uppercase** drive letter
(`D:\Dev\CalendarManager`). From `d:\` Vitest collects zero tests and reports
"no tests" rather than failing — this has now cost time three times.

---

## 6. Accepted limitation

`is_active` has **no functional consumer** in this scope. Nothing selects an
activity yet, so the toggle only dims the row in Settings. It exists so that
retiring an activity later does not mean deleting one that historical events
point at. This is deliberate schema-forward work, not an oversight, and it is
the one piece here that is not carrying its weight until activities attach to
events.
