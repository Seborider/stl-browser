use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::db;
use crate::error::IpcError;
use crate::events;
use crate::scan;
use crate::state::AppState;
use crate::types::Library;

// `#[tauri::command]` generates the IPC glue that makes this callable from the
// renderer via `invoke("list_libraries")`. `State<'_, Arc<AppState>>` pulls the
// value registered with `.manage()` at app setup.
#[tauri::command]
pub fn list_libraries(state: State<'_, Arc<AppState>>) -> Result<Vec<Library>, IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::libraries::list(&conn)
}

#[tauri::command]
pub fn add_library(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<Library, IpcError> {
    let library = {
        let conn = state
            .db
            .lock()
            .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
        db::libraries::add(&conn, &path)?
    };

    // Start the file watcher before kicking off the initial scan so no events
    // are missed during the walk. Failures here are non-fatal — surface via
    // scan:error so the UI can still show the new library.
    match scan::watcher::start(
        app.clone(),
        Arc::clone(state.inner()),
        library.id,
        PathBuf::from(&library.path),
    ) {
        Ok(handle) => {
            if let Ok(mut map) = state.watchers.lock() {
                map.insert(library.id, handle);
            }
        }
        Err(e) => {
            events::scan_error(&app, library.id, format!("watcher start: {e}"));
        }
    }

    scan::start_for_library(app, Arc::clone(state.inner()), library.id);
    Ok(library)
}

#[tauri::command]
pub fn remove_library(
    state: State<'_, Arc<AppState>>,
    id: i64,
) -> Result<(), IpcError> {
    // Stop the watcher first so no further events target a library we're
    // deleting. Dropping the handle signals the debouncer to stop.
    if let Ok(mut map) = state.watchers.lock() {
        map.remove(&id);
    }
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::libraries::remove(&conn, id)
}
