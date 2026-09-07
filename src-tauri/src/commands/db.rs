// Thin `#[tauri::command]` wrappers around `db::events` and `db::categories`.
// The auth milestone learned the hard way that logic belongs below the IPC
// layer, not in it — every command here is just argument plumbing into
// `Db::call`, which is what actually talks to SQLite on a blocking thread.

use tauri::State;

use crate::db::activities::{self, ActivityInput, DeleteActivityOutcome};
use crate::db::mapping::{self, MappingRunResult, UnmappedGroup};
use crate::db::mapping_rules::{self, MappingRule, MappingRuleInput};
use crate::db::project_import::{self, ProjectImportOutcome, ProjectImportPreview};
use crate::db::projects::{self, DeleteProjectOutcome, ProjectInput};
use crate::db::timecards::{
    self, CellInput, EntryInput, GenerationResult, GenerationSettings, NewTimecard, Timecard,
    TimecardEntry,
};
use crate::db::assignment::{self, EventFieldsInput, ReprocessEventTypesResult};
use crate::db::categories::{self, NewCategory};
use crate::db::error::DbResult;
use crate::db::event_types::{
    self, DeleteEventTypeOutcome, EventTypeRuleUpdate, EventTypeUpdate, NewEventType, NewEventTypeRule,
};
use crate::db::events::{self, EventUpdate, NewEvent};
use crate::db::models::{Activity, Category, Event, EventType, EventTypeRule, Project};
use crate::db::Db;

/// The events behind a set of timecard entries, in one call.
#[tauri::command]
pub async fn get_events_by_ids(db: State<'_, Db>, ids: Vec<i64>) -> DbResult<Vec<Event>> {
    db.call(move |conn| events::get_events_by_ids(conn, &ids)).await
}

/// The distinct categories across all events, for the rule editors. Counted
/// in SQL rather than by shipping every event to the frontend.
#[tauri::command]
pub async fn get_event_categories(db: State<'_, Db>) -> DbResult<Vec<String>> {
    db.call(events::list_event_categories).await
}

#[tauri::command]
pub async fn get_events(db: State<'_, Db>) -> DbResult<Vec<Event>> {
    db.call(events::get_events).await
}

#[tauri::command]
pub async fn get_events_in_range(
    db: State<'_, Db>,
    start_date: String,
    end_date: String,
) -> DbResult<Vec<Event>> {
    db.call(move |conn| events::get_events_in_range(conn, &start_date, &end_date)).await
}

#[tauri::command]
pub async fn create_event(db: State<'_, Db>, event: NewEvent) -> DbResult<Event> {
    db.call(move |conn| events::create_event(conn, &event)).await
}

#[tauri::command]
pub async fn update_event(db: State<'_, Db>, id: i64, event: EventUpdate) -> DbResult<Option<Event>> {
    db.call(move |conn| events::update_event(conn, id, &event)).await
}

#[tauri::command]
pub async fn delete_event(db: State<'_, Db>, id: i64) -> DbResult<bool> {
    db.call(move |conn| events::delete_event(conn, id)).await
}

#[tauri::command]
pub async fn delete_all_events(db: State<'_, Db>) -> DbResult<u32> {
    db.call(events::delete_all_events).await
}

#[tauri::command]
pub async fn get_categories(db: State<'_, Db>) -> DbResult<Vec<Category>> {
    db.call(categories::get_categories).await
}

#[tauri::command]
pub async fn create_category(db: State<'_, Db>, category: NewCategory) -> DbResult<Category> {
    db.call(move |conn| categories::create_category(conn, &category)).await
}

#[tauri::command]
pub async fn get_event_types(db: State<'_, Db>) -> DbResult<Vec<EventType>> {
    db.call(event_types::get_event_types).await
}

#[tauri::command]
pub async fn create_event_type(db: State<'_, Db>, event_type: NewEventType) -> DbResult<EventType> {
    db.call(move |conn| event_types::create_event_type(conn, &event_type)).await
}

#[tauri::command]
pub async fn update_event_type(
    db: State<'_, Db>,
    id: i64,
    event_type: EventTypeUpdate,
) -> DbResult<Option<EventType>> {
    db.call(move |conn| event_types::update_event_type(conn, id, &event_type)).await
}

#[tauri::command]
pub async fn delete_event_type(db: State<'_, Db>, id: i64) -> DbResult<DeleteEventTypeOutcome> {
    db.call(move |conn| event_types::delete_event_type(conn, id)).await
}

#[tauri::command]
pub async fn set_default_event_type(db: State<'_, Db>, id: i64) -> DbResult<bool> {
    db.call(move |conn| event_types::set_default_event_type(conn, id)).await
}

