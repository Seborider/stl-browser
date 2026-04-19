use rusqlite::{params, Connection};

use crate::error::IpcError;
use crate::types::MeshMetadata;

/// Result of parsing a mesh (geometric data) or a parse failure string.
/// Pass `Ok(metrics)` or `Err(msg)` into `upsert_metadata`.
pub struct MeshMetricsRow {
    pub bbox_min: [f64; 3],
    pub bbox_max: [f64; 3],
    pub triangle_count: i64,
    pub surface_area_mm2: f64,
    pub volume_mm3: Option<f64>,
}

pub fn upsert_metadata(
    conn: &Connection,
    file_id: i64,
    outcome: Result<MeshMetricsRow, String>,
    computed_at: i64,
) -> Result<MeshMetadata, IpcError> {
    match outcome {
        Ok(m) => {
            conn.execute(
                "INSERT INTO mesh_metadata (\n\
                   file_id,\n\
                   bbox_min_x, bbox_min_y, bbox_min_z,\n\
                   bbox_max_x, bbox_max_y, bbox_max_z,\n\
                   triangle_count, surface_area_mm2, volume_mm3,\n\
                   computed_at, parse_error\n\
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,NULL)\n\
                 ON CONFLICT(file_id) DO UPDATE SET\n\
                   bbox_min_x=excluded.bbox_min_x, bbox_min_y=excluded.bbox_min_y, bbox_min_z=excluded.bbox_min_z,\n\
                   bbox_max_x=excluded.bbox_max_x, bbox_max_y=excluded.bbox_max_y, bbox_max_z=excluded.bbox_max_z,\n\
                   triangle_count=excluded.triangle_count,\n\
                   surface_area_mm2=excluded.surface_area_mm2,\n\
                   volume_mm3=excluded.volume_mm3,\n\
                   computed_at=excluded.computed_at,\n\
                   parse_error=NULL",
                params![
                    file_id,
                    m.bbox_min[0], m.bbox_min[1], m.bbox_min[2],
                    m.bbox_max[0], m.bbox_max[1], m.bbox_max[2],
                    m.triangle_count,
                    m.surface_area_mm2,
                    m.volume_mm3,
                    computed_at,
                ],
            )?;
            Ok(MeshMetadata {
                bbox_min: Some(m.bbox_min),
                bbox_max: Some(m.bbox_max),
                triangle_count: Some(m.triangle_count),
                surface_area_mm2: Some(m.surface_area_mm2),
                volume_mm3: m.volume_mm3,
                computed_at,
                parse_error: None,
            })
        }
        Err(msg) => {
            conn.execute(
                "INSERT INTO mesh_metadata (file_id, computed_at, parse_error)\n\
                 VALUES (?1, ?2, ?3)\n\
                 ON CONFLICT(file_id) DO UPDATE SET\n\
                   bbox_min_x=NULL, bbox_min_y=NULL, bbox_min_z=NULL,\n\
                   bbox_max_x=NULL, bbox_max_y=NULL, bbox_max_z=NULL,\n\
                   triangle_count=NULL, surface_area_mm2=NULL, volume_mm3=NULL,\n\
                   computed_at=excluded.computed_at, parse_error=excluded.parse_error",
                params![file_id, computed_at, msg],
            )?;
            Ok(MeshMetadata {
                bbox_min: None,
                bbox_max: None,
                triangle_count: None,
                surface_area_mm2: None,
                volume_mm3: None,
                computed_at,
                parse_error: Some(msg),
            })
        }
    }
}

