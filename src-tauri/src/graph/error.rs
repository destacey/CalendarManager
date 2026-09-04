use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("Sync is already running")]
    AlreadyRunning,

    #[error("Sync was cancelled")]
    Cancelled,

    #[error("Unknown timezone: {0}")]
    UnknownTimezone(String),

    #[error("Invalid sync date {0}")]
    InvalidDate(String),

    #[error("Unable to sync while offline. Please check your internet connection.")]
    Offline,

    #[error("Microsoft Graph error: {0}")]
    Graph(String),

    #[error("{0}")]
    Auth(String),

    #[error("{0}")]
    Database(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for SyncError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type GraphResult<T> = Result<T, SyncError>;
