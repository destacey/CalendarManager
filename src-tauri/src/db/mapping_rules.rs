// Mapping rules: how a calendar event finds its project and activity.
//
// A rule carries up to three conditions - name, category, event type - and
// ALL supplied conditions must hold for it to match. Rules are checked in
// priority order and the first match wins, exactly like `event_type_rules`.
//
// `show_as` is deliberately not a condition. The user marks client meetings
// away from the office as out-of-office, so `oof` means "not at my desk", not
// "not working"; a rule keyed on it would file real billable work as leave.
// The existing `event_type_rules` already fold `show_as = free` into the Info
// type, so a `type_id` condition picks that signal up second-hand and curated.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::error::{DbError, DbResult};

const RULE_COLUMNS: &str = "id, priority, name_operator, name_value, category_value, \
                            type_id, project_id, activity_id, is_active, created_at";

/// How a rule compares an event's title. `is` is exact (case-insensitive);
/// `contains` is a substring. Two operators is the minimum that works - `is`
/// alone cannot catch both "1:1 - Sarah Chen" and "1:1 - Tom".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NameOperator {
    Is,
    Contains,
}

impl NameOperator {
    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "is" => Some(Self::Is),
            "contains" => Some(Self::Contains),
            _ => None,
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            Self::Is => "is",
            Self::Contains => "contains",
        }
    }
}

/// Mirrors `MappingRule` in `src/types/index.ts`. Domain field names stay
/// `snake_case` across IPC, so no serde rename.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MappingRule {
    pub id: Option<i64>,
    pub priority: i64,
    /// `None` when the rule does not test the name at all.
    pub name_operator: Option<String>,
    pub name_value: Option<String>,
    pub category_value: Option<String>,
    pub type_id: Option<i64>,
    pub project_id: i64,
    /// `None` means "this project, no activity" - a real answer, not a gap.
    pub activity_id: Option<i64>,
    pub is_active: bool,
    pub created_at: Option<String>,
}

impl MappingRule {
    fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            priority: row.get("priority")?,
            name_operator: row.get("name_operator")?,
            name_value: row.get("name_value")?,
            category_value: row.get("category_value")?,
            type_id: row.get("type_id")?,
            project_id: row.get("project_id")?,
            activity_id: row.get("activity_id")?,
            is_active: row.get("is_active")?,
            created_at: row.get("created_at")?,
        })
    }

    /// Does this rule test anything at all? A rule with no conditions would
    /// match every event, silently swallowing the whole calendar the moment
    /// it reached the top of the list.
    fn has_a_condition(&self) -> bool {
        self.name_value.is_some() || self.category_value.is_some() || self.type_id.is_some()
    }

    /// All supplied conditions must hold. An absent condition is not a
    /// wildcard that fails - it is simply not tested.
    pub fn matches(&self, event: &EventFields) -> bool {
        if let (Some(op), Some(value)) = (self.name_operator.as_deref(), self.name_value.as_deref())
        {
            let title = event.title.to_lowercase();
            let value = value.to_lowercase();
            let hit = match NameOperator::parse(op) {
                Some(NameOperator::Is) => title == value,
                Some(NameOperator::Contains) => title.contains(&value),
                // An operator we do not understand must not match everything.
                None => false,
            };
            if !hit {
                return false;
            }
        }

        if let Some(wanted) = self.category_value.as_deref() {
            if !has_category(event.categories.as_deref(), wanted) {
                return false;
            }
        }

        if let Some(wanted) = self.type_id {
            if event.type_id != Some(wanted) {
                return false;
            }
        }

        true
    }
}

/// `events.categories` is a comma-separated string as Graph delivers it, so
/// "category is Support" means "Support is one of them" - not a substring of
/// the whole field, which would make "Support" match "Unsupported Legacy".
fn has_category(categories: Option<&str>, wanted: &str) -> bool {
    let wanted = wanted.trim().to_lowercase();
    categories
        .unwrap_or_default()
        .split(',')
        .any(|c| c.trim().to_lowercase() == wanted)
}

