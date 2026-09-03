mod auth;
mod commands;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
