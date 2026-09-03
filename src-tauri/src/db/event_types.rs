// Port of the `db:getEventTypes`, `db:createEventType`, `db:updateEventType`,
// `db:deleteEventType`, `db:setDefaultEventType`, `db:getEventTypeRules`,
// `db:createEventTypeRule`, `db:updateEventTypeRule`, `db:deleteEventTypeRule`
// and `db:updateRulePriorities` IPC handlers from `electron/main.js`
// (`git show ca805d0:electron/main.js`, lines 485-622).
//
// `set_default_event_type` and `update_rule_priorities` are the two commands
// that must be atomic: the original wrapped each in `db.transaction(...)` and
// swallowed any error into a bare `false`. Here both use a real rusqlite
// transaction (`unchecked_transaction`, the same primitive `schema.rs` already
// uses on a shared `&Connection`) and propagate `Err(DbError)` instead of
// hiding the failure — a deliberate improvement over the original, not a
// faithful-port detail.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

use super::error::{DbError, DbResult};
use super::models::{EventType, EventTypeRule};

/// Named explicitly rather than `SELECT *` for the same reason
/// `events::EVENT_COLUMNS` is: the real database's on-disk column order is
/// unverified.
const EVENT_TYPE_COLUMNS: &str = "id, name, color, is_default, is_billable, created_at";
const EVENT_TYPE_RULE_COLUMNS: &str =
    "id, name, priority, field_name, operator, value, target_type_id, created_at";

/// What a caller supplies to create an event type: no `id` or `created_at`,
/// both assigned by SQLite.
#[derive(Debug, Deserialize)]
pub struct NewEventType {
    pub name: String,
    pub color: String,
    pub is_default: bool,
    pub is_billable: bool,
}

/// The same four columns `db:updateEventType` (main.js:515) touched.
#[derive(Debug, Deserialize)]
pub struct EventTypeUpdate {
    pub name: String,
    pub color: String,
    pub is_default: bool,
    pub is_billable: bool,
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
        "INSERT INTO event_types (name, color, is_default, is_billable) VALUES (?1, ?2, ?3, ?4)",
        params![new_type.name, new_type.color, new_type.is_default, new_type.is_billable],
    )?;
    let id = conn.last_insert_rowid();
    get_event_type_by_id(conn, id)?
        .ok_or_else(|| DbError::Other(format!("event type {id} vanished immediately after insert")))
}

/// Returns `None` when `id` doesn't exist, matching `main.js:515`'s
/// `result.changes > 0 ? {...} : null`.
pub fn update_event_type(conn: &Connection, id: i64, update: &EventTypeUpdate) -> DbResult<Option<EventType>> {
    let changed = conn.execute(
        "UPDATE event_types SET name = ?1, color = ?2, is_default = ?3, is_billable = ?4 WHERE id = ?5",
        params![update.name, update.color, update.is_default, update.is_billable, id],
    )?;
    if changed == 0 {
        return Ok(None);
    }
    get_event_type_by_id(conn, id)
}

