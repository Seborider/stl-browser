use std::fs;

use crate::db::mesh::MeshMetricsRow;

pub mod metrics;
pub mod obj;
pub mod stl;
pub mod threemf;

/// Read a file and parse its mesh. Caller provides extension (lowercase).
/// Returns metrics on success, `Err(String)` on any failure; the string is
/// stored in `mesh_metadata.parse_error` so we never retry a broken file.
pub fn parse_file(abs_path: &str, extension: &str) -> Result<MeshMetricsRow, String> {
    let bytes = fs::read(abs_path).map_err(|e| format!("io: {e}"))?;
    let triangles = match extension {
        "stl" => stl::parse(&bytes)?,
        "obj" => obj::parse(&bytes)?,
        "3mf" => threemf::parse(&bytes)?,
        other => return Err(format!("unsupported extension: {other}")),
    };
    Ok(metrics::compute(&triangles))
}
