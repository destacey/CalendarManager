mod auth;
mod commands;
mod db;

use std::time::Duration;

use tauri::Manager;

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
