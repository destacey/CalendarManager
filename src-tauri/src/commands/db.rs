// Thin `#[tauri::command]` wrappers around `db::events` and `db::categories`.
// The auth milestone learned the hard way that logic belongs below the IPC
// layer, not in it — every command here is just argument plumbing into
// `Db::call`, which is what actually talks to SQLite on a blocking thread.

use tauri::State;

use crate::db::categories::{self, NewCategory};
use crate::db::error::DbResult;
use crate::db::events::{self, EventUpdate, NewEvent};
use crate::db::models::{Category, Event};
use crate::db::Db;

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
pub async fn get_categories(db: State<'_, Db>) -> DbResult<Vec<Category>> {
    db.call(categories::get_categories).await
}

#[tauri::command]
pub async fn create_category(db: State<'_, Db>, category: NewCategory) -> DbResult<Category> {
    db.call(move |conn| categories::create_category(conn, &category)).await
}
