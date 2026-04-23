use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rusqlite::params;
use tauri::AppHandle;
use tokio::sync::Semaphore;
use tokio::task::spawn_blocking;

use crate::db;
use crate::db::files::{FileRow, NeedsMetadata};
use crate::error::IpcError;
use crate::events;
use crate::mesh;
use crate::state::AppState;
use crate::types::{FileEntry, ThumbnailsNeededItem};

pub mod walker;
pub mod watcher;

/// For each entry, decide whether a `thumbnails:needed` payload item should be
/// emitted (i.e. its cache_key has no PNG yet) and batch-emit those.
/// Called from both the initial walker flush and the watcher's add/update path
/// so both sources share one de-dup rule.
pub fn emit_thumbnails_needed(
    app: &AppHandle,
    state: &AppState,
    library_path: &std::path::Path,
    entries: &[FileEntry],
) {
    if entries.is_empty() {
        return;
    }
    let keys: Vec<String> = entries.iter().map(|f| f.cache_key.clone()).collect();
    let missing = {
        let conn = match state.db.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        match db::thumbnails::filter_missing(&conn, &keys) {
            Ok(s) => s,
            Err(_) => return,
        }
    };
    if missing.is_empty() {
        return;
    }
    let items: Vec<ThumbnailsNeededItem> = entries
        .iter()
        .filter(|f| missing.contains(&f.cache_key))
        .map(|f| {
            let abs = library_path
                .join(&f.rel_path)
                .to_string_lossy()
                .to_string();
            ThumbnailsNeededItem {
                file_id: f.id,
                cache_key: f.cache_key.clone(),
                abs_path: abs,
                extension: f.extension.clone(),
            }
        })
        .collect();
    events::thumbnails_needed(app, items);
}

/// Re-parse mesh metadata for a single file and emit `metadata:ready`.
/// Used by Phase 3's scan stage 2 and by the Phase 4 watcher when a file's
/// content changes. Silent on DB/parser failure because this is fire-and-forget.
pub fn spawn_metadata_task(
    app: AppHandle,
    state: Arc<AppState>,
    file_id: i64,
    abs_path: String,
    extension: String,
) {
    tauri::async_runtime::spawn(async move {
        let computed_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let outcome = spawn_blocking(move || mesh::parse_file(&abs_path, &extension))
            .await
            .unwrap_or_else(|e| Err(format!("parser task panicked: {e}")));
        let stored = {
            let conn = match state.db.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            match db::mesh::upsert_metadata(&conn, file_id, outcome, computed_at) {
                Ok(m) => m,
                Err(_) => return,
            }
        };
        events::metadata_ready(&app, file_id, stored);
    });
}

/// Kicks off a scan for `library_id`. Returns quickly; the actual walk +
/// mesh-parse happen in tokio tasks that emit events.
///
/// Uses `tauri::async_runtime::spawn` because synchronous `#[tauri::command]`
/// handlers run on a blocking threadpool (no tokio reactor attached). Tauri's
/// async runtime is backed by tokio, so `tokio::spawn` / `spawn_blocking`
/// inside the spawned future work normally.
pub fn start_for_library(app: AppHandle, state: Arc<AppState>, library_id: i64) {
    tauri::async_runtime::spawn(async move {
        let library_path: PathBuf = {
            let conn = match state.db.lock() {
                Ok(g) => g,
                Err(e) => {
                    events::scan_error(&app, library_id, format!("db mutex poisoned: {e}"));
                    return;
                }
            };
            match conn.query_row::<String, _, _>(
                "SELECT path FROM libraries WHERE id = ?1",
                params![library_id],
                |r| r.get(0),
            ) {
                Ok(p) => PathBuf::from(p),
                Err(e) => {
                    events::scan_error(&app, library_id, format!("library not found: {e}"));
                    return;
                }
            }
        };

        events::scan_started(&app, library_id);

        // -------- Stage 1: walk + batched insert --------
        let walk_app = app.clone();
        let walk_state = Arc::clone(&state);
        let walk_result = spawn_blocking(move || -> Result<u64, IpcError> {
            let mut buffer: Vec<FileRow> = Vec::with_capacity(128);
            let mut last_flush = Instant::now();
            let mut scanned = 0u64;

            let flush = |state: &AppState,
                         app: &AppHandle,
                         lib_path: &std::path::Path,
                         buf: &mut Vec<FileRow>,
                         scanned_total: u64|
             -> Result<(), IpcError> {
                if buf.is_empty() {
                    return Ok(());
                }
                let inserted = {
                    let conn = state
                        .db
                        .lock()
                        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
                    db::files::insert_files_batch(&conn, buf)?
                };
                buf.clear();
                if !inserted.is_empty() {
                    events::files_added(app, inserted.clone());
                    emit_thumbnails_needed(app, state, lib_path, &inserted);
                }
                events::scan_progress(app, library_id, scanned_total);
                Ok(())
            };

            walker::walk(library_id, &library_path, &mut |row| {
                buffer.push(row);
                scanned += 1;
                if buffer.len() >= 100 || last_flush.elapsed() >= Duration::from_millis(250) {
                    flush(&walk_state, &walk_app, &library_path, &mut buffer, scanned)
                        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
                    last_flush = Instant::now();
                }
                Ok(())
            })?;
            flush(&walk_state, &walk_app, &library_path, &mut buffer, scanned)?;
            Ok(scanned)
        })
        .await;

        let total = match walk_result {
            Ok(Ok(n)) => n,
            Ok(Err(e)) => {
                events::scan_error(&app, library_id, e.to_string());
                return;
            }
            Err(e) => {
                events::scan_error(&app, library_id, format!("walker task panicked: {e}"));
                return;
            }
        };

        events::scan_completed(&app, library_id, total);

        // -------- Stage 2: mesh parsing with bounded concurrency --------
        let parallelism = std::thread::available_parallelism()
            .map(NonZeroUsize::get)
            .unwrap_or(1)
            .min(4);
        let sem = Arc::new(Semaphore::new(parallelism));

        let pending: Vec<NeedsMetadata> = {
            let conn = match state.db.lock() {
                Ok(g) => g,
                Err(e) => {
                    events::scan_error(&app, library_id, format!("db mutex poisoned: {e}"));
                    return;
                }
            };
            match db::files::list_needing_metadata(&conn, library_id) {
                Ok(v) => v,
                Err(e) => {
                    events::scan_error(&app, library_id, e.to_string());
                    return;
                }
            }
        };

        for row in pending {
            let permit = match sem.clone().acquire_owned().await {
                Ok(p) => p,
                Err(_) => break, // semaphore closed — shouldn't happen
            };
            let app_c = app.clone();
            let state_c = Arc::clone(&state);
            tokio::spawn(async move {
                let _permit = permit;
                let computed_at = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                let outcome = spawn_blocking(move || {
                    mesh::parse_file(&row.abs_path, &row.extension)
                })
                .await
                .unwrap_or_else(|e| Err(format!("parser task panicked: {e}")));

                let stored = {
                    let conn = match state_c.db.lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                    match db::mesh::upsert_metadata(&conn, row.id, outcome, computed_at) {
                        Ok(m) => m,
                        Err(_) => return,
                    }
                };
                events::metadata_ready(&app_c, row.id, stored);
            });
        }
    });
}
