pub mod error;
pub mod flow;
pub mod loopback;
pub mod pkce;
pub mod secret_store;
pub mod tokens;

pub use flow::{client_id, ensure_access_token, refresh_token_path, run_login};

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use error::{AuthError, AuthResult};
use tokens::{AccessToken, Account};

/// Auth state for the app's lifetime. The access token lives here and nowhere
/// else — never on disk, never across IPC.
#[derive(Default)]
pub struct AuthState {
    session: Mutex<Option<Session>>,
    login_in_flight: AtomicBool,
    /// An Arc so a clone can move into the blocking listener thread while
    /// `cancel_login` still reaches the same flag from the command.
    cancelled: Arc<AtomicBool>,
    /// Bumped every time the session is cleared. A refresh in flight when a
    /// logout happens captures the generation beforehand and checks it again
    /// before writing the result back, so a logout can't be silently undone
    /// by a refresh that was already underway.
    generation: AtomicU64,
    /// Serializes concurrent refreshes so two callers that both miss the
    /// fresh-token fast path don't each mint (and race to persist) a
    /// different rotated refresh token.
    refresh_lock: tokio::sync::Mutex<()>,
}

struct Session {
    token: AccessToken,
    account: Account,
}

impl AuthState {
    /// Test-only: production reads a session through `account` or
    /// `fresh_token`, never as a bare "is there one".
    #[cfg(test)]
    pub fn has_session(&self) -> bool {
        self.session.lock().expect("auth state poisoned").is_some()
    }

    pub fn account(&self) -> Option<Account> {
        self.session
            .lock()
            .expect("auth state poisoned")
            .as_ref()
            .map(|session| session.account.clone())
    }

    /// Test-only setup. Production always goes through
    /// `set_session_if_current`, so that a `clear_session` racing a slow
    /// refresh cannot be silently undone — a plain setter would lose that.
    #[cfg(test)]
    pub fn set_session(&self, token: AccessToken, account: Account) {
        *self.session.lock().expect("auth state poisoned") =
            Some(Session { token, account });
    }

    pub fn clear_session(&self) {
        *self.session.lock().expect("auth state poisoned") = None;
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    /// The current session generation. A caller that is about to do
    /// something slow (a network refresh) should capture this beforehand and
    /// pass it to `set_session_if_current` afterward, so a `clear_session` in
    /// between is not silently undone.
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// Sets the session, but only if `generation` still matches the current
    /// generation. Returns `true` if the session was set, `false` if a
    /// `clear_session` happened in the meantime and the caller's result is
    /// therefore stale and must not be applied.
    pub fn set_session_if_current(
        &self,
        generation: u64,
        token: AccessToken,
        account: Account,
    ) -> bool {
        let mut guard = self.session.lock().expect("auth state poisoned");
        if self.generation.load(Ordering::SeqCst) != generation {
            return false;
        }
        *guard = Some(Session { token, account });
        true
    }

    /// Returns the current access token if it is still fresh enough to use.
    pub fn fresh_token(&self) -> Option<String> {
        let guard = self.session.lock().expect("auth state poisoned");
        guard
            .as_ref()
            .filter(|session| !session.token.is_stale())
            .map(|session| session.token.value.clone())
    }

    pub fn begin_login(&self) -> AuthResult<()> {
        if self
            .login_in_flight
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(AuthError::LoginInProgress);
        }
        // A cancel from a previous attempt must not kill this one.
        self.cancelled.store(false, Ordering::SeqCst);
        Ok(())
    }

    pub fn end_login(&self) {
        self.login_in_flight.store(false, Ordering::SeqCst);
    }

    pub fn cancel_login(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    /// Test-only: the loopback listener polls the shared flag from
    /// `cancel_flag` on its own thread rather than calling back into here.
    #[cfg(test)]
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    /// A clone of the flag the loopback listener polls. Cloning the Arc, not
    /// the flag, is what lets the blocking thread and `cancel_login` share it.
    pub fn cancel_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancelled)
    }

    /// The lock a refresh must hold while it talks to the token endpoint, so
    /// two callers that both find no fresh token don't each mint a different
    /// rotated refresh token and stomp on one another.
    pub fn refresh_lock(&self) -> &tokio::sync::Mutex<()> {
        &self.refresh_lock
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_state_has_no_session() {
        let state = AuthState::default();
        assert!(!state.has_session());
        assert!(state.account().is_none());
    }

    #[test]
    fn recording_a_session_exposes_the_account() {
        let state = AuthState::default();

        state.set_session(
            tokens::AccessToken::new("at".into(), 3600),
            tokens::Account {
                name: "Ada Lovelace".into(),
                username: "ada@example.com".into(),
            },
        );

        assert!(state.has_session());
        assert_eq!(state.account().unwrap().username, "ada@example.com");
    }

    #[test]
    fn clearing_a_session_removes_the_account() {
        let state = AuthState::default();
        state.set_session(
            tokens::AccessToken::new("at".into(), 3600),
            tokens::Account {
                name: "Ada".into(),
                username: "ada@example.com".into(),
            },
        );

        state.clear_session();

        assert!(!state.has_session());
        assert!(state.account().is_none());
    }

    #[test]
    fn only_one_login_may_be_in_flight() {
        let state = AuthState::default();

        assert!(state.begin_login().is_ok());
        assert!(matches!(
            state.begin_login(),
            Err(error::AuthError::LoginInProgress)
        ));

        state.end_login();
        assert!(state.begin_login().is_ok());
    }

    #[test]
    fn cancelling_sets_the_flag_the_listener_polls() {
        let state = AuthState::default();
        state.begin_login().unwrap();

        state.cancel_login();

        assert!(state.is_cancelled());
    }

    #[test]
    fn beginning_a_login_clears_a_stale_cancel_flag() {
        let state = AuthState::default();
        state.begin_login().unwrap();
        state.cancel_login();
        state.end_login();

        state.begin_login().unwrap();

        assert!(!state.is_cancelled());
    }

    #[test]
    fn a_new_states_generation_is_stable_across_set_session() {
        let state = AuthState::default();
        let generation = state.generation();

        state.set_session(
            tokens::AccessToken::new("at".into(), 3600),
            tokens::Account {
                name: "Ada".into(),
                username: "ada@example.com".into(),
            },
        );

        assert_eq!(state.generation(), generation);
    }

    #[test]
    fn clearing_the_session_increments_the_generation() {
        let state = AuthState::default();
        let generation = state.generation();

        state.clear_session();

        assert_eq!(state.generation(), generation + 1);
    }

    #[test]
    fn set_session_if_current_succeeds_with_the_current_generation() {
        let state = AuthState::default();
        let generation = state.generation();

        let applied = state.set_session_if_current(
            generation,
            tokens::AccessToken::new("at".into(), 3600),
            tokens::Account {
                name: "Ada".into(),
                username: "ada@example.com".into(),
            },
        );

        assert!(applied);
        assert!(state.has_session());
        assert_eq!(state.account().unwrap().username, "ada@example.com");
    }

    #[test]
    fn set_session_if_current_fails_with_a_stale_generation_and_leaves_no_session() {
        let state = AuthState::default();
        let generation = state.generation();
        state.clear_session(); // bumps the generation past what we captured

        let applied = state.set_session_if_current(
            generation,
            tokens::AccessToken::new("at".into(), 3600),
            tokens::Account {
                name: "Ada".into(),
                username: "ada@example.com".into(),
            },
        );

        assert!(!applied);
        assert!(!state.has_session());
    }
}