pub fn get_for_file(conn: &Connection, file_id: i64) -> Result<Option<MeshMetadata>, IpcError> {
    let res = conn.query_row(
        "SELECT bbox_min_x, bbox_min_y, bbox_min_z,\n\
                bbox_max_x, bbox_max_y, bbox_max_z,\n\
                triangle_count, surface_area_mm2, volume_mm3,\n\
                computed_at, parse_error\n\
         FROM mesh_metadata WHERE file_id = ?1",
        params![file_id],
        |row| {
            let min_x: Option<f64> = row.get(0)?;
            let min_y: Option<f64> = row.get(1)?;
            let min_z: Option<f64> = row.get(2)?;
            let max_x: Option<f64> = row.get(3)?;
            let max_y: Option<f64> = row.get(4)?;
            let max_z: Option<f64> = row.get(5)?;
            let bbox_min = match (min_x, min_y, min_z) {
                (Some(x), Some(y), Some(z)) => Some([x, y, z]),
                _ => None,
            };
            let bbox_max = match (max_x, max_y, max_z) {
                (Some(x), Some(y), Some(z)) => Some([x, y, z]),
                _ => None,
            };
            Ok(MeshMetadata {
                bbox_min,
                bbox_max,
                triangle_count: row.get(6)?,
                surface_area_mm2: row.get(7)?,
                volume_mm3: row.get(8)?,
                computed_at: row.get(9)?,
                parse_error: row.get(10)?,
            })
        },
    );
    match res {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use crate::db::files::{insert_files_batch, FileRow};

    fn setup() -> (Connection, i64) {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrations::run(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO libraries (path, name, added_at) VALUES ('/tmp/lib', 'lib', 0)",
            [],
        )
        .unwrap();
        let inserted = insert_files_batch(
            &conn,
            &[FileRow {
                library_id: 1,
                rel_path: "a.stl".into(),
                name: "a.stl".into(),
                extension: "stl".into(),
                size_bytes: 1,
                mtime_ms: 1,
                scanned_at: 1,
                cache_key: "k".into(),
            }],
        )
        .unwrap();
        (conn, inserted[0].id)
    }

    #[test]
    fn upsert_success_then_read_back() {
        let (conn, file_id) = setup();
        let metrics = MeshMetricsRow {
            bbox_min: [0.0, 0.0, 0.0],
            bbox_max: [1.0, 2.0, 3.0],
            triangle_count: 12,
            surface_area_mm2: 6.0,
            volume_mm3: Some(6.0),
        };
        let m = upsert_metadata(&conn, file_id, Ok(metrics), 999).unwrap();
        assert_eq!(m.bbox_max, Some([1.0, 2.0, 3.0]));
        assert_eq!(m.triangle_count, Some(12));
        assert!(m.parse_error.is_none());

        let round = get_for_file(&conn, file_id).unwrap().unwrap();
        assert_eq!(round.bbox_max, Some([1.0, 2.0, 3.0]));
        assert_eq!(round.volume_mm3, Some(6.0));
    }

    #[test]
    fn upsert_error_stores_parse_error_only() {
        let (conn, file_id) = setup();
        let m = upsert_metadata(&conn, file_id, Err("bad bytes".into()), 777).unwrap();
        assert!(m.bbox_min.is_none());
        assert_eq!(m.parse_error.as_deref(), Some("bad bytes"));

        let round = get_for_file(&conn, file_id).unwrap().unwrap();
        assert_eq!(round.parse_error.as_deref(), Some("bad bytes"));
    }

    #[test]
    fn upsert_replaces_existing() {
        let (conn, file_id) = setup();
        upsert_metadata(&conn, file_id, Err("first".into()), 1).unwrap();
        let metrics = MeshMetricsRow {
            bbox_min: [-1.0, -1.0, -1.0],
            bbox_max: [1.0, 1.0, 1.0],
            triangle_count: 4,
            surface_area_mm2: 2.0,
            volume_mm3: None,
        };
        upsert_metadata(&conn, file_id, Ok(metrics), 2).unwrap();
        let round = get_for_file(&conn, file_id).unwrap().unwrap();
        assert!(round.parse_error.is_none());
        assert_eq!(round.triangle_count, Some(4));
    }

    #[test]
    fn get_for_file_returns_none_when_missing() {
        let (conn, _) = setup();
        assert!(get_for_file(&conn, 9999).unwrap().is_none());
    }
}