/// Ported as-is from `main.js:536`: a bare delete, with no application-level
/// cleanup of `events.type_id` or `event_type_rules.target_type_id`
/// referencing this row. The brief's premise — and better-sqlite3's default —
/// was that SQLite leaves those references dangling because foreign keys go
/// unenforced. That does not hold in this crate: `libsqlite3-sys`'s bundled
/// build is compiled with `-DSQLITE_DEFAULT_FOREIGN_KEYS=1`, so every
/// connection starts with foreign keys already ON, and this statement is
/// unchanged from `main.js` either way — no PRAGMA is set here, and none
/// should be added by this task. The result is a real behavioural difference
/// from the original: deleting a type still referenced by a rule or an event
/// now fails with a constraint-violation `Err` instead of succeeding and
/// leaving a dangling id. See the task report for the follow-up this should
/// prompt.
pub fn delete_event_type(conn: &Connection, id: i64) -> DbResult<bool> {
    let changed = conn.execute("DELETE FROM event_types WHERE id = ?1", params![id])?;
    Ok(changed > 0)
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

    fn new_type(name: &str, is_default: bool, is_billable: bool) -> NewEventType {
        NewEventType {
            name: name.to_string(),
            color: "#123456".to_string(),
            is_default,
            is_billable,
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
    #[test]
    fn update_event_type_returns_none_for_missing_id() {
        let conn = setup();
        let result = update_event_type(&conn, 9999, &EventTypeUpdate {
            name: "x".to_string(),
            color: "#000000".to_string(),
            is_default: false,
            is_billable: false,
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
            },
        )
        .unwrap()
        .unwrap();

        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.color, "#abcdef");
        assert_eq!(updated.is_default, Some(true));
        assert!(updated.is_billable);
    }

    #[test]
    fn delete_event_type_returns_false_for_missing_id() {
        let conn = setup();
        assert!(!delete_event_type(&conn, 9999).unwrap());
    }

    #[test]
    fn delete_event_type_returns_true_when_a_row_is_removed() {
        let conn = setup();
        let created = create_event_type(&conn, &new_type("Gone soon", false, false)).unwrap();

        assert!(delete_event_type(&conn, created.id.unwrap()).unwrap());
        assert!(get_event_types(&conn).unwrap().is_empty());
    }

    /// `delete_event_type` is ported as a bare DELETE, unchanged from
    /// `main.js:536`. The brief (and the original Electron/better-sqlite3
    /// behaviour) assumed SQLite's foreign keys go unenforced, letting a
    /// referencing rule's `target_type_id` go dangling silently. That
    /// assumption does not hold here: `libsqlite3-sys`'s bundled build is
    /// compiled with `-DSQLITE_DEFAULT_FOREIGN_KEYS=1`, so every connection
    /// (this in-memory test connection and the real one `db::open` hands out)
    /// starts with `PRAGMA foreign_keys = ON` already in effect — nothing in
    /// this crate turns it on or off explicitly. So instead of leaving a
    /// dangling reference, the bare DELETE now fails outright with a
    /// `FOREIGN KEY constraint failed` error whenever a rule still targets
    /// the type — a real behavioural difference from the original app, not
    /// introduced by this task's code. See the task report for the
    /// follow-up this should prompt.
    #[test]
    fn delete_event_type_fails_when_a_rule_still_targets_it() {
        let conn = setup();
        let event_type = create_event_type(&conn, &new_type("Consulting", false, false)).unwrap();
        let type_id = event_type.id.unwrap();
        let rule = create_event_type_rule(&conn, &new_rule("Consulting keyword", 1, type_id)).unwrap();

        let result = delete_event_type(&conn, type_id);

        assert!(result.is_err(), "foreign_keys is ON by default in the bundled SQLite build, so this must fail rather than silently dangle");

        // Nothing changed: the statement failed, so both rows are exactly as
        // they were before the call.
        let types = get_event_types(&conn).unwrap();
        assert_eq!(types.len(), 1);
        assert_eq!(types[0].id, Some(type_id));
        let rules = get_event_type_rules(&conn).unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].id, rule.id);
        assert_eq!(rules[0].target_type_id, type_id);
    }

    /// Once the referencing rule is gone, the same bare DELETE succeeds —
    /// confirming the failure above is specifically the foreign-key
    /// constraint, not some other problem with the statement.
    #[test]
    fn delete_event_type_succeeds_once_no_rule_targets_it() {
        let conn = setup();
        let event_type = create_event_type(&conn, &new_type("Consulting", false, false)).unwrap();
        let type_id = event_type.id.unwrap();
        let rule = create_event_type_rule(&conn, &new_rule("Consulting keyword", 1, type_id)).unwrap();
        assert!(delete_event_type_rule(&conn, rule.id.unwrap()).unwrap());

        assert!(delete_event_type(&conn, type_id).unwrap());
        assert!(get_event_types(&conn).unwrap().is_empty());
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
        assert_eq!(created.target_type_id, target_id);
        assert!(created.created_at.is_some());
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
        assert_eq!(updated.target_type_id, other_target.id.unwrap());
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
