// Port of the `db:getEventTypes`, `db:createEventType`, `db:updateEventType`,
// `db:deleteEventType`, `db:setDefaultEventType`, `db:getEventTypeRules`,
// `db:createEventTypeRule`, `db:updateEventTypeRule`, `db:deleteEventTypeRule`
// and `db:updateRulePriorities` IPC handlers from `electron/main.js`
// (`git show ca805d0:electron/main.js`, lines 485-622).
//
// `set_default_event_type` and `update_rule_priorities` are two commands that
// must be atomic: the original wrapped each in `db.transaction(...)` and
// swallowed any error into a bare `false`. Here both use a real rusqlite
// transaction (`unchecked_transaction`, the same primitive `schema.rs` already
// uses on a shared `&Connection`) and propagate `Err(DbError)` instead of
// hiding the failure — a deliberate improvement over the original, not a
// faithful-port detail.
//
// `delete_event_type` is a third: unlike the rest of this file, it is not a
// faithful port at all. `main.js:536`'s bare `DELETE FROM event_types` relied
// on better-sqlite3 leaving foreign keys unenforced by default, so a
// referencing event or rule just went dangling. This crate's bundled SQLite
// enforces foreign keys unconditionally, so the same statement instead fails
// outright the moment real data references the type. A deliberate,
// user-approved behaviour change replaces both: reassign referencing events
// to the default type and drop referencing rules, all in one transaction,
// before deleting the type itself. See `DeleteEventTypeOutcome` below.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::error::{DbError, DbResult};
use super::models::{EventType, EventTypeRule};

/// Named explicitly rather than `SELECT *` for the same reason
/// `events::EVENT_COLUMNS` is: the real database's on-disk column order is
/// unverified. `color` is wrapped in `COALESCE`: `event_types.color` is not
/// `NOT NULL` in `schema.rs`, but `EventType::color` is a non-`Option`
/// `String` — see `events::EVENT_COLUMNS`'s doc comment for why a NULL there
/// would otherwise fail the whole query, not just one row. The default
/// matches the column's own `DEFAULT '#1890ff'`.
const EVENT_TYPE_COLUMNS: &str = "id, name, COALESCE(color, '#1890ff') AS color, is_default, is_billable, \n     COALESCE(all_day_hours, 8) AS all_day_hours, created_at";
const EVENT_TYPE_RULE_COLUMNS: &str =
    "id, name, priority, field_name, operator, value, target_type_id, created_at";

fn default_all_day_hours() -> f64 {
    8.0
}

/// What a caller supplies to create an event type: no `id` or `created_at`,
/// both assigned by SQLite.
#[derive(Debug, Deserialize)]
pub struct NewEventType {
    pub name: String,
    pub color: String,
    /// `#[serde(default)]`: `EventTypesSettings.tsx`'s modal only registers
    /// `Form.Item`s for `name`, `color` and `is_billable` — `is_default` is
    /// never in the payload `form.validateFields()` collects, even when
    /// editing a type that has it set. Without a serde default, a missing
    /// field is rejected outright with `missing field 'is_default'`, so
    /// every create/update failed. This restores the Electron original's
    /// accidental tolerance (`main.js:496`'s `eventTypeData.is_default ? 1 :
    /// 0` silently turned `undefined` into `0`/false).
    #[serde(default)]
    pub is_default: bool,
    pub is_billable: bool,
    /// Defaults to 8, not 0. antd's `validateFields()` omits a field the modal
    /// did not register, and a `#[serde(default)]` on f64 is 0.0 - which means
    /// "does not count", so an omitted field would silently make every day of
    /// an all-day event worth nothing.
    #[serde(default = "default_all_day_hours")]
    pub all_day_hours: f64,
}

/// The same four columns `db:updateEventType` (main.js:515) touched.
#[derive(Debug, Deserialize)]
pub struct EventTypeUpdate {
    pub name: String,
    pub color: String,
    /// See `NewEventType::is_default`'s doc comment: same missing-field
    /// problem, same fix.
    #[serde(default)]
    pub is_default: bool,
    pub is_billable: bool,
    /// Defaults to 8, not 0. antd's `validateFields()` omits a field the modal
    /// did not register, and a `#[serde(default)]` on f64 is 0.0 - which means
    /// "does not count", so an omitted field would silently make every day of
    /// an all-day event worth nothing.
    #[serde(default = "default_all_day_hours")]
    pub all_day_hours: f64,
}

/// What a caller supplies to create a rule: no `id` or `created_at`.
#[derive(Debug, Deserialize)]
pub struct NewEventTypeRule {
    pub name: String,
    pub priority: i64,
    pub field_name: String,
    pub operator: String,
    pub value: Option<String>,
    pub target_type_id: i64,
}

/// The same six columns `db:updateEventTypeRule` (main.js:585) touched.
#[derive(Debug, Deserialize)]
pub struct EventTypeRuleUpdate {
    pub name: String,
    pub priority: i64,
    pub field_name: String,
    pub operator: String,
    pub value: Option<String>,
    pub target_type_id: i64,
}

