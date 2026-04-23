use std::collections::HashSet;

use rusqlite::{params, Connection, ToSql};

use crate::error::IpcError;

/// Insert (or no-op if already present) a thumbnail cache-index row.
/// The PNG bytes themselves live on disk at `<cache_dir>/thumbnails/<cache_key>.png`;
/// this table just records that the file exists plus its dimensions.
pub fn insert(
    conn: &Connection,
    cache_key: &str,
    generated_at: i64,
    width: i64,
    height: i64,
) -> Result<(), IpcError> {
    conn.execute(
        "INSERT OR REPLACE INTO thumbnails (cache_key, generated_at, width, height)\n\
         VALUES (?1, ?2, ?3, ?4)",
        params![cache_key, generated_at, width, height],
    )?;
    Ok(())
}

/// Return the subset of `cache_keys` that do NOT yet have a thumbnails row.
/// Used by the scanner / watcher to decide which files to emit in
/// `thumbnails:needed` — files whose cache_key already has a PNG get skipped.
pub fn filter_missing(
    conn: &Connection,
    cache_keys: &[String],
) -> Result<HashSet<String>, IpcError> {
    if cache_keys.is_empty() {
        return Ok(HashSet::new());
    }
    let placeholders = vec!["?"; cache_keys.len()].join(",");
    let sql = format!(
        "SELECT cache_key FROM thumbnails WHERE cache_key IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let args: Vec<Box<dyn ToSql>> = cache_keys
        .iter()
        .map(|k| Box::new(k.clone()) as Box<dyn ToSql>)
        .collect();
    let param_refs: Vec<&dyn ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let mut present: HashSet<String> = HashSet::new();
    let mut rows = stmt.query(rusqlite::params_from_iter(param_refs.iter()))?;
    while let Some(row) = rows.next()? {
        present.insert(row.get(0)?);
    }

    Ok(cache_keys
        .iter()
        .filter(|k| !present.contains(*k))
        .cloned()
        .collect())
}

/// Return all cache_keys that currently have a PNG. Used by the frontend
/// thumbnail queue at startup to avoid re-requesting work.
pub fn list_all_keys(conn: &Connection) -> Result<Vec<String>, IpcError> {
    let mut stmt = conn.prepare("SELECT cache_key FROM thumbnails")?;
    let rows: rusqlite::Result<Vec<String>> = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect();
    Ok(rows?)
}

/// Find all file_ids whose cache_key matches — used when `thumbnails:ready`
/// fires so the UI can refresh every tile that happens to share this hash
/// (identical files across libraries).
pub fn file_ids_for_cache_key(
    conn: &Connection,
    cache_key: &str,
) -> Result<Vec<i64>, IpcError> {
    let mut stmt = conn.prepare("SELECT id FROM files WHERE cache_key = ?1")?;
    let rows: rusqlite::Result<Vec<i64>> = stmt
        .query_map(params![cache_key], |r| r.get::<_, i64>(0))?
        .collect();
    Ok(rows?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn setup() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrations::run(&mut conn).unwrap();
        conn
    }

    #[test]
    fn insert_then_list_roundtrips() {
        let conn = setup();
        insert(&conn, "abc", 10, 512, 512).unwrap();
        insert(&conn, "def", 11, 256, 256).unwrap();
        let mut keys = list_all_keys(&conn).unwrap();
        keys.sort();
        assert_eq!(keys, vec!["abc", "def"]);
    }

    #[test]
    fn insert_is_idempotent() {
        let conn = setup();
        insert(&conn, "abc", 10, 512, 512).unwrap();
        insert(&conn, "abc", 20, 256, 256).unwrap();
        let keys = list_all_keys(&conn).unwrap();
        assert_eq!(keys, vec!["abc"]);
    }

    #[test]
    fn filter_missing_returns_only_absent() {
        let conn = setup();
        insert(&conn, "have", 0, 1, 1).unwrap();
        let missing = filter_missing(
            &conn,
            &vec!["have".into(), "nope".into(), "also_nope".into()],
        )
        .unwrap();
        assert_eq!(missing.len(), 2);
        assert!(missing.contains("nope"));
        assert!(missing.contains("also_nope"));
    }

    #[test]
    fn filter_missing_handles_empty_input() {
        let conn = setup();
        assert!(filter_missing(&conn, &[]).unwrap().is_empty());
    }

    #[test]
    fn file_ids_for_cache_key_finds_siblings() {
        let conn = setup();
        conn.execute(
            "INSERT INTO libraries (path, name, added_at) VALUES ('/a', 'a', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO libraries (path, name, added_at) VALUES ('/b', 'b', 0)",
            [],
        )
        .unwrap();
        for (lib, rel) in &[(1, "x.stl"), (2, "y.stl"), (2, "z.stl")] {
            conn.execute(
                "INSERT INTO files (library_id, rel_path, name, extension,\
                 size_bytes, mtime_ms, scanned_at, cache_key)\n\
                 VALUES (?1, ?2, ?2, 'stl', 0, 0, 0, 'shared')",
                params![lib, rel],
            )
            .unwrap();
        }
        // one more with a different key
        conn.execute(
            "INSERT INTO files (library_id, rel_path, name, extension,\
             size_bytes, mtime_ms, scanned_at, cache_key)\n\
             VALUES (1, 'other.stl', 'other.stl', 'stl', 0, 0, 0, 'solo')",
            [],
        )
        .unwrap();
        let mut ids = file_ids_for_cache_key(&conn, "shared").unwrap();
        ids.sort();
        assert_eq!(ids.len(), 3);
    }
}
