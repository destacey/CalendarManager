// Domain structs mirroring `src/types/index.ts` exactly, field for field.
//
// Deliberately **no** `#[serde(rename_all = "camelCase")]` here, unlike the
// convention used for Tauri command *names*: the React calendar components
// (`WeekView`, `EventModal`, ...) read these fields directly off JSON as
// `start_date`, `is_all_day`, `type_manually_set`, etc. Renaming would break
// every one of them. Serde's default (no attribute) already serializes a
// Rust `snake_case` field as the same `snake_case` JSON key, so no rename
// attribute is needed at all — its absence is the point, not an oversight.
//
// Optionality mirrors the `?` markers on the TypeScript interfaces exactly,
// not what SQLite's schema happens to allow NULL for (schema.rs is more
// permissive in a few places than the interfaces are).

use rusqlite::Row;
use serde::{Deserialize, Serialize};

/// Mirrors `Event` in `src/types/index.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: Option<i64>,
    pub graph_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub is_all_day: bool,
    pub show_as: String,
    pub categories: String,
    pub location: Option<String>,
    /// JSON string containing organizer info, same as the TS comment says —
    /// this struct doesn't parse it, just carries it.
    pub organizer: Option<String>,
    /// JSON string containing the attendees array; same note as `organizer`.
    pub attendees: Option<String>,
    pub is_meeting: Option<bool>,
    pub type_id: Option<i64>,
    pub type_manually_set: Option<bool>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub synced_at: Option<String>,
}

impl Event {
    /// Reads by column name, not position: the real database's on-disk
    /// column order is unverified (see schema.rs's `LEGACY_SCHEMA_FOR_TESTS`
    /// comment), so a positional `row.get(0)` chain would be unsafe.
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            graph_id: row.get("graph_id")?,
            title: row.get("title")?,
            description: row.get("description")?,
            start_date: row.get("start_date")?,
            end_date: row.get("end_date")?,
            is_all_day: row.get("is_all_day")?,
            show_as: row.get("show_as")?,
            categories: row.get("categories")?,
            location: row.get("location")?,
            organizer: row.get("organizer")?,
            attendees: row.get("attendees")?,
            is_meeting: row.get("is_meeting")?,
            type_id: row.get("type_id")?,
            type_manually_set: row.get("type_manually_set")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            synced_at: row.get("synced_at")?,
        })
    }
}

/// Mirrors `Category` in `src/types/index.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: Option<i64>,
    pub name: String,
    pub color: String,
    pub created_at: Option<String>,
}

impl Category {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            color: row.get("color")?,
            created_at: row.get("created_at")?,
        })
    }
}

/// Mirrors `EventType` in `src/types/index.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventType {
    pub id: Option<i64>,
    pub name: String,
    pub color: String,
    pub is_default: Option<bool>,
    pub is_billable: bool,
    pub created_at: Option<String>,
}

impl EventType {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            color: row.get("color")?,
            is_default: row.get("is_default")?,
            is_billable: row.get("is_billable")?,
            created_at: row.get("created_at")?,
        })
    }
}

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

/// Mirrors `EventTypeRule` in `src/types/index.ts`. `field_name` and
/// `operator` are typed as string literal unions there (`'title' |
/// 'is_all_day' | ...`, `'equals' | 'contains' | 'is_empty'`); they stay
/// plain `String` here rather than becoming a Rust enum, because
/// `rules::evaluate` must treat any value it doesn't recognise as "never
/// matches" rather than refusing to deserialize the row — an enum would
/// turn an unrecognised value already sitting in the database into a
/// deserialization error instead of a safe non-match.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventTypeRule {
    pub id: Option<i64>,
    pub name: String,
    pub priority: i64,
    pub field_name: String,
    pub operator: String,
    pub value: Option<String>,
    /// `Option<i64>`, not a bare `i64`: `event_type_rules.target_type_id`
    /// has no `NOT NULL` in `schema.rs` (it's a plain, nullable
    /// `FOREIGN KEY`). Unlike `events.is_all_day`/`show_as`/`categories` or
    /// `event_types.color`/`categories.color`, there is no safe default to
    /// `COALESCE` a foreign key to — every existing type id is a real,
    /// meaningful type, so coalescing to one would silently misattribute a
    /// rule. Widening to `Option` is the honest reflection of what the
    /// schema actually allows.
    pub target_type_id: Option<i64>,
    pub created_at: Option<String>,
}

impl EventTypeRule {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            priority: row.get("priority")?,
            field_name: row.get("field_name")?,
            operator: row.get("operator")?,
            value: row.get("value")?,
            target_type_id: row.get("target_type_id")?,
            created_at: row.get("created_at")?,
        })
    }
}
