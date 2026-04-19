use std::io::{Cursor, Read};

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

use crate::mesh::metrics::Tri;

/// 3MF models can theoretically be huge; cap each XML entry at 256 MiB so a
/// zipbomb (high-deflate-ratio payload) can't OOM the parse worker.
const MAX_MODEL_BYTES: u64 = 256 * 1024 * 1024;

/// Parses a 3MF (ZIP of `.model` XML files) into a flat list of triangles.
///
/// We don't use the `threemf` crate: slicer exports (Bambu Studio, PrusaSlicer,
/// OrcaSlicer) embed extension namespaces and use the 3MF Production extension,
/// which stores geometry in auxiliary `.model` files referenced by path. The
/// crate's strict serde parser fails on both. This implementation walks every
/// `.model` entry and merges triangles from any `<mesh>` it finds.
pub fn parse(bytes: &[u8]) -> Result<Vec<Tri>, String> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("3mf: zip: {e}"))?;

    let model_names: Vec<String> = archive
        .file_names()
        .filter(|n| n.to_ascii_lowercase().ends_with(".model"))
        .map(str::to_string)
        .collect();
    if model_names.is_empty() {
        return Err("3mf: no *.model entries".into());
    }

    let mut all_tris: Vec<Tri> = Vec::new();
    let mut xml = String::new();
    for name in &model_names {
        xml.clear();
        archive
            .by_name(name)
            .map_err(|e| format!("3mf: open {name}: {e}"))?
            .take(MAX_MODEL_BYTES)
            .read_to_string(&mut xml)
            .map_err(|e| format!("3mf: read {name}: {e}"))?;
        all_tris.extend(parse_model_xml(&xml)?);
    }

    if all_tris.is_empty() {
        return Err("3mf: no triangles found".into());
    }
    Ok(all_tris)
}

enum Ctx {
    Outside,
    Mesh,
    Vertices,
    Triangles,
}