#[tauri::command]
pub async fn get_event_type_rules(db: State<'_, Db>) -> DbResult<Vec<EventTypeRule>> {
    db.call(event_types::get_event_type_rules).await
}

#[tauri::command]
pub async fn create_event_type_rule(db: State<'_, Db>, rule: NewEventTypeRule) -> DbResult<EventTypeRule> {
    db.call(move |conn| event_types::create_event_type_rule(conn, &rule)).await
}

#[tauri::command]
pub async fn update_event_type_rule(
    db: State<'_, Db>,
    id: i64,
    rule: EventTypeRuleUpdate,
) -> DbResult<Option<EventTypeRule>> {
    db.call(move |conn| event_types::update_event_type_rule(conn, id, &rule)).await
}

#[tauri::command]
pub async fn delete_event_type_rule(db: State<'_, Db>, id: i64) -> DbResult<bool> {
    db.call(move |conn| event_types::delete_event_type_rule(conn, id)).await
}

#[tauri::command]
pub async fn get_timecards(db: State<'_, Db>) -> DbResult<Vec<Timecard>> {
    db.call(timecards::list_timecards).await
}

#[tauri::command]
pub async fn get_timecard(db: State<'_, Db>, id: i64) -> DbResult<Option<Timecard>> {
    db.call(move |conn| timecards::get_timecard(conn, id)).await
}

#[tauri::command]
pub async fn create_timecard(db: State<'_, Db>, timecard: NewTimecard) -> DbResult<Timecard> {
    db.call(move |conn| timecards::create_timecard(conn, &timecard)).await
}

#[tauri::command]
pub async fn delete_timecard(db: State<'_, Db>, id: i64) -> DbResult<bool> {
    db.call(move |conn| timecards::delete_timecard(conn, id)).await
}

#[tauri::command]
pub async fn get_timecard_entries(db: State<'_, Db>, timecard_id: i64) -> DbResult<Vec<TimecardEntry>> {
    db.call(move |conn| timecards::list_entries(conn, timecard_id)).await
}

#[tauri::command]
pub async fn generate_timecard_entries(
    db: State<'_, Db>,
    timecard_id: i64,
    settings: GenerationSettings,
) -> DbResult<GenerationResult> {
    db.call(move |conn| timecards::generate_entries(conn, timecard_id, &settings)).await
}

#[tauri::command]
pub async fn add_timecard_entry(
    db: State<'_, Db>,
    timecard_id: i64,
    entry: EntryInput,
) -> DbResult<TimecardEntry> {
    db.call(move |conn| timecards::add_manual_entry(conn, timecard_id, &entry)).await
}

#[tauri::command]
pub async fn update_timecard_entry(
    db: State<'_, Db>,
    id: i64,
    entry: EntryInput,
) -> DbResult<Option<TimecardEntry>> {
    db.call(move |conn| timecards::update_entry(conn, id, &entry)).await
}

/// Every entry between two dates, across whatever timecards hold them. A
/// month is a view over its weeks, so its totals are read this way.
#[tauri::command]
pub async fn get_timecard_entries_in_range(
    db: State<'_, Db>,
    start_date: String,
    end_date: String,
) -> DbResult<Vec<TimecardEntry>> {
    db.call(move |conn| timecards::list_entries_in_range(conn, &start_date, &end_date)).await
}

/// One grid cell, set to what the user typed. Returns the entry that now
/// stands behind it, or `None` when the cell was cleared.
#[tauri::command]
pub async fn set_timecard_cell(
    db: State<'_, Db>,
    timecard_id: i64,
    cell: CellInput,
) -> DbResult<Option<TimecardEntry>> {
    db.call(move |conn| timecards::set_cell(conn, timecard_id, &cell)).await
}

#[tauri::command]
pub async fn delete_timecard_entry(db: State<'_, Db>, id: i64) -> DbResult<bool> {
    db.call(move |conn| timecards::delete_entry(conn, id)).await
}

#[tauri::command]
pub async fn submit_timecard(db: State<'_, Db>, id: i64) -> DbResult<Option<Timecard>> {
    db.call(move |conn| timecards::submit_timecard(conn, id)).await
}

#[tauri::command]
pub async fn reopen_timecard(db: State<'_, Db>, id: i64) -> DbResult<Option<Timecard>> {
    db.call(move |conn| timecards::reopen_timecard(conn, id)).await
}

#[tauri::command]
pub async fn get_mapping_rules(db: State<'_, Db>) -> DbResult<Vec<MappingRule>> {
    db.call(mapping_rules::list_mapping_rules).await
}

#[tauri::command]
pub async fn create_mapping_rule(db: State<'_, Db>, rule: MappingRuleInput) -> DbResult<MappingRule> {
    db.call(move |conn| mapping_rules::create_mapping_rule(conn, &rule)).await
}

