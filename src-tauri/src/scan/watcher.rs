use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::event::EventKind;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, DebouncedEvent, Debouncer, FileIdMap,
};
use tauri::AppHandle;

use crate::db;
use crate::db::files::{ExistingFile, FileRow};
use crate::error::IpcError;
use crate::events;
use crate::scan::walker::compute_cache_key;
use crate::state::AppState;

/// Handle whose lifetime owns the debouncer. Dropping the handle stops the
/// underlying filesystem watch (Debouncer's Drop signals its worker thread).
pub struct WatcherHandle {
    _debouncer: Debouncer<RecommendedWatcher, FileIdMap>,
}

#[derive(Debug, Default)]
pub struct Classification {
    pub added: Vec<FileRow>,
    pub removed: Vec<i64>,
    pub updated: Vec<(i64, FileRow)>,
}

/// Pure diff: for each affected rel_path, compare the current fs snapshot
/// against the existing DB state and classify. Kept IO-free so it is trivially
/// unit-testable.
pub fn classify(
    snapshots: &[(String, Option<FileRow>)],
    existing: &HashMap<String, ExistingFile>,
) -> Classification {
    let mut out = Classification::default();
    for (rel, snap) in snapshots {
        match (existing.get(rel), snap) {
            (None, None) => {}
            (None, Some(row)) => out.added.push(row.clone()),
            (Some(ex), None) => out.removed.push(ex.id),
            (Some(ex), Some(row)) => {
                if ex.cache_key != row.cache_key {
                    out.updated.push((ex.id, row.clone()));
                }
            }
        }
    }
    out
}

const WATCHED_EXTS: &[&str] = &["stl", "3mf", "obj"];

fn is_watched_ext(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
    if WATCHED_EXTS.contains(&ext.as_str()) {
        Some(ext)
    } else {
        None
    }
}

/// Stat a path and, if it is a regular file we care about, build the FileRow
/// the DB would store for it. Missing / permission-denied / non-files return
/// None, which the classifier interprets as "doesn't exist".
fn snapshot_fs(library_id: i64, library_path: &Path, abs_path: &Path) -> Option<(String, FileRow)> {
    let ext = is_watched_ext(abs_path)?;
    let md = std::fs::metadata(abs_path).ok()?;
    if !md.is_file() {
        return None;
    }
    let size = md.len() as i64;
    let mtime_ms = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let abs_str = abs_path.to_string_lossy().to_string();
    let cache_key = compute_cache_key(&abs_str, mtime_ms, size);
    let rel = abs_path
        .strip_prefix(library_path)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");
    let name = abs_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| rel.clone());
    let scanned_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let row = FileRow {
        library_id,
        rel_path: rel.clone(),
        name,
        extension: ext,
        size_bytes: size,
        mtime_ms,
        scanned_at,
        cache_key,
    };
    Some((rel, row))
}

