use std::collections::HashMap;

use rusqlite::{params, Connection, ToSql};

use crate::error::IpcError;
use crate::types::{FileEntry, FileQuery, SortDirection, SortKey};

// FileRow is the pre-DB shape the scanner emits: everything we know about a
// file before it has an `id`. insert_files_batch turns these into FileEntry
// rows.
#[derive(Debug, Clone)]
pub struct FileRow {
    pub library_id: i64,
    pub rel_path: String,
    pub name: String,
    pub extension: String,
    pub size_bytes: i64,
    pub mtime_ms: i64,
    pub scanned_at: i64,
    pub cache_key: String,
}

// NeedsMetadata is the per-file shape mesh parsing needs to locate the bytes.
pub struct NeedsMetadata {
    pub id: i64,
    pub abs_path: String, // library.path + "/" + rel_path
    pub extension: String,
}

// Slim view of a file row used by the watcher diff classifier.
#[derive(Debug, Clone, PartialEq)]
pub struct ExistingFile {
    pub id: i64,
    pub cache_key: String,
}

pub fn insert_files_batch(
    conn: &Connection,
    rows: &[FileRow],
) -> Result<Vec<FileEntry>, IpcError> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let tx = conn.unchecked_transaction()?;
    let mut inserted_keys: Vec<(i64, String)> = Vec::new();
    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO files\n\
             (library_id, rel_path, name, extension, size_bytes, mtime_ms, scanned_at, cache_key)\n\
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        for row in rows {
            let changed = stmt.execute(params![
                row.library_id,
                row.rel_path,
                row.name,
                row.extension,
                row.size_bytes,
                row.mtime_ms,
                row.scanned_at,
                row.cache_key,
            ])?;
            if changed == 1 {
                inserted_keys.push((row.library_id, row.cache_key.clone()));
            }
        }
    }
    tx.commit()?;

    let mut out = Vec::with_capacity(inserted_keys.len());
    for (library_id, cache_key) in inserted_keys {
        let entry: FileEntry = conn.query_row(
            "SELECT id, library_id, rel_path, name, extension, size_bytes, mtime_ms, cache_key\n\
             FROM files WHERE library_id = ?1 AND cache_key = ?2",
            params![library_id, cache_key],
            |row| Ok(FileEntry {
                id: row.get(0)?,
                library_id: row.get(1)?,
                rel_path: row.get(2)?,
                name: row.get(3)?,
                extension: row.get(4)?,
                size_bytes: row.get(5)?,
                mtime_ms: row.get(6)?,
                cache_key: row.get(7)?,
            }),
        )?;
        out.push(entry);
    }
    Ok(out)
}

pub fn list_files(conn: &Connection, query: &FileQuery) -> Result<Vec<FileEntry>, IpcError> {
    let order = match (query.sort.key, query.sort.direction) {
        (SortKey::Name,   SortDirection::Asc)  => "name COLLATE NOCASE ASC",
        (SortKey::Name,   SortDirection::Desc) => "name COLLATE NOCASE DESC",
        (SortKey::Size,   SortDirection::Asc)  => "size_bytes ASC",
        (SortKey::Size,   SortDirection::Desc) => "size_bytes DESC",
        (SortKey::Mtime,  SortDirection::Asc)  => "mtime_ms ASC",
        (SortKey::Mtime,  SortDirection::Desc) => "mtime_ms DESC",
        (SortKey::Format, SortDirection::Asc)  => "extension ASC, name COLLATE NOCASE ASC",
        (SortKey::Format, SortDirection::Desc) => "extension DESC, name COLLATE NOCASE DESC",
    };

    let mut sql = String::from(
        "SELECT id, library_id, rel_path, name, extension, size_bytes, mtime_ms, cache_key \
         FROM files WHERE 1=1",
    );
    let mut args: Vec<Box<dyn ToSql>> = Vec::new();
    if let Some(lib) = query.library_id {
        sql.push_str(" AND library_id = ?");
        args.push(Box::new(lib));
    }
    if !query.search.trim().is_empty() {
        sql.push_str(" AND name LIKE ? COLLATE NOCASE");
        args.push(Box::new(format!("%{}%", query.search.trim())));
    }
    sql.push_str(" ORDER BY ");
    sql.push_str(order);

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let rows: rusqlite::Result<Vec<FileEntry>> = stmt
        .query_map(rusqlite::params_from_iter(param_refs.iter()), |row| {
            Ok(FileEntry {
                id: row.get(0)?,
                library_id: row.get(1)?,
                rel_path: row.get(2)?,
                name: row.get(3)?,
                extension: row.get(4)?,
                size_bytes: row.get(5)?,
                mtime_ms: row.get(6)?,
                cache_key: row.get(7)?,
            })
        })?
        .collect();
    Ok(rows?)
}