/// The fields a rule tests. Deliberately narrow: passing whole events here
/// would let a future condition reach for data the rules were never meant to
/// see.
#[derive(Debug, Clone)]
pub struct EventFields {
    pub title: String,
    pub categories: Option<String>,
    pub type_id: Option<i64>,
}

/// What a caller supplies to create or update a rule. `priority` is assigned
/// by the store on create, so it is not here.
#[derive(Debug, Deserialize)]
pub struct MappingRuleInput {
    #[serde(default)]
    pub name_operator: Option<String>,
    #[serde(default)]
    pub name_value: Option<String>,
    #[serde(default)]
    pub category_value: Option<String>,
    #[serde(default)]
    pub type_id: Option<i64>,
    pub project_id: i64,
    #[serde(default)]
    pub activity_id: Option<i64>,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

fn default_true() -> bool {
    true
}

fn blank_to_none(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

/// Normalises the input and refuses a rule that tests nothing.
fn validate(input: &MappingRuleInput) -> DbResult<(Option<String>, Option<String>, Option<String>)> {
    let name_value = blank_to_none(&input.name_value);
    let category_value = blank_to_none(&input.category_value);

    // An operator is only meaningful alongside a value, and vice versa.
    let name_operator = match (&name_value, blank_to_none(&input.name_operator)) {
        (Some(_), Some(op)) => {
            if NameOperator::parse(&op).is_none() {
                return Err(DbError::Other(format!(
                    "'{op}' is not a name condition. Use 'is' or 'contains'."
                )));
            }
            Some(op)
        }
        // A name value with no operator defaults to the safer, narrower one.
        (Some(_), None) => Some(NameOperator::Is.as_str().to_string()),
        (None, _) => None,
    };

    if name_value.is_none() && category_value.is_none() && input.type_id.is_none() {
        return Err(DbError::Other(
            "A rule needs at least one condition - a name, a category or an event type."
                .to_string(),
        ));
    }

    Ok((name_operator, name_value, category_value))
}

pub fn list_mapping_rules(conn: &Connection) -> DbResult<Vec<MappingRule>> {
    let sql = format!("SELECT {RULE_COLUMNS} FROM mapping_rules ORDER BY priority, id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], MappingRule::from_row)?;

    let mut rules = Vec::new();
    for row in rows {
        rules.push(row?);
    }
    Ok(rules)
}

/// New rules go to the bottom of the list, where they cannot shadow anything
/// the user has already arranged.
pub fn create_mapping_rule(conn: &Connection, input: &MappingRuleInput) -> DbResult<MappingRule> {
    let (name_operator, name_value, category_value) = validate(input)?;

    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(priority), 0) + 1 FROM mapping_rules",
        [],
        |row| row.get(0),
    )?;

    conn.execute(
        "INSERT INTO mapping_rules
         (priority, name_operator, name_value, category_value, type_id, project_id, activity_id, is_active)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            next,
            name_operator,
            name_value,
            category_value,
            input.type_id,
            input.project_id,
            input.activity_id,
            input.is_active
        ],
    )?;

