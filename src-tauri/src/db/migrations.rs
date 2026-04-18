use rusqlite::{params, Connection};

use crate::error::IpcError;

// SQL for each numbered migration. Index 0 → version 1, index 1 → version 2, …
// Migrations are append-only: never edit a shipped migration; add a new one.
const MIGRATIONS: &[&str] = &[
    // v1 — libraries table. Matches PLAN.md §4.
    r#"
    CREATE TABLE libraries (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      path     TEXT    NOT NULL UNIQUE,
      name     TEXT    NOT NULL,
      added_at INTEGER NOT NULL
    );
    "#,
];

pub fn run(conn: &mut Connection) -> Result<(), IpcError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);",
    )?;

    let current: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version",
        [],
        |row| row.get(0),
    )?;

    for (idx, sql) in MIGRATIONS.iter().enumerate() {
        let version = (idx + 1) as i64;
        if version <= current {
            continue;
        }
        // Wrap schema change + bookkeeping in one transaction so a partial
        // apply can't leave `schema_version` out of sync with the actual schema.
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO schema_version (version) VALUES (?1)",
            params![version],
        )?;
        tx.commit()?;
    }

    Ok(())
}
