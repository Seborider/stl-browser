use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::db;
use crate::error::IpcError;
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
    // Kick off the scan after we've released the lock. start_for_library
    // returns immediately; events flow back via `scan:*` / `files:*`.
    scan::start_for_library(app, Arc::clone(state.inner()), library.id);
    Ok(library)
}

#[tauri::command]
pub fn remove_library(
    state: State<'_, Arc<AppState>>,
    id: i64,
) -> Result<(), IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::libraries::remove(&conn, id)
}