#[tauri::command]
pub async fn update_mapping_rule(
    db: State<'_, Db>,
    id: i64,
    rule: MappingRuleInput,
) -> DbResult<Option<MappingRule>> {
    db.call(move |conn| mapping_rules::update_mapping_rule(conn, id, &rule)).await
}

#[tauri::command]
pub async fn delete_mapping_rule(db: State<'_, Db>, id: i64) -> DbResult<bool> {
    db.call(move |conn| mapping_rules::delete_mapping_rule(conn, id)).await
}

#[tauri::command]
pub async fn reorder_mapping_rules(db: State<'_, Db>, ids: Vec<i64>) -> DbResult<()> {
    db.call(move |conn| mapping_rules::reorder_mapping_rules(conn, &ids)).await
}

#[tauri::command]
pub async fn apply_mapping_rules(
    db: State<'_, Db>,
    overwrite_existing: bool,
) -> DbResult<MappingRunResult> {
    db.call(move |conn| mapping::apply_rules(conn, overwrite_existing)).await
}

#[tauri::command]
pub async fn get_unmapped_groups(
    db: State<'_, Db>,
    start: String,
    end: String,
    billable_only: bool,
) -> DbResult<Vec<UnmappedGroup>> {
    db.call(move |conn| mapping::unmapped_groups(conn, &start, &end, billable_only)).await
}

#[tauri::command]
pub async fn map_events(
    db: State<'_, Db>,
    event_ids: Vec<i64>,
    project_id: i64,
    activity_id: Option<i64>,
) -> DbResult<usize> {
    db.call(move |conn| mapping::map_events(conn, &event_ids, project_id, activity_id)).await
}

#[tauri::command]
pub async fn unmap_events(db: State<'_, Db>, event_ids: Vec<i64>) -> DbResult<usize> {
    db.call(move |conn| mapping::unmap_events(conn, &event_ids)).await
}

#[tauri::command]
pub async fn preview_project_import(
    db: State<'_, Db>,
    path: String,
) -> DbResult<ProjectImportPreview> {
    db.call(move |conn| project_import::preview_project_import(conn, &path)).await
}

#[tauri::command]
pub async fn commit_project_import(
    db: State<'_, Db>,
    projects: Vec<ProjectInput>,
) -> DbResult<ProjectImportOutcome> {
    db.call(move |conn| project_import::commit_project_import(conn, &projects)).await
}

#[tauri::command]
pub async fn get_projects(db: State<'_, Db>) -> DbResult<Vec<Project>> {
    db.call(projects::list_projects).await
}

#[tauri::command]
pub async fn create_project(db: State<'_, Db>, project: ProjectInput) -> DbResult<Project> {
    db.call(move |conn| projects::create_project(conn, &project)).await
}

#[tauri::command]
pub async fn update_project(
    db: State<'_, Db>,
    id: i64,
    project: ProjectInput,
) -> DbResult<Option<Project>> {
    db.call(move |conn| projects::update_project(conn, id, &project)).await
}

#[tauri::command]
pub async fn delete_project(db: State<'_, Db>, id: i64) -> DbResult<DeleteProjectOutcome> {
    db.call(move |conn| projects::delete_project(conn, id)).await
}

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
pub async fn delete_activity(db: State<'_, Db>, id: i64) -> DbResult<DeleteActivityOutcome> {
    db.call(move |conn| activities::delete_activity(conn, id)).await
}

#[tauri::command]
pub async fn update_rule_priorities(db: State<'_, Db>, rule_ids: Vec<i64>) -> DbResult<bool> {
    db.call(move |conn| event_types::update_rule_priorities(conn, &rule_ids)).await
}

#[tauri::command]
pub async fn evaluate_event_type(db: State<'_, Db>, fields: EventFieldsInput) -> DbResult<Option<i64>> {
    db.call(move |conn| assignment::evaluate_event_type(conn, &fields.into())).await
}

#[tauri::command]
pub async fn set_event_type_manually(db: State<'_, Db>, event_id: i64, type_id: i64) -> DbResult<bool> {
    db.call(move |conn| assignment::set_event_type_manually(conn, event_id, type_id)).await
}

#[tauri::command]
pub async fn reprocess_event_types(db: State<'_, Db>) -> DbResult<ReprocessEventTypesResult> {
    db.call(|conn| Ok(assignment::reprocess_event_types(conn))).await
}

#[tauri::command]
pub async fn reset_event_type_to_auto(db: State<'_, Db>, event_id: i64) -> DbResult<Option<i64>> {
    db.call(move |conn| assignment::reset_event_type_to_auto(conn, event_id)).await
}
