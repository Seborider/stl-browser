use std::io::Cursor;

use crate::mesh::metrics::Tri;

pub fn parse(bytes: &[u8]) -> Result<Vec<Tri>, String> {
    let mut cursor = Cursor::new(bytes);
    let mesh = stl_io::read_stl(&mut cursor).map_err(|e| format!("stl: {e}"))?;

    let verts: Vec<[f64; 3]> = mesh
        .vertices
        .iter()
        .map(|v| [v[0] as f64, v[1] as f64, v[2] as f64])
        .collect();

    let mut out = Vec::with_capacity(mesh.faces.len());
    for face in &mesh.faces {
        let [i, j, k] = face.vertices;
        if i >= verts.len() || j >= verts.len() || k >= verts.len() {
            return Err("stl: face index out of bounds".into());
        }
        out.push([verts[i], verts[j], verts[k]]);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::metrics;

    // Builds a binary STL for a single triangle. Binary STL layout:
    //   80 bytes header, 4 bytes u32 triangle count,
    //   then per-triangle: 12 f32s (normal+3 verts) + u16 attr.
    fn binary_stl_single_triangle() -> Vec<u8> {
        let mut out = vec![0u8; 80];
        out.extend_from_slice(&1u32.to_le_bytes()); // triangle count
        // normal
        for _ in 0..3 { out.extend_from_slice(&0f32.to_le_bytes()); }
        // v0
        out.extend_from_slice(&0f32.to_le_bytes());
        out.extend_from_slice(&0f32.to_le_bytes());
        out.extend_from_slice(&0f32.to_le_bytes());
        // v1
        out.extend_from_slice(&1f32.to_le_bytes());
        out.extend_from_slice(&0f32.to_le_bytes());
        out.extend_from_slice(&0f32.to_le_bytes());
        // v2
        out.extend_from_slice(&0f32.to_le_bytes());
        out.extend_from_slice(&1f32.to_le_bytes());
        out.extend_from_slice(&0f32.to_le_bytes());
        // attr
        out.extend_from_slice(&0u16.to_le_bytes());
        out
    }

    #[test]
    fn parses_single_triangle_binary_stl() {
        let bytes = binary_stl_single_triangle();
        let tris = parse(&bytes).expect("parse failed");
        assert_eq!(tris.len(), 1);
        let m = metrics::compute(&tris);
        assert_eq!(m.triangle_count, 1);
        assert!((m.surface_area_mm2 - 0.5).abs() < 1e-6);
    }

    #[test]
    fn garbage_bytes_return_err() {
        let err = parse(b"not an stl file").unwrap_err();
        assert!(err.starts_with("stl: "));
    }
}
