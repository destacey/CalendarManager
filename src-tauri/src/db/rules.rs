// Pure port of `evaluateRule`/`evaluateEventTypeSync` from
// `electron/main.js` (see `git show ca805d0:electron/main.js` lines
// 716-772). The original took a database handle and was reachable only
// through IPC, so none of its behaviour was ever exercised by a test; this
// version takes no database at all, so every branch below is.

use super::models::EventTypeRule;

/// The event-side inputs a rule can be matched against. Deliberately a
/// standalone struct rather than the full `Event` (or `Row`): the caller may
/// be evaluating an in-progress edit that has no row yet, and this keeps
/// `evaluate` from needing to know about the other dozen `Event` fields it
/// never looks at.
pub struct EventFields {
    pub title: String,
    pub is_all_day: bool,
    pub show_as: String,
    pub categories: String,
}

/// Reads the field a rule names off of `fields`. `None` for any field name
/// the original's `switch` didn't recognise, which `evaluate_rule` turns
/// into "never matches" rather than a panic or a silent default.
fn field_value(rule: &EventTypeRule, fields: &EventFields) -> Option<String> {
    match rule.field_name.as_str() {
        "title" => Some(fields.title.clone()),
        // Compared as the strings "true"/"false", not as a bool: the
        // original JS built `eventData.is_all_day ? 'true' : 'false'` and
        // compared it against `rule.value`, which is always a string
        // column from the rules table. This looks like it should be a
        // boolean comparison; it is not, and changing it would silently
        // break every "all-day" rule stored in the real database.
        "is_all_day" => Some(if fields.is_all_day { "true".to_string() } else { "false".to_string() }),
        "show_as" => Some(fields.show_as.clone()),
        "categories" => Some(fields.categories.clone()),
        _ => None,
    }
}

/// Direct port of `evaluateRule`. Two `match` expressions (fields, then
/// operators) mirror the original's two `switch` statements exactly,
/// including both `default` arms returning `false` — an unrecognised field
/// or operator must fail closed, never fall through to an accidental match.
fn evaluate_rule(rule: &EventTypeRule, fields: &EventFields) -> bool {
    let Some(field_value) = field_value(rule, fields) else {
        return false;
    };
    // A null `value` column reads back as `None`; the original coalesced it
    // to `''` with `rule.value || ''` before comparing.
    let rule_value = rule.value.clone().unwrap_or_default();

    match rule.operator.as_str() {
        "equals" => field_value == rule_value,
        "contains" => field_value.to_lowercase().contains(&rule_value.to_lowercase()),
        "is_empty" => field_value.trim().is_empty(),
        _ => false,
    }
}

/// Direct port of `evaluateEventTypeSync`, minus the database fallbacks
/// (fetching `rules`/`default_type_id` when absent) — those become the
/// caller's job once this is wired into a real command in Task 5. Rules are
/// tried in the order given, so the caller must pass them pre-sorted by
/// `priority` the way the original's `ORDER BY priority ASC` did; the first
/// match wins.
pub fn evaluate(rules: &[EventTypeRule], fields: &EventFields, default_type_id: Option<i64>) -> Option<i64> {
    for rule in rules {
        if evaluate_rule(rule, fields) {
            return Some(rule.target_type_id);
        }
    }
    default_type_id
}

#[cfg(test)]
mod tests {
    use super::super::models::EventTypeRule;
    use super::*;

    /// Builds a rule with only the fields evaluation cares about; `id` and
    /// `created_at` are irrelevant to `evaluate` so they're fixed at `None`.
    fn rule(field_name: &str, operator: &str, value: Option<&str>, target_type_id: i64) -> EventTypeRule {
        EventTypeRule {
            id: None,
            name: "test rule".to_string(),
            priority: 1,
            field_name: field_name.to_string(),
            operator: operator.to_string(),
            value: value.map(|v| v.to_string()),
            target_type_id,
            created_at: None,
        }
    }

    fn fields(title: &str, is_all_day: bool, show_as: &str, categories: &str) -> EventFields {
        EventFields {
            title: title.to_string(),
            is_all_day,
            show_as: show_as.to_string(),
            categories: categories.to_string(),
        }
    }

    #[test]
    fn equals_matches_an_exact_title_and_returns_its_target_type_id() {
        let rules = vec![rule("title", "equals", Some("Standup"), 5)];
        let f = fields("Standup", false, "busy", "");

        assert_eq!(evaluate(&rules, &f, None), Some(5));
    }

