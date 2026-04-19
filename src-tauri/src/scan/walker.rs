use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use walkdir::WalkDir;

use crate::db::files::FileRow;

/// Invoked by the walker when a file is found. Callers use it to buffer +
/// batch-flush into SQLite. Returns `true` to continue, `false` to stop.
/// Errors from the callback are propagated back out.
pub type OnFile<'a> = dyn FnMut(FileRow) -> std::io::Result<()> + 'a;

pub fn walk(library_id: i64, library_path: &Path, on_file: &mut OnFile<'_>) -> std::io::Result<u64> {
    let lib_str = library_path.to_string_lossy().to_string();
    let mut count = 0u64;
    for entry in WalkDir::new(library_path).follow_links(true) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue, // skip permission errors, broken symlinks
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let ext_lower = match entry.path().extension() {
            Some(e) => e.to_string_lossy().to_ascii_lowercase(),
            None => continue,
        };
        if !matches!(ext_lower.as_str(), "stl" | "3mf" | "obj") {
            continue;
        }

        let md = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let size = md.len() as i64;
        let mtime_ms = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let abs_str = entry.path().to_string_lossy().to_string();
        let cache_key = compute_cache_key(&abs_str, mtime_ms, size);

        let rel = entry
            .path()
            .strip_prefix(library_path)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| abs_str.clone());
        let name = entry
            .path()
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| rel.clone());

        let scanned_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let row = FileRow {
            library_id,
            rel_path: rel,
            name,
            extension: ext_lower,
            size_bytes: size,
            mtime_ms,
            scanned_at,
            cache_key,
        };
        on_file(row)?;
        count += 1;
        let _ = &lib_str; // keep the variable for symmetry; tree-walking doesn't need it again
    }
    Ok(count)
}

pub fn compute_cache_key(abs_path: &str, mtime_ms: i64, size_bytes: i64) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(abs_path.as_bytes());
    hasher.update(&mtime_ms.to_le_bytes());
    hasher.update(&size_bytes.to_le_bytes());
    hasher.finalize().to_hex().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::PathBuf;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(name: &str) -> Self {
            let mut path = std::env::temp_dir();
            path.push(format!(
                "phase3-walker-{}-{}-{}",
                name,
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }
        fn path(&self) -> &Path { &self.0 }
    }
    impl Drop for TempDir {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    fn touch(dir: &Path, rel: &str, bytes: &[u8]) {
        let p = dir.join(rel);
        if let Some(parent) = p.parent() { fs::create_dir_all(parent).unwrap(); }
        let mut f = File::create(&p).unwrap();
        f.write_all(bytes).unwrap();
    }

    #[test]
    fn walker_filters_by_extension_case_insensitively() {
        let tmp = TempDir::new("ext");
        touch(tmp.path(), "a.stl", b"stl");
        touch(tmp.path(), "sub/B.STL", b"stl");
        touch(tmp.path(), "sub/c.obj", b"obj");
        touch(tmp.path(), "sub/d.3MF", b"3mf");
        touch(tmp.path(), "ignore.txt", b"txt");

        let mut rows: Vec<FileRow> = Vec::new();
        let count = walk(1, tmp.path(), &mut |row| {
            rows.push(row);
            Ok(())
        })
        .unwrap();
        assert_eq!(count, 4);
        assert_eq!(rows.len(), 4);

        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert!(names.contains(&"a.stl"));
        assert!(names.contains(&"B.STL"));
        assert!(names.contains(&"c.obj"));
        assert!(names.contains(&"d.3MF"));

        // extension is always lowercase
        for r in &rows {
            assert!(matches!(r.extension.as_str(), "stl" | "obj" | "3mf"));
        }
    }

    #[test]
    fn cache_key_is_deterministic() {
        let k1 = compute_cache_key("/x/a.stl", 42, 1000);
        let k2 = compute_cache_key("/x/a.stl", 42, 1000);
        assert_eq!(k1, k2);
        let k3 = compute_cache_key("/x/a.stl", 43, 1000);
        assert_ne!(k1, k3);
    }
}