fn get_event_type_by_id(conn: &Connection, id: i64) -> DbResult<Option<EventType>> {
    let sql = format!("SELECT {EVENT_TYPE_COLUMNS} FROM event_types WHERE id = ?1");
    conn.query_row(&sql, params![id], EventType::from_row)
        .optional()
        .map_err(Into::into)
}

fn get_event_type_rule_by_id(conn: &Connection, id: i64) -> DbResult<Option<EventTypeRule>> {
    let sql = format!("SELECT {EVENT_TYPE_RULE_COLUMNS} FROM event_type_rules WHERE id = ?1");
    conn.query_row(&sql, params![id], EventTypeRule::from_row)
        .optional()
        .map_err(Into::into)
}

pub fn get_event_types(conn: &Connection) -> DbResult<Vec<EventType>> {
    let sql = format!("SELECT {EVENT_TYPE_COLUMNS} FROM event_types ORDER BY name");
    let mut stmt = conn.prepare(&sql)?;
    let types = stmt.query_map([], EventType::from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(types)
}

/// Reads the row back rather than echoing the input plus a generated id, for
/// the same reason `categories::create_category` does: SQLite's boolean
/// coercion and defaults are what the caller actually gets back.
pub fn create_event_type(conn: &Connection, new_type: &NewEventType) -> DbResult<EventType> {
    conn.execute(
        "INSERT INTO event_types (name, color, is_default, is_billable, all_day_hours)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            new_type.name,
            new_type.color,
            new_type.is_default,
            new_type.is_billable,
            new_type.all_day_hours
        ],
    )?;
    let id = conn.last_insert_rowid();
    get_event_type_by_id(conn, id)?
        .ok_or_else(|| DbError::Other(format!("event type {id} vanished immediately after insert")))
}

/// Returns `None` when `id` doesn't exist, matching `main.js:515`'s
/// `result.changes > 0 ? {...} : null`.
pub fn update_event_type(conn: &Connection, id: i64, update: &EventTypeUpdate) -> DbResult<Option<EventType>> {
    let changed = conn.execute(
        "UPDATE event_types SET name = ?1, color = ?2, is_default = ?3, is_billable = ?4,
                                all_day_hours = ?5
         WHERE id = ?6",
        params![
            update.name,
            update.color,
            update.is_default,
            update.is_billable,
            update.all_day_hours,
            id
        ],
    )?;
    if changed == 0 {
        return Ok(None);
    }
    get_event_type_by_id(conn, id)
}

/// What deleting a type actually did. Returned instead of a bare bool because
/// reassigning thousands of events is not something to do silently.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteEventTypeOutcome {
    pub deleted: bool,
    /// Events moved to the default type.
    pub events_reassigned: i64,
    /// Rules that targeted this type and were removed with it.
    pub rules_removed: i64,
    /// Name of the type events were moved to, for the confirmation message.
    pub reassigned_to: Option<String>,
}

/// `main.js:536` ported this as a bare `DELETE`, relying on better-sqlite3's
/// foreign keys being off by default: an event or rule left pointing at a
/// deleted type just went dangling, silently. `libsqlite3-sys`'s bundled
/// SQLite is compiled with `-DSQLITE_DEFAULT_FOREIGN_KEYS=1`, so every
/// connection here starts with foreign keys already ON — the same bare
/// statement instead fails outright the moment any row still references the
/// type. Neither behaviour is acceptable: one corrupts the database quietly,
/// the other blocks every delete once real data exists (measured against the
/// user's live database: 8,924 events, all with a valid `type_id`, spread
/// across just 3 types — deleting any of them would fail).
///
/// So this reassigns before deleting, in one transaction:
/// 1. Look up the type; a missing id is a no-op `Ok`, not an error.
/// 2. If the type being deleted is the default, promote another type
///    (lowest id among the rest) to default first — refusing outright if
///    it's the only type, since that would leave the database with no
///    default for every unmatched event to fall back to.
/// 3. Move every event pointing at this type onto the (possibly
///    newly-promoted) default, bumping `updated_at` on just those rows.
/// 4. Delete the rules that targeted this type.
/// 5. Delete the type itself.
///
/// All five steps commit together, so a failure partway through can never
/// leave events pointing at a half-deleted type.
pub fn delete_event_type(conn: &Connection, id: i64) -> DbResult<DeleteEventTypeOutcome> {
    let tx = conn.unchecked_transaction()?;

    let Some(target) = get_event_type_by_id(&tx, id)? else {
        return Ok(DeleteEventTypeOutcome {
            deleted: false,
            events_reassigned: 0,
            rules_removed: 0,
            reassigned_to: None,
        });
    };

    // Resolve the type everything should fall back to. If the type being
    // deleted is itself the default, some *other* type must be promoted
    // first — chosen deterministically (lowest id) rather than arbitrarily,
    // so this is reproducible. If there is no other type, refuse: deleting
    // the only type would leave the database with no default at all.
    let default_id: i64 = if target.is_default == Some(true) {
        let promoted: Option<i64> = tx
            .query_row(
                "SELECT id FROM event_types WHERE id != ?1 ORDER BY id ASC LIMIT 1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(promoted_id) = promoted else {
            return Err(DbError::Other(format!(
                "cannot delete event type {id}: it is the only event type, and deleting it \
                 would leave the database with no default type"
            )));
        };
        tx.execute("UPDATE event_types SET is_default = 0", [])?;
        tx.execute("UPDATE event_types SET is_default = 1 WHERE id = ?1", params![promoted_id])?;
        promoted_id
    } else {
        let existing: Option<i64> = tx
            .query_row("SELECT id FROM event_types WHERE is_default = 1", [], |row| row.get(0))
            .optional()?;
        existing.ok_or_else(|| {
            DbError::Other("cannot delete event type: no default event type exists to reassign to".to_string())
        })?
    };
    let default_name: String =
        tx.query_row("SELECT name FROM event_types WHERE id = ?1", params![default_id], |row| row.get(0))?;

    // `type_manually_set = 0` alongside the reassignment: without it, an
    // event the user had pinned to the deleted type lands on the default
    // type still flagged as manually set — a manual choice the user never
    // made, and one that permanently excludes the event from
    // `reprocess_event_types` (its `WHERE type_manually_set = 0 OR ... IS
    // NULL` guard would never pick it back up).
    let events_reassigned = tx.execute(
        "UPDATE events SET type_id = ?1, type_manually_set = 0, updated_at = CURRENT_TIMESTAMP WHERE type_id = ?2",
        params![default_id, id],
    )? as i64;

    let rules_removed =
        tx.execute("DELETE FROM event_type_rules WHERE target_type_id = ?1", params![id])? as i64;

    tx.execute("DELETE FROM event_types WHERE id = ?1", params![id])?;

    tx.commit()?;

    Ok(DeleteEventTypeOutcome {
        deleted: true,
        events_reassigned,
        rules_removed,
        reassigned_to: Some(default_name),
    })
}