    #[test]
    fn equals_does_not_match_a_different_title() {
        let rules = vec![rule("title", "equals", Some("Standup"), 5)];
        let f = fields("Retro", false, "busy", "");

        assert_eq!(evaluate(&rules, &f, Some(9)), Some(9));
    }

    #[test]
    fn equals_treats_a_null_value_as_empty_string_and_matches_empty_title() {
        let rules = vec![rule("title", "equals", None, 5)];
        let f = fields("", false, "busy", "");

        assert_eq!(evaluate(&rules, &f, None), Some(5));
    }

    #[test]
    fn contains_matches_case_insensitively() {
        let rules = vec![rule("title", "contains", Some("STANDUP"), 5)];
        let f = fields("Daily standup", false, "busy", "");

        assert_eq!(evaluate(&rules, &f, None), Some(5));
    }

    #[test]
    fn contains_does_not_match_an_absent_substring() {
        let rules = vec![rule("title", "contains", Some("retro"), 5)];
        let f = fields("Daily standup", false, "busy", "");

        assert_eq!(evaluate(&rules, &f, Some(1)), Some(1));
    }

    #[test]
    fn is_empty_matches_an_empty_categories() {
        let rules = vec![rule("categories", "is_empty", None, 5)];
        let f = fields("x", false, "busy", "");

        assert_eq!(evaluate(&rules, &f, None), Some(5));
    }

    #[test]
    fn is_empty_matches_whitespace_only_categories() {
        let rules = vec![rule("categories", "is_empty", None, 5)];
        let f = fields("x", false, "busy", "   ");

        assert_eq!(evaluate(&rules, &f, None), Some(5));
    }

    #[test]
    fn is_empty_does_not_match_non_empty_categories() {
        let rules = vec![rule("categories", "is_empty", None, 5)];
        let f = fields("x", false, "busy", "Work");

        assert_eq!(evaluate(&rules, &f, Some(2)), Some(2));
    }

    #[test]
    fn is_all_day_matches_equals_true_when_the_flag_is_set() {
        let rules = vec![rule("is_all_day", "equals", Some("true"), 5)];
        let f = fields("x", true, "busy", "");

        assert_eq!(evaluate(&rules, &f, None), Some(5));
    }

    #[test]
    fn is_all_day_matches_equals_false_when_the_flag_is_clear() {
        let rules = vec![rule("is_all_day", "equals", Some("false"), 5)];
        let f = fields("x", false, "busy", "");

        assert_eq!(evaluate(&rules, &f, None), Some(5));
    }

    #[test]
    fn an_unknown_field_name_never_matches() {
        let rules = vec![rule("nonexistent", "equals", Some(""), 5)];
        let f = fields("", false, "busy", "");

        assert_eq!(evaluate(&rules, &f, Some(1)), Some(1));
    }

    #[test]
    fn an_unknown_operator_never_matches() {
        let rules = vec![rule("title", "starts_with", Some("x"), 5)];
        let f = fields("x", false, "busy", "");

        assert_eq!(evaluate(&rules, &f, Some(1)), Some(1));
    }

    #[test]
    fn the_first_matching_rule_wins_even_when_a_later_rule_would_also_match() {
        let rules = vec![
            rule("title", "contains", Some("stand"), 5),
            rule("title", "contains", Some("stand"), 9),
        ];
        let f = fields("Daily standup", false, "busy", "");

        assert_eq!(evaluate(&rules, &f, None), Some(5));
    }

    #[test]
    fn no_matching_rule_returns_the_default_type_id() {
        let rules = vec![rule("title", "equals", Some("Retro"), 5)];
        let f = fields("Standup", false, "busy", "");

        assert_eq!(evaluate(&rules, &f, Some(42)), Some(42));
    }

    #[test]
    fn an_empty_rule_list_returns_the_default_type_id() {
        let rules: Vec<EventTypeRule> = vec![];
        let f = fields("Standup", false, "busy", "");

        assert_eq!(evaluate(&rules, &f, Some(7)), Some(7));
    }

    #[test]
    fn no_match_and_no_default_type_id_returns_none() {
        let rules = vec![rule("title", "equals", Some("Retro"), 5)];
        let f = fields("Standup", false, "busy", "");

        assert_eq!(evaluate(&rules, &f, None), None);
    }
}
