use std::collections::HashMap;

use crate::db::mesh::MeshMetricsRow;

pub type Tri = [[f64; 3]; 3];

/// Accepts a slice of triangles (each three vertices in world-space mm) and
/// returns bbox, triangle count, surface area (always), and volume (only if
/// the mesh is edge-watertight — every canonical edge appears exactly twice).
pub fn compute(triangles: &[Tri]) -> MeshMetricsRow {
    let triangle_count = triangles.len() as i64;

    let mut bbox_min = [f64::INFINITY; 3];
    let mut bbox_max = [f64::NEG_INFINITY; 3];
    let mut area = 0.0f64;
    let mut signed_volume_sum = 0.0f64;

    // Edge -> count for watertight check. Canonical order (min,max) so
    // opposing half-edges share a bucket.
    let mut edges: HashMap<(u64, u64), u32> = HashMap::new();

    for tri in triangles {
        for v in tri {
            for i in 0..3 {
                if v[i] < bbox_min[i] { bbox_min[i] = v[i]; }
                if v[i] > bbox_max[i] { bbox_max[i] = v[i]; }
            }
        }
        let a = tri[0];
        let b = tri[1];
        let c = tri[2];

        // Area: 0.5 * |AB × AC|
        let ab = sub(b, a);
        let ac = sub(c, a);
        area += 0.5 * length(cross(ab, ac));

        // Signed volume (divergence theorem): a · (b × c) / 6
        signed_volume_sum += dot(a, cross(b, c)) / 6.0;

        // Quantize vertices so equal coords hash identically.
        let ka = quantize(a);
        let kb = quantize(b);
        let kc = quantize(c);
        for (p, q) in [(ka, kb), (kb, kc), (kc, ka)] {
            let e = if p <= q { (p, q) } else { (q, p) };
            *edges.entry(e).or_insert(0) += 1;
        }
    }

    if triangles.is_empty() {
        bbox_min = [0.0; 3];
        bbox_max = [0.0; 3];
    }

    let watertight = !edges.is_empty() && edges.values().all(|&c| c == 2);
    let volume_mm3 = if watertight { Some(signed_volume_sum.abs()) } else { None };

    MeshMetricsRow {
        bbox_min,
        bbox_max,
        triangle_count,
        surface_area_mm2: area,
        volume_mm3,
    }
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn length(v: [f64; 3]) -> f64 {
    (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt()
}

// 1e-5 mm quantization — tight enough for mesh-printer tolerances, loose
// enough to survive f32 precision in the source files.
fn quantize(p: [f64; 3]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for v in p {
        let q = (v * 100_000.0).round() as i64;
        h ^= q as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    // 12 triangles of a unit cube from (0,0,0) to (1,1,1) with outward normals.
    fn unit_cube() -> Vec<Tri> {
        let v = |x: f64, y: f64, z: f64| [x, y, z];
        let a = v(0.0, 0.0, 0.0);
        let b = v(1.0, 0.0, 0.0);
        let c = v(1.0, 1.0, 0.0);
        let d = v(0.0, 1.0, 0.0);
        let e = v(0.0, 0.0, 1.0);
        let f = v(1.0, 0.0, 1.0);
        let g = v(1.0, 1.0, 1.0);
        let h = v(0.0, 1.0, 1.0);
        vec![
            // bottom (z=0, outward -z): reversed winding
            [a, c, b], [a, d, c],
            // top (z=1, outward +z)
            [e, f, g], [e, g, h],
            // front (y=0, outward -y)
            [a, b, f], [a, f, e],
            // back (y=1, outward +y)
            [d, h, g], [d, g, c],
            // left (x=0, outward -x)
            [a, e, h], [a, h, d],
            // right (x=1, outward +x)
            [b, c, g], [b, g, f],
        ]
    }

    #[test]
    fn cube_metrics() {
        let m = compute(&unit_cube());
        assert_eq!(m.triangle_count, 12);
        assert_eq!(m.bbox_min, [0.0, 0.0, 0.0]);
        assert_eq!(m.bbox_max, [1.0, 1.0, 1.0]);
        assert!((m.surface_area_mm2 - 6.0).abs() < 1e-9);
        assert!(matches!(m.volume_mm3, Some(v) if (v - 1.0).abs() < 1e-9));
    }

    #[test]
    fn single_triangle_is_not_watertight() {
        let tri: Tri = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let m = compute(&[tri]);
        assert_eq!(m.triangle_count, 1);
        assert!((m.surface_area_mm2 - 0.5).abs() < 1e-9);
        assert!(m.volume_mm3.is_none());
    }

    #[test]
    fn empty_mesh_degenerates_gracefully() {
        let m = compute(&[]);
        assert_eq!(m.triangle_count, 0);
        assert_eq!(m.bbox_min, [0.0, 0.0, 0.0]);
        assert_eq!(m.bbox_max, [0.0, 0.0, 0.0]);
        assert_eq!(m.surface_area_mm2, 0.0);
        assert!(m.volume_mm3.is_none());
    }
}