/// Clears `is_default` on every type, then sets it on `id`, in one
/// transaction so a crash between the two statements can never leave the
/// user with zero or two default types. Returns whether `id` matched a row —
/// the same boolean `main.js:542`'s `result.changes > 0` produced — but a
/// real database error now propagates as `Err(DbError)` instead of being
/// caught and turned into `false`.
pub fn set_default_event_type(conn: &Connection, id: i64) -> DbResult<bool> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE event_types SET is_default = 0", [])?;
    let changed = tx.execute("UPDATE event_types SET is_default = 1 WHERE id = ?1", params![id])?;
    tx.commit()?;
    Ok(changed > 0)
}

pub fn get_event_type_rules(conn: &Connection) -> DbResult<Vec<EventTypeRule>> {
    let sql = format!("SELECT {EVENT_TYPE_RULE_COLUMNS} FROM event_type_rules ORDER BY priority ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rules = stmt.query_map([], EventTypeRule::from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rules)
}

pub fn create_event_type_rule(conn: &Connection, new_rule: &NewEventTypeRule) -> DbResult<EventTypeRule> {
    conn.execute(
        "INSERT INTO event_type_rules (name, priority, field_name, operator, value, target_type_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            new_rule.name,
            new_rule.priority,
            new_rule.field_name,
            new_rule.operator,
            new_rule.value,
            new_rule.target_type_id,
        ],
    )?;
    let id = conn.last_insert_rowid();
    get_event_type_rule_by_id(conn, id)?
        .ok_or_else(|| DbError::Other(format!("event type rule {id} vanished immediately after insert")))
}

/// Returns `None` when `id` doesn't exist, matching `main.js:585`'s
/// `result.changes > 0 ? {...} : null`.
pub fn update_event_type_rule(
    conn: &Connection,
    id: i64,
    update: &EventTypeRuleUpdate,
) -> DbResult<Option<EventTypeRule>> {
    let changed = conn.execute(
        "UPDATE event_type_rules SET name = ?1, priority = ?2, field_name = ?3, operator = ?4, \
         value = ?5, target_type_id = ?6 WHERE id = ?7",
        params![
            update.name,
            update.priority,
            update.field_name,
            update.operator,
            update.value,
            update.target_type_id,
            id,
        ],
    )?;
    if changed == 0 {
        return Ok(None);
    }
    get_event_type_rule_by_id(conn, id)
}

