use serde::{Serialize, Serializer};

/// Auth failures the frontend may need to distinguish. Serializes to a plain
/// string for the IPC boundary, but stays a real enum in Rust so call sites
/// can match on it.
#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("No app registration ID is configured")]
    NotConfigured,

    #[error("A login is already in progress")]
    LoginInProgress,

    #[error("Login was cancelled")]
    Cancelled,

    #[error("Login timed out")]
    TimedOut,

    #[error("The sign-in response did not match this login attempt")]
    StateMismatch,

    #[error("Not signed in")]
    NoSession,

    #[error("Microsoft rejected the sign-in: {0}")]
    Provider(String),

    /// The refresh token itself is invalid, revoked or expired. Distinct from
    /// Provider so that only this discards the stored credential.
    #[error("Your sign-in has expired: {0}")]
    InvalidGrant(String),

    #[error("Network error talking to Microsoft: {0}")]
    Network(String),

    #[error("Could not access secure storage: {0}")]
    SecretStore(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AuthError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AuthResult<T> = Result<T, AuthError>;
