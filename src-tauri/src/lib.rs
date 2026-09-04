mod auth;
mod commands;
mod db;

use std::time::Duration;

use tauri::Manager;
use tauri_plugin_store::StoreExt;

use auth::AuthState;

/// If the frontend never mounts (CSP violation, devUrl mismatch, module
/// error), `src/main.tsx` never calls `show()` and the process would run with
/// no window at all — leaving no way to open devtools and diagnose it. Show
/// the window unconditionally after this long so a failed load is visible
/// rather than silent.
const WINDOW_SHOW_FALLBACK: Duration = Duration::from_secs(5);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .manage(AuthState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(WINDOW_SHOW_FALLBACK);
                if let Some(window) = handle.get_webview_window("main") {
                    // Already shown by the frontend on a healthy start.
                    if !window.is_visible().unwrap_or(true) {
                        eprintln!(
                            "Frontend did not signal ready within {:?}; showing window anyway",
                            WINDOW_SHOW_FALLBACK
                        );
                        let _ = window.show();
                    }
                }
            });

            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("no app data dir: {e}"))?;

            // Corrupt-store guard: must run before the database is opened,
            // and before anything else touches config.json. `app.store()`'s
            // first build already attempted a load and silently swallowed a
            // deserialize failure (tauri-plugin-store's `build()` discards
            // that error), so every read would otherwise fall through to its
            // default with no sign anything is wrong — and the first write
            // this session makes would then truncate the bad file, destroying
            // it. `Store::reload()` re-reads the same file but *does*
            // propagate a deserialize error, which is the only way to detect
            // this before it's too late. This matters more than a merely
            // corrupt preferences file would: once a "legacy database already
            // copied" marker lives in this store, silently resetting it could
            // re-run the legacy database copy against a database that is
            // already live.
            match app.store(commands::config::STORE_FILE) {
                Ok(config_store) => {
                    if let Err(tauri_plugin_store::Error::Deserialize(_)) = config_store.reload() {
                        let config_path = app_data_dir.join(commands::config::STORE_FILE);
                        let corrupt_path =
                            app_data_dir.join(format!("{}.corrupt", commands::config::STORE_FILE));
                        // Renamed, not deleted, and overwriting any previous
                        // `.corrupt` file: the bad bytes survive for
                        // diagnosis rather than being clobbered by the next
                        // write. This logs via `eprintln!`, which only reaches
                        // anywhere under `tauri dev` — `main.rs` builds with
                        // `windows_subsystem = "windows"` in release, so there
                        // is no console for a packaged build to show it on.
                        eprintln!(
                            "{} could not be parsed; preserving it as {} rather than letting the \
                             next write silently truncate it",
                            config_path.display(),
                            corrupt_path.display()
                        );
                        if let Err(e) = std::fs::rename(&config_path, &corrupt_path) {
                            eprintln!(
                                "could not rename corrupt config {} to {}: {e}",
                                config_path.display(),
                                corrupt_path.display()
                            );
                        }
                    }

                    // One-time carry-over from the abandoned electron-store
                    // config. Gated per-key, not on the store as a whole:
                    // `appRegistrationId`, `timezone` and `syncConfig` are
                    // each carried only if that particular key is still
                    // absent from the new store — never overwriting a key
                    // the user (or a previous carry-over) already set. This
                    // matters because the user signing in during the auth
                    // milestone already populates `appRegistrationId` alone;
                    // gating the whole block on that one key (as an earlier
                    // version of this code did) meant `timezone` and
                    // `syncConfig` were never carried over at all.
                    {
                        // Electron's config lived at
                        // `%APPDATA%/calendarmanager/config.json`; the Tauri
                        // app's app-data dir is
                        // `%APPDATA%/com.triowfs.calendarmanager`, so the
                        // legacy file is a sibling directory of this one.
                        if let Some(appdata_root) = app_data_dir.parent() {
                            let legacy_config_path =
                                appdata_root.join("calendarmanager").join("config.json");
                            match std::fs::read(&legacy_config_path) {
                                Ok(bytes) => {
                                    match serde_json::from_slice::<serde_json::Value>(&bytes) {
                                        Ok(legacy) => {
                                            let carried = commands::config::keys_to_carry_over(
                                                &legacy,
                                                |key| config_store.get(key).is_some(),
                                            );
                                            if carried.is_empty() {
                                                eprintln!(
                                                    "Legacy config at {} had none of the keys we \
                                                     carry over that aren't already set",
                                                    legacy_config_path.display()
                                                );
                                            } else {
                                                let carried_keys: Vec<String> =
                                                    carried.keys().cloned().collect();
                                                for (key, value) in carried {
                                                    config_store.set(key, value);
                                                }
                                                match config_store.save() {
                                                    Ok(()) => eprintln!(
                                                        "Carried over legacy config keys {:?} \
                                                         from {} (left untouched)",
                                                        carried_keys,
                                                        legacy_config_path.display()
                                                    ),
                                                    Err(e) => eprintln!(
                                                        "could not save carried-over config: {e}"
                                                    ),
                                                }
                                            }
                                        }
                                        Err(e) => eprintln!(
                                            "Legacy config at {} could not be parsed, skipping \
                                             carry-over: {e}",
                                            legacy_config_path.display()
                                        ),
                                    }
                                }
                                // No legacy install on this machine (or the
                                // user never had one) — nothing to carry over.
                                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                                Err(e) => eprintln!(
                                    "could not read legacy config {}: {e}",
                                    legacy_config_path.display()
                                ),
                            }
                        }
                    }
                }
                Err(e) => eprintln!("could not open config store: {e}"),
            }

            // Where electron/main.js kept it: the repo root, i.e. the parent of
            // src-tauri during development. Also check beside the executable,
            // which is where a packaged Electron build would have left it.
            // The bare working directory is checked last and least trusted:
            // a packaged app's cwd is whatever launched it, so an unrelated
            // file there is the most likely false match (see
            // `migrate::looks_like_sqlite`, which guards against adopting one).
            let mut legacy = Vec::new();
            if let Ok(cwd) = std::env::current_dir() {
                legacy.push(cwd.join("..").join("calendar.db"));
            }
            if let Ok(exe) = std::env::current_exe() {
                if let Some(dir) = exe.parent() {
                    legacy.push(dir.join("calendar.db"));
                }
            }
            if let Ok(cwd) = std::env::current_dir() {
                legacy.push(cwd.join("calendar.db"));
            }

            match db::open(&app_data_dir, &legacy) {
                Ok(db) => {
                    app.manage(db);
                }
                // Don't abort setup: this runs before the window is shown, so a
                // failure here would leave the user with no window and nothing
                // to diagnose. Database commands will fail with a clear error.
                Err(error) => eprintln!("Could not open the database: {error}"),
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::config::get_config,
            commands::config::set_config,
            commands::config::clear_config,
            commands::auth::login,
            commands::auth::cancel_login,
            commands::auth::logout,
            commands::auth::get_account,
            commands::auth::has_session,
            commands::db::get_events,
            commands::db::get_events_in_range,
            commands::db::create_event,
            commands::db::update_event,
            commands::db::delete_event,
            commands::db::get_categories,
            commands::db::create_category,
            commands::db::get_event_types,
            commands::db::create_event_type,
            commands::db::update_event_type,
            commands::db::delete_event_type,
            commands::db::set_default_event_type,
            commands::db::get_event_type_rules,
            commands::db::create_event_type_rule,
            commands::db::update_event_type_rule,
            commands::db::delete_event_type_rule,
            commands::db::update_rule_priorities,
            commands::db::evaluate_event_type,
            commands::db::set_event_type_manually,
            commands::db::reprocess_event_types,
            commands::db::reset_event_type_to_auto,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
