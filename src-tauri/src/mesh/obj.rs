use std::io::Cursor;

use crate::mesh::metrics::Tri;

pub fn parse(bytes: &[u8]) -> Result<Vec<Tri>, String> {
    // tobj's load_obj_buf takes a material loader. We always reject MTLs —
    // this app only cares about geometry.
    let (models, _materials) = tobj::load_obj_buf(
        &mut Cursor::new(bytes),
        &tobj::LoadOptions {
            triangulate: true,
            single_index: true,
            ..Default::default()
        },
        |_| Err(tobj::LoadError::GenericFailure),
    )
    .map_err(|e| format!("obj: {e}"))?;

    let mut out = Vec::new();
    for model in &models {
        let pos = &model.mesh.positions; // flat [x0,y0,z0,x1,...]
        let idx = &model.mesh.indices;
        if idx.len() % 3 != 0 {
            return Err("obj: non-triangulated face".into());
        }
        for tri in idx.chunks_exact(3) {
            let mut verts = [[0.0f64; 3]; 3];
            for (k, &i) in tri.iter().enumerate() {
                let i = i as usize;
                let base = i.checked_mul(3).ok_or("obj: index overflow")?;
                if base + 2 >= pos.len() {
                    return Err("obj: index out of bounds".into());
                }
                verts[k] = [pos[base] as f64, pos[base + 1] as f64, pos[base + 2] as f64];
            }
            out.push(verts);
        }
    }
    if out.is_empty() {
        return Err("obj: no geometry found".into());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::metrics;

    #[test]
    fn parses_minimal_triangle_obj() {
        let bytes = b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
        let tris = parse(bytes).expect("parse failed");
        assert_eq!(tris.len(), 1);
        let m = metrics::compute(&tris);
        assert!((m.surface_area_mm2 - 0.5).abs() < 1e-6);
    }

    #[test]
    fn parses_quad_via_triangulation() {
        let bytes =
            b"v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n";
        let tris = parse(bytes).expect("parse failed");
        assert_eq!(tris.len(), 2);
        let m = metrics::compute(&tris);
        assert!((m.surface_area_mm2 - 1.0).abs() < 1e-6);
    }

    #[test]
    fn garbage_bytes_return_err() {
        let err = parse(b"\x00\x01\x02garbage").unwrap_err();
        assert!(err.starts_with("obj: "));
    }
}