/// Returns whatever triangles this `.model` file contains; returns `Ok(empty)`
/// if the file has no `<mesh>` (e.g. a root model that only wires components).
/// Errs only on malformed XML or a truly broken mesh.
fn parse_model_xml(xml: &str) -> Result<Vec<Tri>, String> {
    let mut reader = Reader::from_str(xml);
    reader.trim_text(true);

    let mut tris: Vec<Tri> = Vec::new();
    let mut verts: Vec<[f64; 3]> = Vec::new();
    let mut ctx = Ctx::Outside;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Err(e) => return Err(format!("3mf: xml: {e}")),
            Ok(Event::Eof) => break,
            Ok(Event::Start(e)) => {
                let qname = e.name();
                match (&ctx, qname.local_name().as_ref()) {
                    (Ctx::Outside, b"mesh") => {
                        ctx = Ctx::Mesh;
                        verts.clear();
                    }
                    (Ctx::Mesh, b"vertices") => ctx = Ctx::Vertices,
                    (Ctx::Mesh, b"triangles") => ctx = Ctx::Triangles,
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let qname = e.name();
                match (&ctx, qname.local_name().as_ref()) {
                    (Ctx::Mesh, b"mesh") => {
                        ctx = Ctx::Outside;
                        verts.clear();
                    }
                    (Ctx::Vertices, b"vertices") | (Ctx::Triangles, b"triangles") => {
                        ctx = Ctx::Mesh;
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                let qname = e.name();
                match (&ctx, qname.local_name().as_ref()) {
                    (Ctx::Vertices, b"vertex") => {
                        let [x, y, z] =
                            read_three_attrs::<f64>(&e, [b"x", b"y", b"z"], "vertex")?;
                        verts.push([x, y, z]);
                    }
                    (Ctx::Triangles, b"triangle") => {
                        let [i, j, k] =
                            read_three_attrs::<usize>(&e, [b"v1", b"v2", b"v3"], "triangle")?;
                        if i >= verts.len() || j >= verts.len() || k >= verts.len() {
                            return Err("3mf: face index out of bounds".into());
                        }
                        tris.push([verts[i], verts[j], verts[k]]);
                    }
                    _ => {}
                }
            }
            _ => {}
        }
        buf.clear();
    }

    Ok(tris)
}

/// Pulls three named attributes off a tag and parses each into `T`. Matches the
/// key first so we only unescape attributes we actually care about.
fn read_three_attrs<T: std::str::FromStr>(
    e: &BytesStart,
    keys: [&[u8]; 3],
    label: &str,
) -> Result<[T; 3], String> {
    let mut out: [Option<T>; 3] = [None, None, None];
    for attr in e.attributes() {
        let attr = attr.map_err(|e| format!("3mf: attr: {e}"))?;
        let local = attr.key.local_name();
        for (idx, key) in keys.iter().enumerate() {
            if local.as_ref() == *key {
                let val = attr
                    .unescape_value()
                    .map_err(|e| format!("3mf: attr: {e}"))?;
                out[idx] = val.parse::<T>().ok();
                break;
            }
        }
    }
    match out {
        [Some(a), Some(b), Some(c)] => Ok([a, b, c]),
        _ => Err(format!("3mf: {label} missing attributes")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::FileOptions;
    use zip::ZipWriter;

    fn make_3mf(model_xml: &str) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut zw = ZipWriter::new(Cursor::new(&mut buf));
            zw.start_file("3D/3dmodel.model", FileOptions::default())
                .unwrap();
            zw.write_all(model_xml.as_bytes()).unwrap();
            zw.finish().unwrap();
        }
        buf
    }

    #[test]
    fn parses_minimal_triangle() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="1" y="0" z="0"/>
          <vertex x="0" y="1" z="0"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2"/>
        </triangles>
      </mesh>
    </object>
  </resources>
  <build><item objectid="1"/></build>
</model>"#;
        let tris = parse(&make_3mf(xml)).expect("parse failed");
        assert_eq!(tris.len(), 1);
    }

    #[test]
    fn tolerates_trailing_metadata_and_components() {
        // Mirrors Bambu Studio's layout: mesh object + components wrapper +
        // trailing <metadata> elements after </resources>.
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
       xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
       xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="1" y="0" z="0"/>
          <vertex x="0" y="1" z="0"/>
          <vertex x="0" y="0" z="1"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2"/>
          <triangle v1="0" v2="1" v3="3"/>
        </triangles>
      </mesh>
    </object>
    <object id="2" type="model">
      <components>
        <component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
      </components>
    </object>
  </resources>
  <build>
    <item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 0" printable="1"/>
  </build>
  <metadata name="CopyRight"/>
  <metadata name="ProfileUserId">1101093572</metadata>
</model>"#;
        let tris = parse(&make_3mf(xml)).expect("parse failed");
        assert_eq!(tris.len(), 2);
    }

    #[test]
    fn empty_mesh_errors() {
        let xml = r#"<?xml version="1.0"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources/>
  <build/>
</model>"#;
        let err = parse(&make_3mf(xml)).unwrap_err();
        assert!(err.starts_with("3mf: "));
    }

    #[test]
    fn garbage_bytes_return_err() {
        let err = parse(b"\x00\x01\x02garbage").unwrap_err();
        assert!(err.starts_with("3mf: "));
    }

    #[test]
    fn malformed_xml_propagates() {
        // Guards against the prior `if let Ok(..)` that swallowed real errors.
        // Mismatched end tag triggers quick-xml's check_end_names (on by default).
        let err = parse(&make_3mf("<model><a></b></model>")).unwrap_err();
        assert!(err.starts_with("3mf: xml:"), "got: {err}");
    }

    /// Run with `PROBE_3MF=/path/to/file.3mf cargo test --lib probes_real_file -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn probes_real_file() {
        let path = std::env::var("PROBE_3MF").expect("set PROBE_3MF=<path>");
        let bytes = std::fs::read(&path).expect("read failed");
        let tris = parse(&bytes).expect("parse failed");
        eprintln!("{}: {} triangles", path, tris.len());
        assert!(!tris.is_empty());
    }
}