pub fn get_by_id(conn: &Connection, id: i64) -> Result<FileEntry, IpcError> {
    conn.query_row(
        "SELECT id, library_id, rel_path, name, extension, size_bytes, mtime_ms, cache_key\n\
         FROM files WHERE id = ?1",
        params![id],
        |row| Ok(FileEntry {
            id: row.get(0)?,
            library_id: row.get(1)?,
            rel_path: row.get(2)?,
            name: row.get(3)?,
            extension: row.get(4)?,
            size_bytes: row.get(5)?,
            mtime_ms: row.get(6)?,
            cache_key: row.get(7)?,
        }),
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => IpcError::NotFound(format!("file id {id}")),
        other => other.into(),
    })
}

/// Look up the existing (id, cache_key) for a set of rel_paths in one library.
/// Used by the watcher to diff a debounced batch against current DB state.
pub fn list_by_rel_paths(
    conn: &Connection,
    library_id: i64,
    rel_paths: &[String],
) -> Result<HashMap<String, ExistingFile>, IpcError> {
    let mut out: HashMap<String, ExistingFile> = HashMap::new();
    if rel_paths.is_empty() {
        return Ok(out);
    }
    let placeholders = vec!["?"; rel_paths.len()].join(",");
    let sql = format!(
        "SELECT id, rel_path, cache_key FROM files\n\
         WHERE library_id = ? AND rel_path IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut args: Vec<Box<dyn ToSql>> = Vec::with_capacity(rel_paths.len() + 1);
    args.push(Box::new(library_id));
    for r in rel_paths {
        args.push(Box::new(r.clone()));
    }
    let param_refs: Vec<&dyn ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let mut rows = stmt.query(rusqlite::params_from_iter(param_refs.iter()))?;
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let rel: String = row.get(1)?;
        let cache_key: String = row.get(2)?;
        out.insert(rel, ExistingFile { id, cache_key });
    }
    Ok(out)
}

/// Delete a set of files by id. CASCADE removes the dependent mesh_metadata.
pub fn delete_by_ids(conn: &Connection, ids: &[i64]) -> Result<usize, IpcError> {
    if ids.is_empty() {
        return Ok(0);
    }
    let tx = conn.unchecked_transaction()?;
    let mut total = 0usize;
    {
        let mut stmt = tx.prepare("DELETE FROM files WHERE id = ?1")?;
        for id in ids {
            total += stmt.execute(params![id])?;
        }
    }
    tx.commit()?;
    Ok(total)
}

/// Apply a content change to a known file row: new cache_key / mtime / size
/// (rel_path and name are expected to be unchanged for an in-place modify).
/// Returns the refreshed FileEntry so the caller can emit it.
pub fn update_file_row(
    conn: &Connection,
    id: i64,
    row: &FileRow,
) -> Result<FileEntry, IpcError> {
    conn.execute(
        "UPDATE files SET\n\
           rel_path = ?2, name = ?3, extension = ?4,\n\
           size_bytes = ?5, mtime_ms = ?6, scanned_at = ?7, cache_key = ?8\n\
         WHERE id = ?1",
        params![
            id,
            row.rel_path,
            row.name,
            row.extension,
            row.size_bytes,
            row.mtime_ms,
            row.scanned_at,
            row.cache_key,
        ],
    )?;
    get_by_id(conn, id)
}

