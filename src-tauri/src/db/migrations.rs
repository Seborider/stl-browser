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
    // v2 — files + mesh_metadata. bbox_* / triangle_count nullable under a
    // CHECK constraint so parse_error rows can exist without sentinel zeros.
    r#"
    CREATE TABLE files (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      library_id   INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      rel_path     TEXT    NOT NULL,
      name         TEXT    NOT NULL,
      extension    TEXT    NOT NULL,
      size_bytes   INTEGER NOT NULL,
      mtime_ms     INTEGER NOT NULL,
      scanned_at   INTEGER NOT NULL,
      cache_key    TEXT    NOT NULL,
      UNIQUE(library_id, rel_path)
    );
    CREATE INDEX idx_files_library   ON files(library_id);
    CREATE INDEX idx_files_name      ON files(name COLLATE NOCASE);
    CREATE INDEX idx_files_mtime     ON files(mtime_ms);
    CREATE INDEX idx_files_size      ON files(size_bytes);
    CREATE INDEX idx_files_cache_key ON files(cache_key);

    CREATE TABLE mesh_metadata (
      file_id          INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      bbox_min_x       REAL, bbox_min_y       REAL, bbox_min_z       REAL,
      bbox_max_x       REAL, bbox_max_y       REAL, bbox_max_z       REAL,
      volume_mm3       REAL,
      surface_area_mm2 REAL,
      triangle_count   INTEGER,
      computed_at      INTEGER NOT NULL,
      parse_error      TEXT,
      CHECK (
        parse_error IS NOT NULL
        OR (bbox_min_x IS NOT NULL AND bbox_min_y IS NOT NULL AND bbox_min_z IS NOT NULL
            AND bbox_max_x IS NOT NULL AND bbox_max_y IS NOT NULL AND bbox_max_z IS NOT NULL
            AND triangle_count IS NOT NULL)
      )
    );
    "#,
    // v3 — thumbnails cache index per PLAN.md §4. Keyed on cache_key so
    // identical files across libraries share a single PNG on disk. The PNG
    // itself lives at `<app_data>/thumbnails/<cache_key>.png`.
    r#"
    CREATE TABLE thumbnails (
      cache_key    TEXT PRIMARY KEY,
      generated_at INTEGER NOT NULL,
      width        INTEGER NOT NULL,
      height       INTEGER NOT NULL
    );
    CREATE INDEX idx_thumbnails_generated ON thumbnails(generated_at);
    "#,
    // v4 — key/value settings table for user preferences (PLAN.md §4).
    // Currently holds the theme override; opaque text values per key.
    r#"
    CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
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

#[cfg(test)]
mod tests {
    use super::*;

    fn open_memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode = MEMORY; PRAGMA foreign_keys = ON;",
        ).unwrap();
        conn
    }

    #[test]
    fn fresh_db_ends_at_latest_version() {
        let mut conn = open_memory();
        run(&mut conn).unwrap();

        let versions: Vec<i64> = conn
            .prepare("SELECT version FROM schema_version ORDER BY version")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(versions, vec![1, 2, 3, 4]);

        // files + mesh_metadata + thumbnails exist
        let has = |t: &str| -> bool {
            conn.query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
                [t],
                |_| Ok(()),
            ).is_ok()
        };
        assert!(has("libraries"));
        assert!(has("files"));
        assert!(has("mesh_metadata"));
        assert!(has("thumbnails"));
        assert!(has("settings"));
    }

    #[test]
    fn upgrade_from_v1_only_db() {
        // Simulate a Phase-2 DB that only has v1 applied.
        let mut conn = open_memory();
        conn.execute_batch(
            "CREATE TABLE schema_version (version INTEGER PRIMARY KEY);\n\
             INSERT INTO schema_version (version) VALUES (1);\n\
             CREATE TABLE libraries (
               id       INTEGER PRIMARY KEY AUTOINCREMENT,
               path     TEXT    NOT NULL UNIQUE,
               name     TEXT    NOT NULL,
               added_at INTEGER NOT NULL
             );",
        ).unwrap();

        run(&mut conn).unwrap();

        let max: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(max, 4);
    }

    #[test]
    fn mesh_metadata_check_constraint_rejects_all_null_geometry() {
        // A row with no parse_error AND no bbox must fail the CHECK constraint.
        let mut conn = open_memory();
        run(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO libraries (path, name, added_at) VALUES ('/tmp/x', 'x', 0);\n\
             INSERT INTO files (library_id, rel_path, name, extension,\
                                size_bytes, mtime_ms, scanned_at, cache_key)\n\
             VALUES (1, 'a.stl', 'a.stl', 'stl', 0, 0, 0, 'k');",
        ).unwrap();
        let err = conn.execute(
            "INSERT INTO mesh_metadata (file_id, computed_at) VALUES (1, 0)",
            [],
        );
        assert!(err.is_err(), "CHECK constraint should reject the row");
    }

    #[test]
    fn mesh_metadata_accepts_parse_error_row() {
        let mut conn = open_memory();
        run(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO libraries (path, name, added_at) VALUES ('/tmp/x', 'x', 0);\n\
             INSERT INTO files (library_id, rel_path, name, extension,\
                                size_bytes, mtime_ms, scanned_at, cache_key)\n\
             VALUES (1, 'a.stl', 'a.stl', 'stl', 0, 0, 0, 'k');",
        ).unwrap();
        conn.execute(
            "INSERT INTO mesh_metadata (file_id, computed_at, parse_error)\n\
             VALUES (1, 0, 'bad header')",
            [],
        ).unwrap();
    }
}
