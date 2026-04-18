use tauri::State;

use crate::error::IpcError;
use crate::state::AppState;
use crate::types::{FileEntry, Sort};

// Phase 2 returns an empty list unconditionally; Phase 3 wires real scanning.
// We accept the full query shape now so the frontend can ship the IPC call
// without later signature churn.
#[tauri::command]
pub fn list_files(
    _state: State<'_, AppState>,
    _library_id: Option<i64>,
    _sort: Sort,
    _search: String,
) -> Result<Vec<FileEntry>, IpcError> {
    Ok(Vec::new())
}