pub fn list_needing_metadata(
    conn: &Connection,
    library_id: i64,
) -> Result<Vec<NeedsMetadata>, IpcError> {
    // Retry files with a cached parse_error: once a parser is fixed, a rescan
    // should recover them. Only rows with successful metadata (parse_error IS NULL)
    // are considered done.
    let mut stmt = conn.prepare(
        "SELECT f.id, l.path, f.rel_path, f.extension\n\
         FROM files f\n\
         JOIN libraries l ON l.id = f.library_id\n\
         WHERE f.library_id = ?1\n\
           AND f.id NOT IN (SELECT file_id FROM mesh_metadata WHERE parse_error IS NULL)",
    )?;
    let rows: rusqlite::Result<Vec<NeedsMetadata>> = stmt
        .query_map(params![library_id], |row| {
            let lib_path: String = row.get(1)?;
            let rel: String = row.get(2)?;
            Ok(NeedsMetadata {
                id: row.get(0)?,
                abs_path: format!("{}/{}", lib_path.trim_end_matches('/'), rel),
                extension: row.get(3)?,
            })
        })?
        .collect();
    Ok(rows?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use crate::types::{Sort, SortDirection, SortKey};

    fn setup() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrations::run(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO libraries (path, name, added_at) VALUES (?1, ?2, ?3)",
            params!["/tmp/lib", "lib", 0i64],
        )
        .unwrap();
        conn
    }

    fn row(name: &str, ext: &str, size: i64, cache_key: &str) -> FileRow {
        FileRow {
            library_id: 1,
            rel_path: format!("sub/{name}.{ext}"),
            name: format!("{name}.{ext}"),
            extension: ext.to_string(),
            size_bytes: size,
            mtime_ms: 123,
            scanned_at: 456,
            cache_key: cache_key.to_string(),
        }
    }

    fn q(library_id: Option<i64>, key: SortKey, search: &str) -> FileQuery {
        FileQuery {
            library_id,
            sort: Sort { key, direction: SortDirection::Asc },
            search: search.to_string(),
        }
    }

    #[test]
    fn batch_insert_returns_new_rows_only() {
        let conn = setup();
        let rows = vec![
            row("a", "stl", 10, "ka"),
            row("b", "obj", 20, "kb"),
        ];
        let first = insert_files_batch(&conn, &rows).unwrap();
        assert_eq!(first.len(), 2);
        assert!(first[0].id > 0);

        let second = insert_files_batch(&conn, &rows).unwrap();
        assert_eq!(second.len(), 0);
    }

    #[test]
    fn list_filters_by_library_and_search_and_sort() {
        let conn = setup();
        insert_files_batch(
            &conn,
            &[
                row("Apple", "stl", 30, "k1"),
                row("banana", "obj", 10, "k2"),
                row("cherry", "3mf", 20, "k3"),
            ],
        )
        .unwrap();

        assert_eq!(list_files(&conn, &q(Some(1), SortKey::Name, "")).unwrap().len(), 3);
        assert_eq!(list_files(&conn, &q(Some(999), SortKey::Name, "")).unwrap().len(), 0);

        let r = list_files(&conn, &q(Some(1), SortKey::Name, "APP")).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].name, "Apple.stl");

        let r = list_files(&conn, &q(Some(1), SortKey::Size, "")).unwrap();
        let order: Vec<&str> = r.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(order, vec!["banana.obj", "cherry.3mf", "Apple.stl"]);
    }

    #[test]
    fn list_by_rel_paths_maps_existing_only() {
        let conn = setup();
        let inserted = insert_files_batch(
            &conn,
            &[row("a", "stl", 10, "ka"), row("b", "obj", 20, "kb")],
        )
        .unwrap();
        let map = list_by_rel_paths(
            &conn,
            1,
            &vec![
                inserted[0].rel_path.clone(),
                inserted[1].rel_path.clone(),
                "missing/x.stl".to_string(),
            ],
        )
        .unwrap();
        assert_eq!(map.len(), 2);
        assert_eq!(map[&inserted[0].rel_path].cache_key, "ka");
        assert_eq!(map[&inserted[1].rel_path].id, inserted[1].id);
    }

    #[test]
    fn delete_by_ids_cascades_and_counts() {
        let conn = setup();
        let inserted = insert_files_batch(
            &conn,
            &[row("a", "stl", 10, "ka"), row("b", "obj", 20, "kb")],
        )
        .unwrap();
        let n = delete_by_ids(&conn, &vec![inserted[0].id, 999_999]).unwrap();
        assert_eq!(n, 1);
        let still = list_files(&conn, &q(Some(1), SortKey::Name, "")).unwrap();
        assert_eq!(still.len(), 1);
        assert_eq!(still[0].id, inserted[1].id);
    }

    #[test]
    fn update_file_row_replaces_cache_key_and_returns_entry() {
        let conn = setup();
        let inserted = insert_files_batch(&conn, &[row("a", "stl", 10, "ka")]).unwrap();
        let original = &inserted[0];

        let mut new_row = row("a", "stl", 42, "ka_new");
        new_row.mtime_ms = 999;
        let refreshed = update_file_row(&conn, original.id, &new_row).unwrap();
        assert_eq!(refreshed.id, original.id);
        assert_eq!(refreshed.cache_key, "ka_new");
        assert_eq!(refreshed.size_bytes, 42);
        assert_eq!(refreshed.mtime_ms, 999);
    }

    #[test]
    fn list_needing_metadata_skips_success_rows_but_retries_errors() {
        let conn = setup();
        let inserted = insert_files_batch(
            &conn,
            &[
                row("a", "stl", 10, "ka"), // success -> skipped
                row("b", "stl", 20, "kb"), // parse error -> retried
                row("c", "stl", 30, "kc"), // no row yet -> included
            ],
        )
        .unwrap();
        // Bbox columns required by the CHECK constraint on success rows.
        conn.execute(
            "INSERT INTO mesh_metadata (\n\
               file_id, bbox_min_x, bbox_min_y, bbox_min_z,\n\
               bbox_max_x, bbox_max_y, bbox_max_z,\n\
               triangle_count, surface_area_mm2, computed_at\n\
             ) VALUES (?1, 0,0,0, 1,1,1, 1, 1.0, 0)",
            params![inserted[0].id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO mesh_metadata (file_id, computed_at, parse_error) VALUES (?1, 0, 'x')",
            params![inserted[1].id],
        )
        .unwrap();

        let mut pending = list_needing_metadata(&conn, 1).unwrap();
        pending.sort_by_key(|p| p.id);
        let ids: Vec<i64> = pending.iter().map(|p| p.id).collect();
        assert_eq!(ids, vec![inserted[1].id, inserted[2].id]);
    }
}
