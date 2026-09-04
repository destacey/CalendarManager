use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("Could not access the database file: {0}")]
    Io(#[from] std::io::Error),

    #[error("Database is unavailable")]
    Unavailable,

    #[error("{0}")]
    Other(String),
}

impl Serialize for DbError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type DbResult<T> = Result<T, DbError>;
