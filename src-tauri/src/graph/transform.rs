//! Transforms a Microsoft Graph calendar event into the subset of fields a
//! sync writes to the local `events` table.
//!
//! This is a pure, infallible mapping: every field has a fallback, so there
//! is nothing here that can fail. The fallbacks themselves are the whole
//! point of this module — they were reverse-engineered from the original
//! Electron upsert handler (`electron/main.js`, deleted in this branch) and
//! are ported exactly, oddities included, rather than "improved".

use chrono::Utc;
use serde::{Deserialize, Serialize};

/// Microsoft Graph's `start`/`end` date-time shape.
///
/// `date_time` is `Option` even though Graph always sends it in practice:
/// deserialization must tolerate a missing or malformed payload rather than
/// erroring, so nothing here is allowed to be a hard requirement.
///
/// Graph also sends a sibling `timeZone`, deliberately not deserialized. The
/// sync sends no `Prefer: outlook.timezone` header, so Graph answers in UTC
/// and `date_time` is stored as-is; carrying the field would suggest it is
/// honoured somewhere, which it is not.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphDateTime {
    #[serde(default)]
    pub date_time: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct GraphBody {
    #[serde(default)]
    pub content: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphLocation {
    #[serde(default)]
    pub display_name: Option<String>,
}

/// Graph nests organizer/attendee identity under `emailAddress`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEmailAddress {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub address: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphOrganizer {
    #[serde(default)]
    pub email_address: GraphEmailAddress,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct GraphAttendeeStatus {
    #[serde(default)]
    pub response: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphAttendee {
    #[serde(default)]
    pub email_address: GraphEmailAddress,
    #[serde(default)]
    pub status: GraphAttendeeStatus,
}

/// A single Microsoft Graph calendar event, as returned by
/// `/me/calendar/calendarView` (and friends). Deserialization is
/// deliberately tolerant: Graph adds fields over time, and every field
/// here that the original transform treated as optional is `Option` with
/// `#[serde(default)]`, so a payload missing pieces — or carrying ones we
/// don't know about yet — still deserializes instead of failing the sync.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEvent {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub is_all_day: Option<bool>,
    #[serde(default)]
    pub show_as: Option<String>,
    #[serde(default)]
    pub start: Option<GraphDateTime>,
    #[serde(default)]
    pub end: Option<GraphDateTime>,
    #[serde(default)]
    pub body: Option<GraphBody>,
    #[serde(default)]
    pub location: Option<GraphLocation>,
    #[serde(default)]
    pub organizer: Option<GraphOrganizer>,
    #[serde(default)]
    pub attendees: Option<Vec<GraphAttendee>>,
    #[serde(default)]
    pub categories: Option<Vec<String>>,
}

/// The JSON shape written into the `organizer` TEXT column. Structured data
/// on the Graph side is flattened to just `name`/`email` here — see
/// `src/types/index.ts:53` — and stored as a JSON *string*, not as a nested
/// value, because `EventModal` parses it back out on the frontend.
#[derive(Debug, Serialize)]
struct LocalOrganizer {
    name: String,
    email: String,
}

/// The JSON shape of one entry in the `attendees` TEXT column's array.
#[derive(Debug, Serialize)]
struct LocalAttendee {
    name: String,
    email: String,
    response: String,
}

/// The subset of the `events` table's columns that a sync writes. Distinct
/// from `db::models::Event`: no `id`, `type_id`, `type_manually_set`, or
/// timestamps — those are Task 3's concern (upsert + rule evaluation), not
/// this pure transform's.
#[derive(Debug, Clone, PartialEq)]
pub struct LocalEventFields {
    pub graph_id: String,
    pub title: String,
    pub description: String,
    pub start_date: String,
    pub end_date: String,
    pub is_all_day: bool,
    pub show_as: String,
    pub categories: String,
    pub location: String,
    pub organizer: String,
    pub attendees: String,
    pub is_meeting: bool,
}

/// Maps a `GraphEvent` to the local column values a sync writes.
///
/// Ported line-for-line from the deleted Electron handler
/// (`electron/main.js:373-400`, recoverable via `git show ca805d0`).
/// Infallible by construction: every field has a fallback, so there is
/// nothing for this function to fail on.
pub fn transform(event: &GraphEvent) -> LocalEventFields {
    let description = event
        .body
        .as_ref()
        .map(|b| b.content.clone().unwrap_or_default())
        .unwrap_or_default();

    let location = event
        .location
        .as_ref()
        .map(|l| l.display_name.clone().unwrap_or_default())
        .unwrap_or_default();

    // `categories.join(",")` on an empty array is also `""`, so whether
    // `categories` is missing or present-but-empty makes no difference here
    // — unlike `attendees` below, where that distinction matters.
    let categories = event
        .categories
        .as_ref()
        .map(|c| c.join(","))
        .unwrap_or_default();

    let organizer = event
        .organizer
        .as_ref()
        .map(|o| {
            serde_json::to_string(&LocalOrganizer {
                name: o.email_address.name.clone().unwrap_or_default(),
                email: o.email_address.address.clone().unwrap_or_default(),
            })
            .expect("LocalOrganizer serializes infallibly")
        })
        .unwrap_or_default();

    // The original is `graphEvent.attendees ? JSON.stringify(...) : ''`.
    // In JS, `[]` is truthy, so a present-but-empty array still hits the
    // JSON.stringify branch and produces `"[]"` — only a *missing*
    // `attendees` key produces `""`. Matching that means branching on
    // `Option` presence, not on emptiness: `Some(vec![])` must serialize to
    // `"[]"`, not fall back to `""`.
    let attendees = event
        .attendees
        .as_ref()
        .map(|list| {
            let mapped: Vec<LocalAttendee> = list
                .iter()
                .map(|a| LocalAttendee {
                    name: a.email_address.name.clone().unwrap_or_default(),
                    email: a.email_address.address.clone().unwrap_or_default(),
                    response: a.status.response.clone().unwrap_or_default(),
                })
                .collect();
            serde_json::to_string(&mapped).expect("Vec<LocalAttendee> serializes infallibly")
        })
        .unwrap_or_default();

    // Not a Graph field: derived from whether any attendees are present at
    // all, the same way the original computed it —
    // `attendees && attendees.length > 0`.
    let is_meeting = event
        .attendees
        .as_ref()
        .map(|list| !list.is_empty())
        .unwrap_or(false);

    // `start?.dateTime || new Date().toISOString()`. A calendar event with
    // no start time is a strange thing to sync, but `start_date` is
    // `NOT NULL` in the schema, so dropping the event or writing NULL isn't
    // on the table — "now" is the ported fallback, oddity and all.
    let start_date = event
        .start
        .as_ref()
        .and_then(|s| s.date_time.clone())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let end_date = event
        .end
        .as_ref()
        .and_then(|s| s.date_time.clone())
        .unwrap_or_else(|| Utc::now().to_rfc3339());

    LocalEventFields {
        graph_id: event.id.clone(),
        title: event
            .subject
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Untitled Event".to_string()),
        description,
        start_date,
        end_date,
        is_all_day: event.is_all_day.unwrap_or(false),
        show_as: event
            .show_as
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "busy".to_string()),
        categories,
        location,
        organizer,
        attendees,
        is_meeting,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn parse(value: Value) -> GraphEvent {
        serde_json::from_value(value).expect("test payload deserializes")
    }

    /// A full, realistic payload maps every field.
    #[test]
    fn a_full_payload_maps_every_field() {
        let event = parse(json!({
            "id": "AAMkAG_abc123",
            "subject": "Quarterly Planning",
            "isAllDay": false,
            "showAs": "tentative",
            "start": { "dateTime": "2026-03-15T09:00:00.0000000", "timeZone": "UTC" },
            "end": { "dateTime": "2026-03-15T10:00:00.0000000", "timeZone": "UTC" },
            "body": { "contentType": "text", "content": "Agenda attached." },
            "location": { "displayName": "Conference Room A" },
            "categories": ["Work", "Important"],
            "organizer": {
                "emailAddress": { "name": "Alice Example", "address": "alice@example.com" }
            },
            "attendees": [
                {
                    "emailAddress": { "name": "Bob Example", "address": "bob@example.com" },
                    "status": { "response": "accepted", "time": "2026-03-10T00:00:00Z" }
                }
            ]
        }));

        let fields = transform(&event);

        assert_eq!(fields.graph_id, "AAMkAG_abc123");
        assert_eq!(fields.title, "Quarterly Planning");
        assert_eq!(fields.description, "Agenda attached.");
        assert_eq!(fields.start_date, "2026-03-15T09:00:00.0000000");
        assert_eq!(fields.end_date, "2026-03-15T10:00:00.0000000");
        assert_eq!(fields.is_all_day, false);
        assert_eq!(fields.show_as, "tentative");
        assert_eq!(fields.categories, "Work,Important");
        assert_eq!(fields.location, "Conference Room A");
        assert_eq!(
            fields.organizer,
            r#"{"name":"Alice Example","email":"alice@example.com"}"#
        );
        assert_eq!(
            fields.attendees,
            r#"[{"name":"Bob Example","email":"bob@example.com","response":"accepted"}]"#
        );
        assert_eq!(fields.is_meeting, true);
    }

    /// A payload missing `subject` falls back to "Untitled Event".
    #[test]
    fn a_missing_subject_falls_back_to_untitled_event() {
        let event = parse(json!({ "id": "1" }));

        assert_eq!(transform(&event).title, "Untitled Event");
    }

    /// A payload with an empty-string `subject` also falls back, matching
    /// the original's `||` (which treats `""` as falsy, same as missing).
    #[test]
    fn an_empty_subject_falls_back_to_untitled_event() {
        let event = parse(json!({ "id": "1", "subject": "" }));

        assert_eq!(transform(&event).title, "Untitled Event");
    }

    /// A missing `body` yields an empty description.
    #[test]
    fn a_missing_body_yields_empty_description() {
        let event = parse(json!({ "id": "1" }));

        assert_eq!(transform(&event).description, "");
    }

    /// A missing `location` yields an empty location.
    #[test]
    fn a_missing_location_yields_empty_location() {
        let event = parse(json!({ "id": "1" }));

        assert_eq!(transform(&event).location, "");
    }

    /// A missing `organizer` yields an empty string, not `"null"` or `"{}"`.
    #[test]
    fn a_missing_organizer_yields_empty_string() {
        let event = parse(json!({ "id": "1" }));

        assert_eq!(transform(&event).organizer, "");
    }

    /// A missing `attendees` key yields an empty string.
    #[test]
    fn missing_attendees_yields_empty_string() {
        let event = parse(json!({ "id": "1" }));

        assert_eq!(transform(&event).attendees, "");
    }

    /// `categories: []` yields `""`, same as a missing `categories`.
    #[test]
    fn empty_categories_yields_empty_string() {
        let event = parse(json!({ "id": "1", "categories": [] }));

        assert_eq!(transform(&event).categories, "");
    }

    /// `categories: ["A", "B"]` joins with commas.
    #[test]
    fn categories_join_with_commas() {
        let event = parse(json!({ "id": "1", "categories": ["A", "B"] }));

        assert_eq!(transform(&event).categories, "A,B");
    }

    /// `attendees: []` is a *present* empty array, unlike a missing key: the
    /// original still hits `JSON.stringify([])`, producing `"[]"`, not the
    /// `""` fallback. `is_meeting` is false either way.
    #[test]
    fn empty_attendees_array_serializes_to_json_empty_array_not_fallback() {
        let event = parse(json!({ "id": "1", "attendees": [] }));

        let fields = transform(&event);
        assert_eq!(fields.attendees, "[]");
        assert_eq!(fields.is_meeting, false);
    }

    /// One attendee makes `is_meeting` true.
    #[test]
    fn one_attendee_makes_is_meeting_true() {
        let event = parse(json!({
            "id": "1",
            "attendees": [
                {
                    "emailAddress": { "name": "Bob", "address": "bob@example.com" },
                    "status": { "response": "none", "time": "2026-01-01T00:00:00Z" }
                }
            ]
        }));

        assert_eq!(transform(&event).is_meeting, true);
    }

    /// A missing `showAs` falls back to `"busy"`.
    #[test]
    fn a_missing_show_as_falls_back_to_busy() {
        let event = parse(json!({ "id": "1" }));

        assert_eq!(transform(&event).show_as, "busy");
    }

    /// `organizer` serializes to a JSON string with exactly `name` and
    /// `email` keys — no `emailAddress` nesting survives the transform.
    #[test]
    fn organizer_json_has_exactly_name_and_email_keys() {
        let event = parse(json!({
            "id": "1",
            "organizer": {
                "emailAddress": { "name": "Alice", "address": "alice@example.com" }
            }
        }));

        let organizer = transform(&event).organizer;
        let parsed: Value = serde_json::from_str(&organizer).unwrap();
        let obj = parsed.as_object().unwrap();

        assert_eq!(obj.len(), 2);
        assert_eq!(obj.get("name").unwrap(), "Alice");
        assert_eq!(obj.get("email").unwrap(), "alice@example.com");
    }

    /// `attendees` serializes to a JSON array whose elements have exactly
    /// `name`, `email`, and `response` keys.
    #[test]
    fn attendees_json_elements_have_exactly_name_email_response_keys() {
        let event = parse(json!({
            "id": "1",
            "attendees": [
                {
                    "emailAddress": { "name": "Bob", "address": "bob@example.com" },
                    "status": { "response": "declined", "time": "2026-01-01T00:00:00Z" }
                }
            ]
        }));

        let attendees = transform(&event).attendees;
        let parsed: Value = serde_json::from_str(&attendees).unwrap();
        let array = parsed.as_array().unwrap();
        assert_eq!(array.len(), 1);

        let obj = array[0].as_object().unwrap();
        assert_eq!(obj.len(), 3);
        assert_eq!(obj.get("name").unwrap(), "Bob");
        assert_eq!(obj.get("email").unwrap(), "bob@example.com");
        assert_eq!(obj.get("response").unwrap(), "declined");
    }

    /// An unknown extra field anywhere in the payload must not break
    /// deserialization — Graph adds fields over time.
    #[test]
    fn an_unknown_extra_field_does_not_break_deserialization() {
        let event: Result<GraphEvent, _> = serde_json::from_value(json!({
            "id": "1",
            "subject": "Has a surprise field",
            "someBrandNewGraphProperty": { "nested": ["whatever", 1, true] },
            "onlineMeeting": { "joinUrl": "https://example.com/join" }
        }));

        assert!(
            event.is_ok(),
            "expected tolerant deserialization, got {event:?}"
        );
        assert_eq!(transform(&event.unwrap()).title, "Has a surprise field");
    }

    /// A missing `start`/`end` falls back to "now" as an ISO string, since
    /// `start_date`/`end_date` are `NOT NULL` in the schema. Exact-match
    /// isn't feasible (the fallback captures the real clock), so this just
    /// checks the shape: a valid RFC3339 string.
    #[test]
    fn missing_start_and_end_fall_back_to_a_valid_iso_timestamp() {
        let event = parse(json!({ "id": "1" }));

        let fields = transform(&event);
        assert!(
            chrono::DateTime::parse_from_rfc3339(&fields.start_date).is_ok(),
            "start_date was not a valid RFC3339 timestamp: {}",
            fields.start_date
        );
        assert!(
            chrono::DateTime::parse_from_rfc3339(&fields.end_date).is_ok(),
            "end_date was not a valid RFC3339 timestamp: {}",
            fields.end_date
        );
    }

    /// A missing `isAllDay` falls back to `false`.
    #[test]
    fn a_missing_is_all_day_falls_back_to_false() {
        let event = parse(json!({ "id": "1" }));

        assert_eq!(transform(&event).is_all_day, false);
    }
}
