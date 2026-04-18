use tauri::State;

use crate::db;
use crate::error::IpcError;
use crate::state::AppState;
use crate::types::Library;

// `#[tauri::command]` generates the IPC glue that makes this callable from the
// renderer via `invoke("list_libraries")`. `State<'_, AppState>` pulls the
// value registered with `.manage()` at app setup.
#[tauri::command]
pub fn list_libraries(state: State<'_, AppState>) -> Result<Vec<Library>, IpcError> {
    // `lock()` returns a `MutexGuard` that holds the lock for the scope.
    // Poisoning happens if a prior holder panicked; we surface that as a DB error.
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::libraries::list(&conn)
}

#[tauri::command]
pub fn add_library(state: State<'_, AppState>, path: String) -> Result<Library, IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::libraries::add(&conn, &path)
}

#[tauri::command]
pub fn remove_library(state: State<'_, AppState>, id: i64) -> Result<(), IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::libraries::remove(&conn, id)
}