fn rel_for(library_path: &Path, abs_path: &Path) -> Option<String> {
    abs_path
        .strip_prefix(library_path)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

/// Collect affected paths from a debounced batch, filtering to our extensions.
fn affected_paths(events: &[DebouncedEvent]) -> Vec<PathBuf> {
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut out: Vec<PathBuf> = Vec::new();
    for ev in events {
        // EventKind::Any / Access events are ignored; we only care about
        // Create/Modify/Remove/Rename which correspond to changes the user
        // would expect the grid to reflect.
        let kept = matches!(
            ev.kind,
            EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
        );
        if !kept {
            continue;
        }
        for p in &ev.paths {
            if is_watched_ext(p).is_none() {
                continue;
            }
            if seen.insert(p.clone()) {
                out.push(p.clone());
            }
        }
    }
    out
}

/// Apply a classified batch to the DB and emit the corresponding events.
/// Re-parses metadata for added + updated files via the shared spawn helper.
fn apply_and_emit(
    app: &AppHandle,
    state: &Arc<AppState>,
    library_id: i64,
    library_path: &Path,
    classification: Classification,
) {
    let Classification {
        added,
        removed,
        updated,
    } = classification;

    if !added.is_empty() {
        let inserted = {
            let conn = match state.db.lock() {
                Ok(g) => g,
                Err(e) => {
                    events::scan_error(app, library_id, format!("db mutex poisoned: {e}"));
                    return;
                }
            };
            match db::files::insert_files_batch(&conn, &added) {
                Ok(v) => v,
                Err(e) => {
                    events::scan_error(app, library_id, e.to_string());
                    return;
                }
            }
        };
        if !inserted.is_empty() {
            events::files_added(app, inserted.clone());
            for entry in inserted {
                let abs = library_path
                    .join(entry.rel_path.clone())
                    .to_string_lossy()
                    .to_string();
                super::spawn_metadata_task(app.clone(), Arc::clone(state), entry.id, abs, entry.extension);
            }
        }
    }

    if !removed.is_empty() {
        let deleted = {
            let conn = match state.db.lock() {
                Ok(g) => g,
                Err(e) => {
                    events::scan_error(app, library_id, format!("db mutex poisoned: {e}"));
                    return;
                }
            };
            match db::files::delete_by_ids(&conn, &removed) {
                Ok(n) => n,
                Err(e) => {
                    events::scan_error(app, library_id, e.to_string());
                    return;
                }
            }
        };
        if deleted > 0 {
            events::files_removed(app, removed.clone());
        }
    }

    if !updated.is_empty() {
        let entries = {
            let conn = match state.db.lock() {
                Ok(g) => g,
                Err(e) => {
                    events::scan_error(app, library_id, format!("db mutex poisoned: {e}"));
                    return;
                }
            };
            let mut out = Vec::with_capacity(updated.len());
            for (id, row) in &updated {
                match db::files::update_file_row(&conn, *id, row) {
                    Ok(e) => out.push(e),
                    Err(e) => {
                        events::scan_error(app, library_id, e.to_string());
                        return;
                    }
                }
            }
            out
        };
        if !entries.is_empty() {
            events::files_updated(app, entries.clone());
            for entry in entries {
                let abs = library_path
                    .join(entry.rel_path.clone())
                    .to_string_lossy()
                    .to_string();
                super::spawn_metadata_task(app.clone(), Arc::clone(state), entry.id, abs, entry.extension);
            }
        }
    }
}

fn process_batch(
    app: &AppHandle,
    state: &Arc<AppState>,
    library_id: i64,
    library_path: &Path,
    events_batch: Vec<DebouncedEvent>,
) {
    let paths = affected_paths(&events_batch);
    if paths.is_empty() {
        return;
    }

    let mut snapshots: Vec<(String, Option<FileRow>)> = Vec::with_capacity(paths.len());
    for abs in &paths {
        match snapshot_fs(library_id, library_path, abs) {
            Some((rel, row)) => snapshots.push((rel, Some(row))),
            None => {
                if let Some(rel) = rel_for(library_path, abs) {
                    snapshots.push((rel, None));
                }
            }
        }
    }
    if snapshots.is_empty() {
        return;
    }

    let rels: Vec<String> = snapshots.iter().map(|(r, _)| r.clone()).collect();
    let existing = {
        let conn = match state.db.lock() {
            Ok(g) => g,
            Err(e) => {
                events::scan_error(app, library_id, format!("db mutex poisoned: {e}"));
                return;
            }
        };
        match db::files::list_by_rel_paths(&conn, library_id, &rels) {
            Ok(m) => m,
            Err(e) => {
                events::scan_error(app, library_id, e.to_string());
                return;
            }
        }
    };

    let classified = classify(&snapshots, &existing);
    apply_and_emit(app, state, library_id, library_path, classified);
}

/// Start a filesystem watcher for the given library. Returns a handle the
/// caller must keep alive; dropping it stops the watch.
pub fn start(
    app: AppHandle,
    state: Arc<AppState>,
    library_id: i64,
    library_path: PathBuf,
) -> Result<WatcherHandle, IpcError> {
    let (tx, rx) = std::sync::mpsc::channel::<DebounceEventResult>();

    let mut debouncer = new_debouncer(Duration::from_millis(250), None, move |res| {
        let _ = tx.send(res);
    })
    .map_err(|e| IpcError::Io(format!("watcher init: {e}")))?;

    debouncer
        .watcher()
        .watch(&library_path, RecursiveMode::Recursive)
        .map_err(|e| IpcError::Io(format!("watch {}: {e}", library_path.display())))?;

    // Process debounced batches on a dedicated std::thread. When the
    // WatcherHandle is dropped the debouncer stops, its sender is dropped, and
    // rx.recv() returns Err, ending this loop.
    let app_c = app;
    let state_c = state;
    let lib_path_c = library_path;
    std::thread::Builder::new()
        .name(format!("watcher-lib-{library_id}"))
        .spawn(move || {
            while let Ok(result) = rx.recv() {
                match result {
                    Ok(batch) => {
                        process_batch(&app_c, &state_c, library_id, &lib_path_c, batch);
                    }
                    Err(errors) => {
                        for e in errors {
                            events::scan_error(&app_c, library_id, format!("watch error: {e}"));
                        }
                    }
                }
            }
        })
        .map_err(|e| IpcError::Io(format!("watcher thread spawn: {e}")))?;

    Ok(WatcherHandle {
        _debouncer: debouncer,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(rel: &str, key: &str) -> FileRow {
        FileRow {
            library_id: 1,
            rel_path: rel.to_string(),
            name: rel.to_string(),
            extension: "stl".into(),
            size_bytes: 1,
            mtime_ms: 1,
            scanned_at: 1,
            cache_key: key.to_string(),
        }
    }

    #[test]
    fn classifier_handles_add_remove_update_and_noop() {
        let mut existing = HashMap::new();
        existing.insert(
            "a.stl".to_string(),
            ExistingFile { id: 1, cache_key: "K1".into() },
        );
        existing.insert(
            "b.stl".to_string(),
            ExistingFile { id: 2, cache_key: "K2".into() },
        );
        existing.insert(
            "c.stl".to_string(),
            ExistingFile { id: 3, cache_key: "K3".into() },
        );

        let snapshots = vec![
            ("a.stl".into(), Some(row("a.stl", "K1_NEW"))), // updated
            ("b.stl".into(), None),                          // removed
            ("c.stl".into(), Some(row("c.stl", "K3"))),      // unchanged -> noop
            ("d.stl".into(), Some(row("d.stl", "K4"))),      // added
            ("e.stl".into(), None),                          // noise
        ];

        let c = classify(&snapshots, &existing);

        assert_eq!(c.added.len(), 1);
        assert_eq!(c.added[0].rel_path, "d.stl");

        assert_eq!(c.removed, vec![2]);

        assert_eq!(c.updated.len(), 1);
        assert_eq!(c.updated[0].0, 1);
        assert_eq!(c.updated[0].1.cache_key, "K1_NEW");
    }

    #[test]
    fn classifier_empty_inputs_yield_empty_result() {
        let existing: HashMap<String, ExistingFile> = HashMap::new();
        let snapshots: Vec<(String, Option<FileRow>)> = Vec::new();
        let c = classify(&snapshots, &existing);
        assert!(c.added.is_empty());
        assert!(c.removed.is_empty());
        assert!(c.updated.is_empty());
    }

    #[test]
    fn is_watched_ext_case_insensitive() {
        assert_eq!(is_watched_ext(Path::new("foo.STL")).as_deref(), Some("stl"));
        assert_eq!(is_watched_ext(Path::new("foo.3MF")).as_deref(), Some("3mf"));
        assert_eq!(is_watched_ext(Path::new("foo.Obj")).as_deref(), Some("obj"));
        assert!(is_watched_ext(Path::new("foo.txt")).is_none());
        assert!(is_watched_ext(Path::new("foo")).is_none());
    }
}