    let id = conn.last_insert_rowid();
    let sql = format!("SELECT {RULE_COLUMNS} FROM mapping_rules WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], MappingRule::from_row)?)
}

pub fn update_mapping_rule(
    conn: &Connection,
    id: i64,
    input: &MappingRuleInput,
) -> DbResult<Option<MappingRule>> {
    let (name_operator, name_value, category_value) = validate(input)?;

    let changed = conn.execute(
        "UPDATE mapping_rules SET
           name_operator = ?1, name_value = ?2, category_value = ?3,
           type_id = ?4, project_id = ?5, activity_id = ?6, is_active = ?7
         WHERE id = ?8",
        params![
            name_operator,
            name_value,
            category_value,
            input.type_id,
            input.project_id,
            input.activity_id,
            input.is_active,
            id
        ],
    )?;

    if changed == 0 {
        return Ok(None);
    }

    let sql = format!("SELECT {RULE_COLUMNS} FROM mapping_rules WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], MappingRule::from_row).optional()?)
}

pub fn delete_mapping_rule(conn: &Connection, id: i64) -> DbResult<bool> {
    let changed = conn.execute("DELETE FROM mapping_rules WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}

/// Rewrites the whole order in one transaction. Takes ids in their new order
/// rather than id/priority pairs, so a caller cannot invent a half-order with
/// duplicate or missing priorities.
pub fn reorder_mapping_rules(conn: &Connection, ids_in_order: &[i64]) -> DbResult<()> {
    let tx = conn.unchecked_transaction()?;
    for (index, id) in ids_in_order.iter().enumerate() {
        tx.execute(
            "UPDATE mapping_rules SET priority = ?1 WHERE id = ?2",
            params![index as i64 + 1, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// The first active rule that matches, or `None`. Rules already arrive in
/// priority order from `list_mapping_rules`.
pub fn first_match<'a>(rules: &'a [MappingRule], event: &EventFields) -> Option<&'a MappingRule> {
    rules
        .iter()
        .filter(|r| r.is_active && r.has_a_condition())
        .find(|r| r.matches(event))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::run_migrations;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, code) VALUES (1, 'Rebuild', 'PRJ-001'), (2, 'Billing', 'PRJ-002')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO event_types (id, name, is_billable) VALUES (10, 'Work', 1), (11, 'Info', 0)",
            [],
        )
        .unwrap();
        conn
    }

    fn rule(name: Option<(&str, &str)>, category: Option<&str>, type_id: Option<i64>) -> MappingRuleInput {
        MappingRuleInput {
            name_operator: name.map(|(op, _)| op.to_string()),
            name_value: name.map(|(_, v)| v.to_string()),
            category_value: category.map(str::to_string),
            type_id,
            project_id: 1,
            activity_id: None,
            is_active: true,
        }
    }

    fn event(title: &str, categories: Option<&str>, type_id: Option<i64>) -> EventFields {
        EventFields {
            title: title.to_string(),
            categories: categories.map(str::to_string),
            type_id,
        }
    }

    // --- conditions ---

    #[test]
    fn name_is_matches_exactly_and_ignores_case() {
        let r = create_mapping_rule(&setup(), &rule(Some(("is", "Daily Standup")), None, None)).unwrap();

        assert!(r.matches(&event("daily standup", None, None)));
        assert!(!r.matches(&event("Daily Standup Extra", None, None)));
    }

    #[test]
    fn name_contains_matches_a_substring() {
        let r = create_mapping_rule(&setup(), &rule(Some(("contains", "1:1")), None, None)).unwrap();

        assert!(r.matches(&event("1:1 - Sarah Chen", None, None)));
        assert!(r.matches(&event("Weekly 1:1", None, None)));
        assert!(!r.matches(&event("Standup", None, None)));
    }

    /// `categories` is a comma-separated string from Graph, so this must be a
    /// membership test, not a substring of the whole field.
    #[test]
    fn category_matches_one_entry_not_a_substring_of_the_field() {
        let r = create_mapping_rule(&setup(), &rule(None, Some("Support"), None)).unwrap();

        assert!(r.matches(&event("x", Some("Scrum,Support,Release"), None)));
        assert!(r.matches(&event("x", Some(" support "), None)), "trimmed and case-insensitive");
        assert!(
            !r.matches(&event("x", Some("Unsupported Legacy"), None)),
            "a longer category that merely contains the word must not match"
        );
        assert!(!r.matches(&event("x", None, None)));
    }

    #[test]
    fn type_matches_the_event_type() {
        let r = create_mapping_rule(&setup(), &rule(None, None, Some(10))).unwrap();

        assert!(r.matches(&event("x", None, Some(10))));
        assert!(!r.matches(&event("x", None, Some(11))));
        assert!(!r.matches(&event("x", None, None)));
    }

    /// The rule that made this design worth having: name AND category AND type
    /// all have to hold.
    #[test]
    fn every_supplied_condition_must_hold() {
        let r = create_mapping_rule(
            &setup(),
            &rule(Some(("contains", "Escalation")), Some("Support"), Some(10)),
        )
        .unwrap();

        assert!(r.matches(&event("Customer Escalation", Some("Support"), Some(10))));
        assert!(!r.matches(&event("Customer Escalation", Some("Support"), Some(11))), "wrong type");
        assert!(!r.matches(&event("Customer Escalation", Some("Scrum"), Some(10))), "wrong category");
        assert!(!r.matches(&event("Standup", Some("Support"), Some(10))), "wrong name");
    }

    /// An absent condition is not tested - it must not behave as a wildcard
    /// that fails.
    #[test]
    fn an_absent_condition_is_simply_not_tested() {
        let r = create_mapping_rule(&setup(), &rule(Some(("is", "Standup")), None, None)).unwrap();

        assert!(r.matches(&event("Standup", None, None)));
        assert!(r.matches(&event("Standup", Some("anything"), Some(11))));
    }

    // --- validation ---

    #[test]
    fn a_rule_with_no_conditions_is_refused() {
        let conn = setup();

        let err = create_mapping_rule(&conn, &rule(None, None, None));

        assert!(err.is_err(), "a condition-less rule would swallow the whole calendar");
        assert!(format!("{}", err.unwrap_err()).contains("at least one condition"));
    }

    #[test]
    fn a_blank_name_or_category_counts_as_no_condition() {
        let conn = setup();

        let err = create_mapping_rule(&conn, &rule(Some(("is", "   ")), Some(""), None));

        assert!(err.is_err(), "whitespace is not a condition");
    }

    #[test]
    fn an_unknown_name_operator_is_refused_rather_than_silently_ignored() {
        let conn = setup();

        let err = create_mapping_rule(&conn, &rule(Some(("matches", "Standup")), None, None));

        assert!(err.is_err());
        assert!(format!("{}", err.unwrap_err()).contains("'is' or 'contains'"));
    }

    #[test]
    fn a_name_value_without_an_operator_defaults_to_is() {
        let conn = setup();
        let mut input = rule(Some(("is", "Standup")), None, None);
        input.name_operator = None;

        let created = create_mapping_rule(&conn, &input).unwrap();

        assert_eq!(created.name_operator.as_deref(), Some("is"));
    }

    // --- ordering and first-match-wins ---

    #[test]
    fn new_rules_go_to_the_bottom() {
        let conn = setup();

        let first = create_mapping_rule(&conn, &rule(Some(("is", "A")), None, None)).unwrap();
        let second = create_mapping_rule(&conn, &rule(Some(("is", "B")), None, None)).unwrap();

        assert_eq!(first.priority, 1);
        assert_eq!(second.priority, 2, "a new rule must not shadow existing ones");
    }

    #[test]
    fn the_first_matching_active_rule_wins() {
        let conn = setup();
        let broad = create_mapping_rule(&conn, &rule(None, Some("Scrum"), None)).unwrap();
        let narrow = create_mapping_rule(&conn, &rule(Some(("is", "Standup")), None, None)).unwrap();
        let rules = list_mapping_rules(&conn).unwrap();

        let hit = first_match(&rules, &event("Standup", Some("Scrum"), None)).unwrap();

        assert_eq!(hit.id, broad.id, "priority decides, not specificity");
        assert_ne!(hit.id, narrow.id);
    }

    #[test]
    fn an_inactive_rule_never_matches() {
        let conn = setup();
        let mut input = rule(Some(("is", "Standup")), None, None);
        input.is_active = false;
        create_mapping_rule(&conn, &input).unwrap();
        let rules = list_mapping_rules(&conn).unwrap();

        assert!(first_match(&rules, &event("Standup", None, None)).is_none());
    }

    #[test]
    fn reordering_rewrites_priorities_and_changes_which_rule_wins() {
        let conn = setup();
        let broad = create_mapping_rule(&conn, &rule(None, Some("Scrum"), None)).unwrap();
        let narrow = create_mapping_rule(&conn, &rule(Some(("is", "Standup")), None, None)).unwrap();

        reorder_mapping_rules(&conn, &[narrow.id.unwrap(), broad.id.unwrap()]).unwrap();

        let rules = list_mapping_rules(&conn).unwrap();
        assert_eq!(rules[0].id, narrow.id);
        assert_eq!(rules[0].priority, 1);
        assert_eq!(rules[1].priority, 2);
        let hit = first_match(&rules, &event("Standup", Some("Scrum"), None)).unwrap();
        assert_eq!(hit.id, narrow.id, "the reorder must change the outcome");
    }

    #[test]
    fn no_matching_rule_leaves_the_event_unmapped() {
        let conn = setup();
        create_mapping_rule(&conn, &rule(Some(("is", "Standup")), None, None)).unwrap();
        let rules = list_mapping_rules(&conn).unwrap();

        assert!(first_match(&rules, &event("Something else", None, None)).is_none());
    }

    // --- update / delete ---

    #[test]
    fn update_changes_the_conditions_and_the_target() {
        let conn = setup();
        let created = create_mapping_rule(&conn, &rule(Some(("is", "Old")), None, None)).unwrap();
        let mut input = rule(Some(("contains", "New")), Some("Scrum"), Some(10));
        input.project_id = 2;
        input.activity_id = None;
        input.is_active = false;

        let updated = update_mapping_rule(&conn, created.id.unwrap(), &input)
            .unwrap()
            .expect("updating an existing rule returns it");

        assert_eq!(updated.name_operator.as_deref(), Some("contains"));
        assert_eq!(updated.name_value.as_deref(), Some("New"));
        assert_eq!(updated.category_value.as_deref(), Some("Scrum"));
        assert_eq!(updated.type_id, Some(10));
        assert_eq!(updated.project_id, 2);
        assert!(!updated.is_active);
        assert_eq!(updated.priority, created.priority, "editing must not reorder");
    }

    #[test]
    fn updating_a_missing_rule_returns_none() {
        let conn = setup();

        let result = update_mapping_rule(&conn, 9999, &rule(Some(("is", "x")), None, None)).unwrap();

        assert!(result.is_none());
    }

    #[test]
    fn delete_removes_the_rule_and_reports_whether_it_existed() {
        let conn = setup();
        let created = create_mapping_rule(&conn, &rule(Some(("is", "x")), None, None)).unwrap();

        assert!(delete_mapping_rule(&conn, created.id.unwrap()).unwrap());
        assert_eq!(list_mapping_rules(&conn).unwrap().len(), 0);
        assert!(!delete_mapping_rule(&conn, created.id.unwrap()).unwrap());
    }

    /// The serde default that antd's form omission would otherwise flip.
    #[test]
    fn rule_input_defaults_is_active_to_true_when_absent_from_payload() {
        let parsed: MappingRuleInput =
            serde_json::from_str(r#"{"project_id":1,"name_value":"Standup"}"#).unwrap();

        assert!(parsed.is_active);
        assert_eq!(parsed.activity_id, None, "no activity is a real answer");
    }

    #[test]
    fn rule_input_honours_an_explicit_false_for_is_active() {
        let parsed: MappingRuleInput =
            serde_json::from_str(r#"{"project_id":1,"name_value":"x","is_active":false}"#).unwrap();

        assert!(!parsed.is_active);
    }
}
