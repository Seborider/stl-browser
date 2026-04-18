use std::path::Path;

use rusqlite::Connection;

use crate::error::IpcError;

pub mod libraries;
pub mod migrations;

// Opens (or creates) the SQLite file, enables sensible pragmas, and applies
// any pending migrations. Called once at app startup from the Tauri setup hook.
pub fn open(path: &Path) -> Result<Connection, IpcError> {
    let mut conn = Connection::open(path)?;
    // WAL lets the (future) scanner write while the UI reads without blocking.
    // `execute_batch` runs statements that may return no row (PRAGMA, DDL).
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;\n\
         PRAGMA foreign_keys = ON;",
    )?;
    migrations::run(&mut conn)?;
    Ok(conn)
}
