use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::IpcError;

// Thumbnail PNGs are keyed by blake3(abs_path + mtime_ms + size_bytes).
// Layout: `<app_data>/thumbnails/<cache_key>.png` — see PLAN.md §4.
// Keyed by cache_key (not file_id) so identical files across libraries share
// one PNG on disk.

pub fn thumb_cache_dir(app_data: &Path) -> PathBuf {
    app_data.join("thumbnails")
}

/// Reject anything that isn't a-z / 0-9. blake3 hex output is 64 chars of
/// [0-9a-f]; `cache_key` arrives from the untrusted renderer via raw-body IPC
/// so this is the boundary where we make sure we can't be tricked into writing
/// outside the cache dir (e.g. `../something.png`).
pub fn is_valid_cache_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 128
        && key.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// Write `bytes` to `<cache_dir>/<cache_key>.png` atomically via a tempfile +
/// rename. The rename is atomic within the same filesystem, which this always
/// is (both paths live in the cache dir).
pub fn write_png_atomic(
    app_data: &Path,
    cache_key: &str,
    bytes: &[u8],
) -> Result<PathBuf, IpcError> {
    if !is_valid_cache_key(cache_key) {
        return Err(IpcError::Invalid(format!(
            "invalid cache_key: {cache_key:?}"
        )));
    }
    let dir = thumb_cache_dir(app_data);
    std::fs::create_dir_all(&dir)?;
    let final_path = dir.join(format!("{cache_key}.png"));
    let tmp_path = dir.join(format!("{cache_key}.png.tmp"));
    {
        let mut f = std::fs::File::create(&tmp_path)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp_path, &final_path)?;
    Ok(final_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_cache_keys() {
        assert!(is_valid_cache_key("abc123"));
        assert!(is_valid_cache_key(&"f".repeat(64)));
    }

    #[test]
    fn invalid_cache_keys() {
        assert!(!is_valid_cache_key(""));
        assert!(!is_valid_cache_key("../etc/passwd"));
        assert!(!is_valid_cache_key("foo.png"));
        assert!(!is_valid_cache_key("foo/bar"));
        assert!(!is_valid_cache_key(&"x".repeat(200)));
    }

    #[test]
    fn write_creates_file_with_bytes() {
        let tmp = tempdir();
        let data = b"\x89PNG\r\n\x1a\n-fake";
        let path = write_png_atomic(&tmp, "deadbeef", data).unwrap();
        assert!(path.ends_with("thumbnails/deadbeef.png"));
        let read = std::fs::read(&path).unwrap();
        assert_eq!(read, data);
    }

    #[test]
    fn write_rejects_bad_key() {
        let tmp = tempdir();
        let err = write_png_atomic(&tmp, "../escape", b"x");
        assert!(err.is_err());
    }

    // Inline mini-tempdir so we don't pull in a new crate for two tests.
    fn tempdir() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "stlb-cache-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }
}
