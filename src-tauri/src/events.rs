use tauri::{AppHandle, Emitter};

use crate::types::{
    FilesAddedEvent, FilesRemovedEvent, FilesUpdatedEvent, MetadataReadyEvent,
    ScanCompletedEvent, ScanErrorEvent, ScanProgressEvent, ScanStartedEvent,
    ThumbnailsNeededEvent, ThumbnailsNeededItem, ThumbnailsReadyEvent,
};

// Event names live here so no caller can accidentally typo "scan:strted".
pub const SCAN_STARTED: &str = "scan:started";
pub const SCAN_PROGRESS: &str = "scan:progress";
pub const SCAN_COMPLETED: &str = "scan:completed";
pub const SCAN_ERROR: &str = "scan:error";
pub const FILES_ADDED: &str = "files:added";
pub const FILES_REMOVED: &str = "files:removed";
pub const FILES_UPDATED: &str = "files:updated";
pub const METADATA_READY: &str = "metadata:ready";
pub const THUMBNAILS_NEEDED: &str = "thumbnails:needed";
pub const THUMBNAILS_READY: &str = "thumbnails:ready";

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

pub fn files_removed(app: &AppHandle, file_ids: Vec<i64>) {
    let _ = app.emit(FILES_REMOVED, FilesRemovedEvent { file_ids });
}

pub fn files_updated(app: &AppHandle, files: Vec<crate::types::FileEntry>) {
    let _ = app.emit(FILES_UPDATED, FilesUpdatedEvent { files });
}

pub fn metadata_ready(app: &AppHandle, file_id: i64, metadata: crate::types::MeshMetadata) {
    let _ = app.emit(METADATA_READY, MetadataReadyEvent { file_id, metadata });
}

pub fn thumbnails_needed(app: &AppHandle, items: Vec<ThumbnailsNeededItem>) {
    if items.is_empty() {
        return;
    }
    let _ = app.emit(THUMBNAILS_NEEDED, ThumbnailsNeededEvent { items });
}

pub fn thumbnails_ready(
    app: &AppHandle,
    cache_key: String,
    width: i64,
    height: i64,
    generated_at: i64,
    file_ids: Vec<i64>,
) {
    let _ = app.emit(
        THUMBNAILS_READY,
        ThumbnailsReadyEvent {
            cache_key,
            width,
            height,
            generated_at,
            file_ids,
        },
    );
}
