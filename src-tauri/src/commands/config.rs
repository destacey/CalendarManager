use serde_json::Value;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

/// Config lives in one JSON file in the app data dir, replacing electron-store.
const STORE_FILE: &str = "config.json";

#[tauri::command]
pub fn get_config<R: Runtime>(app: AppHandle<R>, key: String) -> Result<Option<Value>, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    Ok(store.get(&key))
}

#[tauri::command]
pub fn set_config<R: Runtime>(app: AppHandle<R>, key: String, value: Value) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(&key, value);
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_config<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.clear();
    store.save().map_err(|e| e.to_string())
}
