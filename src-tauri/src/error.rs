use serde::Serialize;
use ts_rs::TS;

// `thiserror` generates the `Display` impl from the `#[error(...)]` attributes.
// `#[serde(tag = "kind", content = "message")]` gives a predictable JSON shape
// the TS side can discriminate on: `{ kind: "NotFound", message: "..." }`.
#[derive(Debug, Serialize, thiserror::Error, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(tag = "kind", content = "message")]
pub enum IpcError {
    #[error("not found: {0}")]
    NotFound(String),

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("io: {0}")]
    Io(String),

    #[error("database: {0}")]
    Database(String),

    #[error("invalid: {0}")]
    Invalid(String),
}

// `#[from]` would work but rusqlite constraint violations deserve the more
// specific `Conflict` variant so the UI can distinguish duplicates from
// generic DB failures.
impl From<rusqlite::Error> for IpcError {
    fn from(e: rusqlite::Error) -> Self {
        if let rusqlite::Error::SqliteFailure(inner, _) = &e {
            if inner.code == rusqlite::ErrorCode::ConstraintViolation {
                return IpcError::Conflict(e.to_string());
            }
        }
        IpcError::Database(e.to_string())
    }
}

impl From<std::io::Error> for IpcError {
    fn from(e: std::io::Error) -> Self {
        IpcError::Io(e.to_string())
    }
}
