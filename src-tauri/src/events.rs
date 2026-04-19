use tauri::{AppHandle, Emitter};

use crate::types::{
    FilesAddedEvent, MetadataReadyEvent, ScanCompletedEvent, ScanErrorEvent,
    ScanProgressEvent, ScanStartedEvent,
};

// Event names live here so no caller can accidentally typo "scan:strted".
pub const SCAN_STARTED: &str = "scan:started";
pub const SCAN_PROGRESS: &str = "scan:progress";
pub const SCAN_COMPLETED: &str = "scan:completed";
pub const SCAN_ERROR: &str = "scan:error";
pub const FILES_ADDED: &str = "files:added";
pub const METADATA_READY: &str = "metadata:ready";

// `Emitter` is Tauri 2's trait that puts `.emit` on AppHandle. Errors are
// logged and swallowed — emit failures mean the webview is gone, in which
// case there's nothing we can do.
pub fn scan_started(app: &AppHandle, library_id: i64) {
    let _ = app.emit(SCAN_STARTED, ScanStartedEvent { library_id });
}

pub fn scan_progress(app: &AppHandle, library_id: i64, scanned: u64) {
    let _ = app.emit(SCAN_PROGRESS, ScanProgressEvent { library_id, scanned });
}

pub fn scan_completed(app: &AppHandle, library_id: i64, total: u64) {
    let _ = app.emit(SCAN_COMPLETED, ScanCompletedEvent { library_id, total });
}

pub fn scan_error(app: &AppHandle, library_id: i64, message: String) {
    let _ = app.emit(SCAN_ERROR, ScanErrorEvent { library_id, message });
}

pub fn files_added(app: &AppHandle, files: Vec<crate::types::FileEntry>) {
    let _ = app.emit(FILES_ADDED, FilesAddedEvent { files });
}

pub fn metadata_ready(app: &AppHandle, file_id: i64, metadata: crate::types::MeshMetadata) {
    let _ = app.emit(METADATA_READY, MetadataReadyEvent { file_id, metadata });
}