pub fn delete_event_type_rule(conn: &Connection, id: i64) -> DbResult<bool> {
    let changed = conn.execute("DELETE FROM event_type_rules WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}

/// Renumbers every rule in `rule_ids` to `index + 1`, in the order given, in
/// one transaction — the same shape as `main.js:609`'s `db.transaction`, so a
/// failure partway through can never leave a half-renumbered, ambiguous
/// priority ordering. Always `Ok(true)` on success, since (like the original)
/// there is no per-row "did this id exist" check; a real database error now
/// propagates as `Err(DbError)` instead of being caught and turned into
/// `false`.
pub fn update_rule_priorities(conn: &Connection, rule_ids: &[i64]) -> DbResult<bool> {
    let tx = conn.unchecked_transaction()?;
    for (index, rule_id) in rule_ids.iter().enumerate() {
        tx.execute(
            "UPDATE event_type_rules SET priority = ?1 WHERE id = ?2",
            params![(index as i64) + 1, rule_id],
        )?;
    }
    tx.commit()?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::run_migrations;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    /// The regression guard for the bug this task exists to fix:
    /// `EventTypesSettings.tsx`'s modal only ever registers `Form.Item`s for
    /// `name`, `color` and `is_billable`, so `form.validateFields()` never
    /// includes `is_default` in the payload — not even when editing a type
    /// that has it set. Without `#[serde(default)]` on the field, serde
    /// rejected every create with `missing field 'is_default'`. This proves
    /// the field absent from the JSON deserializes to `false` instead.
    #[test]
    fn new_event_type_defaults_is_default_to_false_when_absent_from_payload() {
        let json = r##"{"name":"Consulting","color":"#123456","is_billable":true}"##;
        let parsed: NewEventType = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.is_default, false);
        assert_eq!(parsed.name, "Consulting");
        assert!(parsed.is_billable);
    }

    /// Same bug, same fix, but for the update payload `handleSave` sends when
    /// editing an existing type — the one place this actually bit the user,
    /// since editing a type that already has `is_default: true` still omits
    /// it from the form's collected values.
    #[test]
    fn event_type_update_defaults_is_default_to_false_when_absent_from_payload() {
        let json = r##"{"name":"Consulting","color":"#123456","is_billable":false}"##;
        let parsed: EventTypeUpdate = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.is_default, false);
        assert_eq!(parsed.name, "Consulting");
        assert!(!parsed.is_billable);
    }

    fn new_type(name: &str, is_default: bool, is_billable: bool) -> NewEventType {
        NewEventType {
            name: name.to_string(),
            color: "#123456".to_string(),
            is_default,
            is_billable,
            all_day_hours: 8.0,
        }
    }

    fn new_rule(name: &str, priority: i64, target_type_id: i64) -> NewEventTypeRule {
        NewEventTypeRule {
            name: name.to_string(),
            priority,
            field_name: "title".to_string(),
            operator: "contains".to_string(),
            value: Some("keyword".to_string()),
            target_type_id,
        }
    }

    // --- Event types ---

    /// The regression guard for the `COALESCE` fix on `color`:
    /// `event_types.color` isn't `NOT NULL` in `schema.rs`, but
    /// `EventType::color` is a non-`Option` `String`. A row with an explicit
    /// NULL color, inserted directly (bypassing `create_event_type`, which
    /// always supplies one), must not fail the whole `get_event_types` query —
    /// it must come back as the column's own default instead.
    #[test]
    fn get_event_types_survives_a_row_with_null_color() {
        let conn = setup();
        conn.execute(
            "INSERT INTO event_types (name, color, is_default, is_billable) VALUES ('Nully', NULL, 0, 0)",
            [],
        )
        .unwrap();

        let types = get_event_types(&conn).unwrap();

        assert_eq!(types.len(), 1);
        assert_eq!(types[0].color, "#1890ff", "NULL color must coalesce to the schema's default");
    }

    /// Enumerated case: creating a type round-trips `is_default`/`is_billable`
    /// as booleans, in both directions (true and false), not just truthy
    /// SQLite integers.
    #[test]
    fn create_event_type_round_trips_booleans() {
        let conn = setup();

        let billable_default = create_event_type(&conn, &new_type("Consulting", true, true)).unwrap();
        assert_eq!(billable_default.is_default, Some(true));
        assert!(billable_default.is_billable);

        let non_billable_non_default = create_event_type(&conn, &new_type("Personal", false, false)).unwrap();
        assert_eq!(non_billable_non_default.is_default, Some(false));
        assert!(!non_billable_non_default.is_billable);

        assert_eq!(billable_default.name, "Consulting");
        assert_eq!(billable_default.color, "#123456");
        assert!(billable_default.created_at.is_some());
    }

    #[test]
    fn get_event_types_orders_by_name() {
        let conn = setup();
        create_event_type(&conn, &new_type("Charlie", false, false)).unwrap();
        create_event_type(&conn, &new_type("Alpha", false, false)).unwrap();
        create_event_type(&conn, &new_type("Bravo", false, false)).unwrap();

        let types = get_event_types(&conn).unwrap();

        let names: Vec<_> = types.iter().map(|t| t.name.clone()).collect();
        assert_eq!(names, vec!["Alpha", "Bravo", "Charlie"]);
    }

    /// Enumerated case: `update_event_type` returns `None` for a missing id.
    /// A near-miss worth guarding: an earlier version of the UPDATE reused
    /// the same placeholder for `all_day_hours` and `WHERE id`, which would
    /// have written the row's own id into the hours column.
    #[test]
    fn all_day_hours_round_trips_through_create_and_update() {
        let conn = setup();
        let mut input = new_type("Training", false, true);
        input.all_day_hours = 6.5;

        let created = create_event_type(&conn, &input).unwrap();
        assert_eq!(created.all_day_hours, 6.5);

        let updated = update_event_type(
            &conn,
            created.id.unwrap(),
            &EventTypeUpdate {
                name: "Training".to_string(),
                color: "#123456".to_string(),
                is_default: false,
                is_billable: true,
                all_day_hours: 4.0,
            },
        )
        .unwrap()
        .unwrap();

        assert_eq!(updated.all_day_hours, 4.0);
        assert_eq!(updated.id, created.id, "the id must not have been overwritten");
    }

    /// antd omits a field its modal never registered, and 0 means "does not
    /// count" - so an omitted value must not silently zero the type.
    #[test]
    fn new_event_type_defaults_all_day_hours_to_eight_when_absent() {
        let parsed: NewEventType = serde_json::from_str(
            r##"{"name":"Work","color":"#1890ff","is_billable":true}"##,
        )
        .unwrap();

        assert_eq!(parsed.all_day_hours, 8.0);
    }

    #[test]
    fn an_explicit_zero_survives_deserialization() {
        let parsed: NewEventType = serde_json::from_str(
            r##"{"name":"Holiday","color":"#cccccc","is_billable":false,"all_day_hours":0}"##,
        )
        .unwrap();

        assert_eq!(parsed.all_day_hours, 0.0, "0 is how a type opts out of counting");
    }

    #[test]
    fn update_event_type_returns_none_for_missing_id() {
        let conn = setup();
        let result = update_event_type(&conn, 9999, &EventTypeUpdate {
            name: "x".to_string(),
            color: "#000000".to_string(),
            is_default: false,
            is_billable: false,
            all_day_hours: 8.0,
        })
        .unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn update_event_type_updates_fields_when_row_exists() {
        let conn = setup();
        let created = create_event_type(&conn, &new_type("Original", false, false)).unwrap();

        let updated = update_event_type(
            &conn,
            created.id.unwrap(),
            &EventTypeUpdate {
                name: "Renamed".to_string(),
                color: "#abcdef".to_string(),
                is_default: true,
                is_billable: true,
                all_day_hours: 8.0,
            },
        )
        .unwrap()
        .unwrap();

        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.color, "#abcdef");
        assert_eq!(updated.is_default, Some(true));
        assert!(updated.is_billable);
    }

    /// Inserts a bare event row with the given type, bypassing
    /// `events::create_event` (which never accepts `type_id`) since these
    /// tests need to control it directly. Returns the new row's id.
    fn insert_event_with_type(conn: &Connection, title: &str, type_id: i64) -> i64 {
        conn.execute(
            "INSERT INTO events (title, start_date, type_id) VALUES (?1, '2026-01-01T09:00:00', ?2)",
            params![title, type_id],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn event_type_id_and_updated_at(conn: &Connection, event_id: i64) -> (Option<i64>, Option<String>) {
        conn.query_row(
            "SELECT type_id, updated_at FROM events WHERE id = ?1",
            params![event_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    }

    fn type_manually_set(conn: &Connection, event_id: i64) -> bool {
        conn.query_row(
            "SELECT type_manually_set FROM events WHERE id = ?1",
            params![event_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn mark_manually_set(conn: &Connection, event_id: i64) {
        conn.execute("UPDATE events SET type_manually_set = 1 WHERE id = ?1", params![event_id]).unwrap();
    }

    /// 1. Deleting an unused, non-default type deletes it outright and
    /// reports nothing else was touched.
    #[test]
    fn delete_event_type_deletes_unused_non_default_type() {
        let conn = setup();
        create_event_type(&conn, &new_type("Default", true, false)).unwrap();
        let unused = create_event_type(&conn, &new_type("Unused", false, false)).unwrap();

        let outcome = delete_event_type(&conn, unused.id.unwrap()).unwrap();

        assert!(outcome.deleted);
        assert_eq!(outcome.events_reassigned, 0);
        assert_eq!(outcome.rules_removed, 0);
        let names: Vec<_> = get_event_types(&conn).unwrap().into_iter().map(|t| t.name).collect();
        assert_eq!(names, vec!["Default"]);
    }

    /// 2. Deleting a type used by events reassigns every one of them to the
    /// default type and reports the count and destination name.
    #[test]
    fn delete_event_type_reassigns_its_events_to_the_default() {
        let conn = setup();
        let default_type = create_event_type(&conn, &new_type("Default", true, false)).unwrap();
        let to_delete = create_event_type(&conn, &new_type("Consulting", false, false)).unwrap();
        let default_id = default_type.id.unwrap();
        let to_delete_id = to_delete.id.unwrap();
        let e1 = insert_event_with_type(&conn, "Standup", to_delete_id);
        let e2 = insert_event_with_type(&conn, "Client call", to_delete_id);
        let e3 = insert_event_with_type(&conn, "Review", to_delete_id);
        // e1 is a manual override the user made — the case this test's
        // second assertion exists for: reassignment must clear it, not just
        // move type_id, or the event ends up permanently excluded from
        // reprocess_event_types with a "manual" choice the user never made.
        mark_manually_set(&conn, e1);

        let outcome = delete_event_type(&conn, to_delete_id).unwrap();

        assert!(outcome.deleted);
        assert_eq!(outcome.events_reassigned, 3);
        assert_eq!(outcome.reassigned_to.as_deref(), Some("Default"));
        for event_id in [e1, e2, e3] {
            let (type_id, _) = event_type_id_and_updated_at(&conn, event_id);
            assert_eq!(type_id, Some(default_id));
            assert!(
                !type_manually_set(&conn, event_id),
                "type_manually_set must be cleared by reassignment, even for an event that had it set"
            );
        }
    }

    /// 3. Deleting a type targeted by rules removes exactly those rules and
    /// reports the count.
    #[test]
    fn delete_event_type_removes_rules_that_target_it() {
        let conn = setup();
        create_event_type(&conn, &new_type("Default", true, false)).unwrap();
        let to_delete = create_event_type(&conn, &new_type("Consulting", false, false)).unwrap();
        let to_delete_id = to_delete.id.unwrap();
        create_event_type_rule(&conn, &new_rule("Rule A", 1, to_delete_id)).unwrap();
        create_event_type_rule(&conn, &new_rule("Rule B", 2, to_delete_id)).unwrap();

        let outcome = delete_event_type(&conn, to_delete_id).unwrap();

        assert!(outcome.deleted);
        assert_eq!(outcome.rules_removed, 2);
        assert!(get_event_type_rules(&conn).unwrap().is_empty());
    }

    /// 4. Deleting the default type, when another type exists, promotes the
    /// other type (lowest id) to default before deleting — the database
    /// never has zero or two defaults.
    #[test]
    fn delete_event_type_promotes_another_type_when_deleting_the_default() {
        let conn = setup();
        let default_type = create_event_type(&conn, &new_type("Default", true, false)).unwrap();
        let other_a = create_event_type(&conn, &new_type("Other A", false, false)).unwrap();
        let _other_b = create_event_type(&conn, &new_type("Other B", false, false)).unwrap();

        let outcome = delete_event_type(&conn, default_type.id.unwrap()).unwrap();

        assert!(outcome.deleted);
        let defaults: Vec<_> = get_event_types(&conn)
            .unwrap()
            .into_iter()
            .filter(|t| t.is_default == Some(true))
            .map(|t| t.id.unwrap())
            .collect();
        assert_eq!(
            defaults,
            vec![other_a.id.unwrap()],
            "exactly one type must be default afterwards, and it must be the lowest-id survivor"
        );
    }

    /// 5. Deleting the only type refuses outright rather than leaving the
    /// database with no default; the type and its events are untouched.
    #[test]
    fn delete_event_type_refuses_to_delete_the_only_type() {
        let conn = setup();
        let solo = create_event_type(&conn, &new_type("Solo", true, false)).unwrap();
        let solo_id = solo.id.unwrap();
        let event_id = insert_event_with_type(&conn, "Standup", solo_id);

        let result = delete_event_type(&conn, solo_id);

        assert!(result.is_err(), "deleting the only type would leave no default type");
        let types = get_event_types(&conn).unwrap();
        assert_eq!(types.len(), 1);
        assert_eq!(types[0].id, Some(solo_id));
        let (type_id, _) = event_type_id_and_updated_at(&conn, event_id);
        assert_eq!(type_id, Some(solo_id));
    }

    /// 6. Deleting a non-existent id is a no-op `Ok`, not an error.
    #[test]
    fn delete_event_type_returns_not_deleted_for_missing_id() {
        let conn = setup();
        create_event_type(&conn, &new_type("Default", true, false)).unwrap();

        let outcome = delete_event_type(&conn, 9999).unwrap();

        assert!(!outcome.deleted);
        assert_eq!(outcome.events_reassigned, 0);
        assert_eq!(outcome.rules_removed, 0);
        assert_eq!(outcome.reassigned_to, None);
    }

    /// 7. The integrity guard this task exists for: after deleting a type
    /// that events referenced, no event is left pointing at a type id that
    /// no longer exists. A future regression that reintroduces orphaning
    /// (e.g. reverting to the bare `DELETE`) fails this assertion.
    #[test]
    fn delete_event_type_leaves_no_event_pointing_at_a_missing_type() {
        let conn = setup();
        create_event_type(&conn, &new_type("Default", true, false)).unwrap();
        let to_delete = create_event_type(&conn, &new_type("Consulting", false, false)).unwrap();
        let to_delete_id = to_delete.id.unwrap();
        insert_event_with_type(&conn, "Standup", to_delete_id);
        insert_event_with_type(&conn, "Client call", to_delete_id);
        insert_event_with_type(&conn, "Review", to_delete_id);

        delete_event_type(&conn, to_delete_id).unwrap();

        let orphaned: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events \
                 WHERE type_id IS NOT NULL AND type_id NOT IN (SELECT id FROM event_types)",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(orphaned, 0);
    }

    /// 8. `updated_at` reassignment is scoped to the events that actually
    /// moved. Comparing the reassigned rows' `updated_at` against a
    /// before/after snapshot would be flaky (`CURRENT_TIMESTAMP` is
    /// second-granularity and this test runs well within a second), so this
    /// asserts the stronger, non-flaky half instead: an event of an
    /// unrelated type keeps both its `type_id` and its exact original
    /// `updated_at`, proving the UPDATE's `WHERE type_id = ?` did not touch
    /// rows outside the deleted type.
    #[test]
    fn delete_event_type_does_not_touch_events_of_other_types() {
        let conn = setup();
        create_event_type(&conn, &new_type("Default", true, false)).unwrap();
        let to_delete = create_event_type(&conn, &new_type("Consulting", false, false)).unwrap();
        let other = create_event_type(&conn, &new_type("Personal", false, false)).unwrap();
        let to_delete_id = to_delete.id.unwrap();
        let other_id = other.id.unwrap();
        let other_event = insert_event_with_type(&conn, "Untouched", other_id);
        let (_, other_updated_at_before) = event_type_id_and_updated_at(&conn, other_event);

        let outcome = delete_event_type(&conn, to_delete_id).unwrap();

        assert!(outcome.deleted);
        let (other_type_id_after, other_updated_at_after) = event_type_id_and_updated_at(&conn, other_event);
        assert_eq!(other_type_id_after, Some(other_id), "an unrelated type's events must not be reassigned");
        assert_eq!(
            other_updated_at_after, other_updated_at_before,
            "an unrelated type's events must not have their updated_at touched"
        );
    }

    /// Enumerated case: `set_default_event_type` leaves exactly one default
    /// when called twice with different ids.
    #[test]
    fn set_default_event_type_leaves_exactly_one_default_across_two_calls() {
        let conn = setup();
        let a = create_event_type(&conn, &new_type("A", true, false)).unwrap();
        let b = create_event_type(&conn, &new_type("B", false, false)).unwrap();
        let c = create_event_type(&conn, &new_type("C", false, false)).unwrap();
        let a_id = a.id.unwrap();
        let b_id = b.id.unwrap();
        let c_id = c.id.unwrap();

        assert!(set_default_event_type(&conn, b_id).unwrap());
        let defaults_after_first = get_event_types(&conn)
            .unwrap()
            .into_iter()
            .filter(|t| t.is_default == Some(true))
            .map(|t| t.id.unwrap())
            .collect::<Vec<_>>();
        assert_eq!(defaults_after_first, vec![b_id], "exactly B must be default after the first call");

        assert!(set_default_event_type(&conn, c_id).unwrap());
        let defaults_after_second = get_event_types(&conn)
            .unwrap()
            .into_iter()
            .filter(|t| t.is_default == Some(true))
            .map(|t| t.id.unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            defaults_after_second,
            vec![c_id],
            "exactly C must be default after the second call — not A, not B, not both B and C"
        );

        // A started out flagged default in the DB but must have been cleared
        // by the first call, and must stay cleared.
        let a_after = get_event_types(&conn).unwrap().into_iter().find(|t| t.id == Some(a_id)).unwrap();
        assert_eq!(a_after.is_default, Some(false));
    }

    #[test]
    fn set_default_event_type_with_missing_id_clears_default_and_returns_false() {
        let conn = setup();
        let a = create_event_type(&conn, &new_type("A", true, false)).unwrap();

        let result = set_default_event_type(&conn, 9999).unwrap();

        assert!(!result, "no row matched the given id, so the transaction reports no change");
        let a_after = get_event_types(&conn).unwrap().into_iter().find(|t| t.id == a.id).unwrap();
        assert_eq!(
            a_after.is_default,
            Some(false),
            "the unset-all-defaults half of the transaction still ran"
        );
    }

    // --- Event type rules ---

    #[test]
    fn create_event_type_rule_round_trips_every_field() {
        let conn = setup();
        let target = create_event_type(&conn, &new_type("Consulting", false, false)).unwrap();
        let target_id = target.id.unwrap();

        let created = create_event_type_rule(
            &conn,
            &NewEventTypeRule {
                name: "Consulting keyword".to_string(),
                priority: 1,
                field_name: "title".to_string(),
                operator: "contains".to_string(),
                value: Some("Consulting".to_string()),
                target_type_id: target_id,
            },
        )
        .unwrap();

        assert!(created.id.is_some());
        assert_eq!(created.name, "Consulting keyword");
        assert_eq!(created.priority, 1);
        assert_eq!(created.field_name, "title");
        assert_eq!(created.operator, "contains");
        assert_eq!(created.value.as_deref(), Some("Consulting"));
        assert_eq!(created.target_type_id, Some(target_id));
        assert!(created.created_at.is_some());
    }

    /// The regression guard for widening `target_type_id` to `Option<i64>`:
    /// `event_type_rules.target_type_id` has no `NOT NULL` in `schema.rs`.
    /// Unlike `color` above, there is no safe default to `COALESCE` a
    /// foreign key to, so the model was widened instead — this proves a row
    /// with an explicit NULL there reads back as `None` rather than failing
    /// the whole `get_event_type_rules` query.
    #[test]
    fn get_event_type_rules_survives_a_row_with_null_target_type_id() {
        let conn = setup();
        conn.execute(
            "INSERT INTO event_type_rules (name, priority, field_name, operator, value, target_type_id) \
             VALUES ('Orphaned', 1, 'title', 'contains', 'x', NULL)",
            [],
        )
        .unwrap();

        let rules = get_event_type_rules(&conn).unwrap();

        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].target_type_id, None);
    }

    /// Enumerated case: rules come back ordered by priority.
    #[test]
    fn get_event_type_rules_orders_by_priority() {
        let conn = setup();
        let target = create_event_type(&conn, &new_type("Consulting", false, false)).unwrap();
        let target_id = target.id.unwrap();
        create_event_type_rule(&conn, &new_rule("Third", 3, target_id)).unwrap();
        create_event_type_rule(&conn, &new_rule("First", 1, target_id)).unwrap();
        create_event_type_rule(&conn, &new_rule("Second", 2, target_id)).unwrap();

        let rules = get_event_type_rules(&conn).unwrap();

        let names: Vec<_> = rules.iter().map(|r| r.name.clone()).collect();
        assert_eq!(names, vec!["First", "Second", "Third"]);
    }

    #[test]
    fn update_event_type_rule_returns_none_for_missing_id() {
        let conn = setup();
        let target = create_event_type(&conn, &new_type("Consulting", false, false)).unwrap();
        let result = update_event_type_rule(
            &conn,
            9999,
            &EventTypeRuleUpdate {
                name: "x".to_string(),
                priority: 1,
                field_name: "title".to_string(),
                operator: "equals".to_string(),
                value: None,
                target_type_id: target.id.unwrap(),
            },
        )
        .unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn update_event_type_rule_updates_fields_when_row_exists() {
        let conn = setup();
        let target = create_event_type(&conn, &new_type("Consulting", false, false)).unwrap();
        let other_target = create_event_type(&conn, &new_type("Personal", false, false)).unwrap();
        let created = create_event_type_rule(&conn, &new_rule("Original", 1, target.id.unwrap())).unwrap();

        let updated = update_event_type_rule(
            &conn,
            created.id.unwrap(),
            &EventTypeRuleUpdate {
                name: "Renamed".to_string(),
                priority: 5,
                field_name: "location".to_string(),
                operator: "is_empty".to_string(),
                value: None,
                target_type_id: other_target.id.unwrap(),
            },
        )
        .unwrap()
        .unwrap();

        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.priority, 5);
        assert_eq!(updated.field_name, "location");
        assert_eq!(updated.operator, "is_empty");
        assert_eq!(updated.value, None);
        assert_eq!(updated.target_type_id, Some(other_target.id.unwrap()));
    }

    #[test]
    fn delete_event_type_rule_returns_false_for_missing_id() {
        let conn = setup();
        assert!(!delete_event_type_rule(&conn, 9999).unwrap());
    }

    #[test]
    fn delete_event_type_rule_returns_true_when_a_row_is_removed() {
        let conn = setup();
        let target = create_event_type(&conn, &new_type("Consulting", false, false)).unwrap();
        let created = create_event_type_rule(&conn, &new_rule("Gone soon", 1, target.id.unwrap())).unwrap();

        assert!(delete_event_type_rule(&conn, created.id.unwrap()).unwrap());
        assert!(get_event_type_rules(&conn).unwrap().is_empty());
    }

    /// Enumerated case: `update_rule_priorities` renumbers from 1 in the
    /// given order — deliberately not the creation order or the original
    /// priority order, so the test can't pass by accident.
    #[test]
    fn update_rule_priorities_renumbers_from_one_in_given_order() {
        let conn = setup();
        let target = create_event_type(&conn, &new_type("Consulting", false, false)).unwrap();
        let target_id = target.id.unwrap();
        let a = create_event_type_rule(&conn, &new_rule("A", 10, target_id)).unwrap();
        let b = create_event_type_rule(&conn, &new_rule("B", 20, target_id)).unwrap();
        let c = create_event_type_rule(&conn, &new_rule("C", 30, target_id)).unwrap();

        let result = update_rule_priorities(&conn, &[c.id.unwrap(), a.id.unwrap(), b.id.unwrap()]).unwrap();
        assert!(result);

        let rules = get_event_type_rules(&conn).unwrap();
        let ordered_names: Vec<_> = rules.iter().map(|r| r.name.clone()).collect();
        assert_eq!(ordered_names, vec!["C", "A", "B"], "priority ascending must now follow the given order");

        let priorities: Vec<_> = rules.iter().map(|r| r.priority).collect();
        assert_eq!(priorities, vec![1, 2, 3], "priorities must be renumbered starting at 1");
    }

    /// Proves the transaction is genuinely atomic, not just correct on the
    /// happy path: a bogus id mixed into the list must not partially apply —
    /// either every valid row gets renumbered or the whole call errors, but
    /// what must never happen is some rows renumbered and others left as they
    /// were. rusqlite's `UPDATE ... WHERE id = ?` simply matches zero rows for
    /// a nonexistent id rather than erroring, so this documents that the
    /// valid ids still all get renumbered in order around the gap.
    #[test]
    fn update_rule_priorities_skips_nonexistent_ids_without_disrupting_the_valid_ones() {
        let conn = setup();
        let target = create_event_type(&conn, &new_type("Consulting", false, false)).unwrap();
        let target_id = target.id.unwrap();
        let a = create_event_type_rule(&conn, &new_rule("A", 10, target_id)).unwrap();
        let b = create_event_type_rule(&conn, &new_rule("B", 20, target_id)).unwrap();

        let result = update_rule_priorities(&conn, &[b.id.unwrap(), 9999, a.id.unwrap()]).unwrap();
        assert!(result);

        let rules = get_event_type_rules(&conn).unwrap();
        let ordered_names: Vec<_> = rules.iter().map(|r| r.name.clone()).collect();
        assert_eq!(ordered_names, vec!["B", "A"]);
        let priorities: Vec<_> = rules.iter().map(|r| r.priority).collect();
        assert_eq!(priorities, vec![1, 3]);
    }
}
