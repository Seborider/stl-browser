use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::db;
use crate::error::IpcError;
use crate::scan;
use crate::state::AppState;
use crate::types::{FileDetails, FileEntry, FileQuery};

#[tauri::command]
pub fn list_files(
    state: State<'_, Arc<AppState>>,
    query: FileQuery,
) -> Result<Vec<FileEntry>, IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::files::list_files(&conn, &query)
}

#[tauri::command]
pub fn get_file_details(
    state: State<'_, Arc<AppState>>,
    id: i64,
) -> Result<FileDetails, IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    let file = db::files::get_by_id(&conn, id)?;
    let metadata = db::mesh::get_for_file(&conn, id)?;
    Ok(FileDetails { file, metadata })
}

#[tauri::command]
pub fn rescan_library(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: i64,
) -> Result<(), IpcError> {
    scan::start_for_library(app, Arc::clone(state.inner()), id);
    Ok(())
}
