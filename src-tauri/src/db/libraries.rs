use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};

use crate::error::IpcError;
use crate::types::Library;

pub fn list(conn: &Connection) -> Result<Vec<Library>, IpcError> {
    let mut stmt = conn.prepare(
        "SELECT id, path, name, added_at FROM libraries ORDER BY added_at ASC, id ASC",
    )?;
    // `query_map` lazily maps each row through our closure. `?` on the row
    // getters propagates a `rusqlite::Error` up; we collect into a Vec and
    // convert that error into `IpcError` via `From`.
    let rows: rusqlite::Result<Vec<Library>> = stmt
        .query_map([], |row| {
            Ok(Library {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                added_at: row.get(3)?,
            })
        })?
        .collect();
    Ok(rows?)
}

pub fn add(conn: &Connection, path: &str) -> Result<Library, IpcError> {
    let abs: PathBuf = PathBuf::from(path).canonicalize()?;
    if !abs.is_dir() {
        return Err(IpcError::Invalid(format!(
            "not a directory: {}",
            abs.display()
        )));
    }
    let abs_str = abs.to_string_lossy().into_owned();
    let name = abs
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| abs_str.clone());
    let added_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO libraries (path, name, added_at) VALUES (?1, ?2, ?3)",
        params![abs_str, name, added_at],
    )?;
    let id = conn.last_insert_rowid();

    Ok(Library {
        id,
        path: abs_str,
        name,
        added_at,
    })
}

pub fn remove(conn: &Connection, id: i64) -> Result<(), IpcError> {
    let affected = conn.execute("DELETE FROM libraries WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(IpcError::NotFound(format!("library id {id}")));
    }
    Ok(())
}
