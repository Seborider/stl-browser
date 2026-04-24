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

/// The library root is allowlisted on the asset-protocol scope at startup
/// (see `lib.rs`), so `convertFileSrc`-ing this path yields a fetchable URL.
#[tauri::command]
pub fn get_mesh_asset_url(
    state: State<'_, Arc<AppState>>,
    id: i64,
) -> Result<String, IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    let abs = db::files::abs_path_for(&conn, id)?;
    Ok(abs.to_string_lossy().into_owned())
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
