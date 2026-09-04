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
/// `syncConfig`, when present in `legacy` *and* not already present in the
/// new store. A non-object `legacy` input (or one missing all three keys)
/// yields an empty map rather than an error, since the caller treats
/// "nothing to carry" as a normal outcome, not a failure.
///
/// The gate is per-key, not all-or-nothing: `lib.rs` used to skip this whole
/// function once `appRegistrationId` alone was already set (e.g. the user
/// signed in during the auth milestone), which meant `timezone` and
/// `syncConfig` were never carried over on the one machine the feature was
/// written for — a missing timezone silently renders every event in the
/// system zone instead of the user's configured one. `already_present` is
/// queried independently for each key so one already-set key can never
/// suppress carrying over the others.
pub fn keys_to_carry_over(
    legacy: &Value,
    already_present: impl Fn(&str) -> bool,
) -> Map<String, Value> {
    let mut carried = Map::new();
    let Some(legacy) = legacy.as_object() else {
        return carried;
    };
    for key in LEGACY_KEYS_TO_CARRY_OVER {
        if already_present(key) {
            continue;
        }
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

    /// Nothing is already present in the new store, so every recognised key
    /// legacy has is carried; the one legacy doesn't recognise is not.
    #[test]
    fn carries_over_only_the_keys_we_recognise() {
        let legacy = json!({
            "appRegistrationId": "abc-123",
            "timezone": "Europe/London",
            "syncConfig": { "startDate": "2026-01-01", "endDate": "2026-01-31" },
            "somethingElse": 42
        });

        let carried = keys_to_carry_over(&legacy, |_| false);

        assert_eq!(carried.len(), 3);
        assert_eq!(carried.get("timezone").unwrap(), "Europe/London");
        assert!(carried.contains_key("appRegistrationId"));
        assert!(carried.contains_key("syncConfig"));
        assert!(!carried.contains_key("somethingElse"));
    }

    #[test]
    fn skips_keys_that_are_absent_from_legacy() {
        let carried = keys_to_carry_over(&json!({ "timezone": "UTC" }), |_| false);

        assert_eq!(carried.len(), 1);
        assert!(carried.contains_key("timezone"));
    }

    /// The per-key gate this task exists to fix: `lib.rs` used to gate the
    /// *entire* carry-over on `appRegistrationId` alone being absent, so a
    /// user who had already signed in (only `appRegistrationId` set) never
    /// got `timezone` or `syncConfig` carried over at all. Each key must now
    /// be checked independently — a key already present in the new store is
    /// left untouched, while an absent one is still carried.
    #[test]
    fn a_key_already_present_in_the_new_store_is_not_overwritten_while_an_absent_one_is_carried() {
        let legacy = json!({
            "appRegistrationId": "legacy-client-id",
            "timezone": "Europe/London",
            "syncConfig": { "startDate": "2026-01-01", "endDate": "2026-01-31" }
        });

        // Simulates a new store that already has appRegistrationId (the user
        // signed in during the auth milestone) but neither timezone nor
        // syncConfig.
        let carried = keys_to_carry_over(&legacy, |key| key == "appRegistrationId");

        assert_eq!(carried.len(), 2, "the already-present key must be skipped, the two absent ones carried");
        assert!(!carried.contains_key("appRegistrationId"), "must not overwrite a key the new store already has");
        assert_eq!(carried.get("timezone").unwrap(), "Europe/London");
        assert!(carried.contains_key("syncConfig"));
    }

    #[test]
    fn returns_nothing_for_a_non_object() {
        assert!(keys_to_carry_over(&json!("not an object"), |_| false).is_empty());
        assert!(keys_to_carry_over(&json!(null), |_| false).is_empty());
    }
}
