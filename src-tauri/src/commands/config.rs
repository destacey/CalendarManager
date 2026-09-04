use serde_json::{Map, Value};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

/// Config lives in one JSON file in the app data dir, replacing electron-store.
/// `pub(crate)` so `lib.rs`'s `setup` hook can address the same file for the
/// corrupt-store guard and the legacy-config carry-over, without duplicating
/// the filename as a second string literal that could drift out of sync.
pub(crate) const STORE_FILE: &str = "config.json";

/// The keys carried over from a legacy `electron-store` config during the
/// one-time migration. Deliberately not `syncMetadata`: the design spec
/// records that nothing reads or writes it, so carrying it forward would
/// just be resurrecting dead state.
const LEGACY_KEYS_TO_CARRY_OVER: [&str; 3] = ["appRegistrationId", "timezone", "syncConfig"];

/// Picks the subset of a legacy `electron-store` config JSON value worth
/// carrying into the new store: `appRegistrationId`, `timezone` and
/// `syncConfig`, when present. A non-object input (or one missing all three
/// keys) yields an empty map rather than an error, since the caller treats
/// "nothing to carry" as a normal outcome, not a failure.
pub fn keys_to_carry_over(legacy: &Value) -> Map<String, Value> {
    let mut carried = Map::new();
    let Some(legacy) = legacy.as_object() else {
        return carried;
    };
    for key in LEGACY_KEYS_TO_CARRY_OVER {
        if let Some(value) = legacy.get(key) {
            carried.insert(key.to_string(), value.clone());
        }
    }
    carried
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn carries_over_only_the_keys_we_recognise() {
        let legacy = json!({
            "appRegistrationId": "abc-123",
            "timezone": "Europe/London",
            "syncConfig": { "startDate": "2026-01-01", "endDate": "2026-01-31" },
            "somethingElse": 42
        });

        let carried = keys_to_carry_over(&legacy);

        assert_eq!(carried.len(), 3);
        assert_eq!(carried.get("timezone").unwrap(), "Europe/London");
        assert!(carried.contains_key("appRegistrationId"));
        assert!(carried.contains_key("syncConfig"));
        assert!(!carried.contains_key("somethingElse"));
    }

    #[test]
    fn skips_keys_that_are_absent() {
        let carried = keys_to_carry_over(&json!({ "timezone": "UTC" }));

        assert_eq!(carried.len(), 1);
        assert!(carried.contains_key("timezone"));
    }

    #[test]
    fn returns_nothing_for_a_non_object() {
        assert!(keys_to_carry_over(&json!("not an object")).is_empty());
        assert!(keys_to_carry_over(&json!(null)).is_empty());
    }
}
