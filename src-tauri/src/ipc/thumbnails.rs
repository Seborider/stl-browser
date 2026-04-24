use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, State};

use crate::cache;
use crate::db;
use crate::error::IpcError;
use crate::events;
use crate::state::AppState;

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, IpcError> {
    app.path()
        .app_data_dir()
        .map_err(|e| IpcError::Io(format!("app_data_dir: {e}")))
}

/// Receive a rendered PNG from the renderer worker and persist it.
///
/// Shape proven in `spikes/spike3-raw-ipc` — raw body + headers is ~74× faster
/// than a JSON-encoded `Vec<u8>`:
///   - JS: `invoke('save_thumbnail', pngBytes, { headers: { 'x-cache-key': …,
///     'x-width': '512', 'x-height': '512' } })`
///   - Here: `request.body() → InvokeBody::Raw(Vec<u8>)`, headers via `.headers()`.
///
/// Writes `<app_data>/thumbnails/<cache_key>.png` atomically, INSERTs the
/// `thumbnails` row, then emits `thumbnails:ready` so the grid can swap the
/// placeholder for every file that shares this cache_key.
#[tauri::command]
pub async fn save_thumbnail(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    request: Request<'_>,
) -> Result<(), IpcError> {
    let bytes: Vec<u8> = match request.body() {
        InvokeBody::Raw(v) => v.clone(),
        InvokeBody::Json(_) => {
            return Err(IpcError::Invalid(
                "save_thumbnail expects a raw body (Uint8Array)".into(),
            ))
        }
    };

    let headers = request.headers();
    let cache_key = headers
        .get("x-cache-key")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| IpcError::Invalid("missing x-cache-key header".into()))?
        .to_string();
    let width: i64 = headers
        .get("x-width")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let height: i64 = headers
        .get("x-height")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    if bytes.len() < 8 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err(IpcError::Invalid("body is not a PNG".into()));
    }

    let app_data = app_data_dir(&app)?;
    let key_for_io = cache_key.clone();
    // Disk write on the blocking pool so we don't stall the IPC thread.
    // `Arc<AppState>` + owned Strings/Vec let the closure be 'static.
    tokio::task::spawn_blocking(move || {
        cache::write_png_atomic(&app_data, &key_for_io, &bytes)
    })
    .await
    .map_err(|e| IpcError::Io(format!("thumbnail write task panicked: {e}")))??;

    let generated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let file_ids = {
        let conn = state
            .db
            .lock()
            .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
        db::thumbnails::insert(&conn, &cache_key, generated_at, width, height)?;
        db::thumbnails::file_ids_for_cache_key(&conn, &cache_key)?
    };

    events::thumbnails_ready(&app, cache_key, width, height, generated_at, file_ids);
    Ok(())
}

/// Return the absolute path to the thumbnails cache directory so the frontend
/// can `convertFileSrc` it and render PNGs via the asset:// protocol.
#[tauri::command]
pub fn get_thumbnail_cache_dir(app: AppHandle) -> Result<String, IpcError> {
    let dir = cache::thumb_cache_dir(&app_data_dir(&app)?);
    std::fs::create_dir_all(&dir)?;
    Ok(dir.to_string_lossy().to_string())
}

/// List cache_keys that already have a PNG. Frontend seeds its queue with
/// this at startup to avoid re-rendering anything already cached.
#[tauri::command]
pub fn list_thumbnail_keys(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<String>, IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::thumbnails::list_all_keys(&conn)
}
