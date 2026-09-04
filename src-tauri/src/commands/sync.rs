//! The three-command IPC surface over `graph::sync::run`: start it, cancel
//! it, and report whether one is in flight. All the actual sync logic lives
//! in `graph::sync` — this module is only bookkeeping for "is one running"
//! plus the plumbing to spawn and cancel it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio_util::sync::CancellationToken;

use crate::graph::error::SyncError;
use crate::graph::sync::{run, SyncResult, SyncStats};

/// Tracks whether a sync is in flight and holds the token that can cancel
/// it. `running` is the single source of truth `start_sync` checks and
/// `sync_status` reports; it is cleared by `RunningGuard` on every exit path
/// the spawned task can take — success, failure, cancellation, or panic —
/// the same bug class the auth milestone shipped when a failed login left
/// `login_in_flight` stuck true (see `auth::AuthState::begin_login`/
/// `end_login`, which this mirrors).
#[derive(Default)]
pub struct SyncState {
    running: AtomicBool,
    cancel: Mutex<Option<CancellationToken>>,
}

impl SyncState {
    /// Atomically flips `running` from false to true and mints the
    /// `CancellationToken` this sync will carry, or refuses with
    /// `AlreadyRunning` if one is already in flight.
    fn try_begin(&self) -> Result<CancellationToken, SyncError> {
        if self
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(SyncError::AlreadyRunning);
        }
        let token = CancellationToken::new();
        *self.cancel.lock().expect("sync state poisoned") = Some(token.clone());
        Ok(token)
    }

    /// Clears `running` and drops the stored token. Called from
    /// `RunningGuard::drop`, so it runs no matter how the spawned task ends.
    fn end(&self) {
        *self.cancel.lock().expect("sync state poisoned") = None;
        self.running.store(false, Ordering::SeqCst);
    }

    fn cancel(&self) {
        if let Some(token) = self.cancel.lock().expect("sync state poisoned").as_ref() {
            token.cancel();
        }
    }

    fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
}

/// Clears `SyncState::running` on drop — including an unwinding panic —
/// which is what makes clearing the flag unconditional rather than
/// dependent on the spawned task reaching its last line.
struct RunningGuard<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> Drop for RunningGuard<R> {
    fn drop(&mut self) {
        self.app.state::<SyncState>().end();
    }
}

/// Builds the `SyncResult` for a sync that ended in `error` — Offline, a
/// Graph error, an auth failure, whatever — none of which `graph::sync::run`
/// itself turns into a `sync-complete` event (it only emits one on its own
/// success path), so this is what tells the frontend the attempt is over.
fn failure_result(error: &SyncError) -> SyncResult {
    SyncResult {
        success: false,
        message: error.to_string(),
        stats: SyncStats::default(),
        errors: Some(vec![error.to_string()]),
    }
}

#[tauri::command]
pub fn start_sync<R: Runtime>(app: AppHandle<R>) -> Result<(), SyncError> {
    let cancel_token = app.state::<SyncState>().try_begin()?;

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let _guard = RunningGuard { app: app_handle.clone() };

        match run(&app_handle, cancel_token).await {
            // The success path already emitted `sync-complete` itself.
            Ok(result) if result.success => {}
            // Cancellation is a normal `Ok`, but `run` never emits for it.
            Ok(cancelled) => {
                let _ = app_handle.emit("sync-complete", cancelled);
            }
            Err(error) => {
                let _ = app_handle.emit("sync-complete", failure_result(&error));
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_sync(state: State<'_, SyncState>) {
    state.cancel();
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusResponse {
    pub is_active: bool,
    pub can_sync: bool,
}

#[tauri::command]
pub fn sync_status(state: State<'_, SyncState>) -> SyncStatusResponse {
    let is_active = state.is_running();
    SyncStatusResponse { is_active, can_sync: !is_active }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_state_is_not_running_and_can_sync() {
        let state = SyncState::default();
        assert!(!state.is_running());
    }

    #[test]
    fn try_begin_flips_running_true_and_a_second_call_refuses() {
        let state = SyncState::default();

        assert!(state.try_begin().is_ok());
        assert!(state.is_running());

        match state.try_begin() {
            Err(SyncError::AlreadyRunning) => {}
            other => panic!("expected AlreadyRunning, got {other:?}"),
        }
    }

    #[test]
    fn end_clears_running_so_a_later_begin_succeeds() {
        let state = SyncState::default();

        state.try_begin().unwrap();
        state.end();

        assert!(!state.is_running());
        assert!(state.try_begin().is_ok(), "a fresh begin after end() must succeed");
    }

    /// The bug the auth milestone shipped: a stuck `running` flag would
    /// refuse every later attempt until restart. This asserts `end()` is
    /// exactly what unsticks it, whatever the exit path that called it —
    /// this test doesn't run the async task at all, so it stands in for
    /// "the failure path called end() too", proven directly rather than by
    /// spinning up a full sync against a fake server.
    #[test]
    fn a_stuck_running_flag_would_refuse_forever_until_end_is_called() {
        let state = SyncState::default();
        state.try_begin().unwrap();

        // Simulate the failure path never having called end(): still stuck.
        assert!(matches!(state.try_begin(), Err(SyncError::AlreadyRunning)));

        // The fix: end() is unconditional, so calling it (as RunningGuard's
        // Drop does on every exit path) frees the next attempt.
        state.end();
        assert!(state.try_begin().is_ok());
    }

    #[test]
    fn cancel_with_no_token_stored_does_not_panic() {
        let state = SyncState::default();
        state.cancel();
    }

    #[test]
    fn cancel_after_begin_cancels_the_stored_token() {
        let state = SyncState::default();
        let token = state.try_begin().unwrap();

        assert!(!token.is_cancelled());
        state.cancel();
        assert!(token.is_cancelled());
    }

    #[test]
    fn sync_status_response_serializes_camel_case() {
        let value = serde_json::to_value(SyncStatusResponse { is_active: true, can_sync: false })
            .unwrap();
        assert_eq!(value, serde_json::json!({ "isActive": true, "canSync": false }));
    }

    #[test]
    fn failure_result_carries_the_error_message_in_both_message_and_errors() {
        let result = failure_result(&SyncError::Offline);
        assert!(!result.success);
        assert_eq!(
            result.message,
            "Unable to sync while offline. Please check your internet connection."
        );
        assert_eq!(result.errors, Some(vec![result.message.clone()]));
    }
}
