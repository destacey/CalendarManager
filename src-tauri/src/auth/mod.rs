pub mod error;
pub mod loopback;
pub mod pkce;
pub mod tokens;

use std::sync::atomic::{AtomicBool, Ordering};
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
}

struct Session {
    token: AccessToken,
    account: Account,
}

impl AuthState {
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

    pub fn set_session(&self, token: AccessToken, account: Account) {
        *self.session.lock().expect("auth state poisoned") =
            Some(Session { token, account });
    }

    pub fn clear_session(&self) {
        *self.session.lock().expect("auth state poisoned") = None;
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

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    /// A clone of the flag the loopback listener polls. Cloning the Arc, not
    /// the flag, is what lets the blocking thread and `cancel_login` share it.
    pub fn cancel_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancelled)
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
}
