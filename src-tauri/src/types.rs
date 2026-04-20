use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ts-rs defaults i64 → `bigint` in TS, but Tauri's IPC serializes i64 as a
// regular JSON number (safe up to 2^53, which is fine for auto-increment ids
// and unix-millis timestamps). Force `number` with `#[ts(type = "number")]`.

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct Library {
    #[ts(type = "number")]
    pub id: i64,
    pub path: String,
    pub name: String,
    #[ts(type = "number")]
    pub added_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub library_id: i64,
    pub rel_path: String,
    pub name: String,
    pub extension: String,
    #[ts(type = "number")]
    pub size_bytes: i64,
    #[ts(type = "number")]
    pub mtime_ms: i64,
    pub cache_key: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "lowercase")]
pub enum SortKey {
    Name,
    Size,
    Mtime,
    Format,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct Sort {
    pub key: SortKey,
    pub direction: SortDirection,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct FileQuery {
    #[ts(type = "number | null")]
    pub library_id: Option<i64>,
    pub sort: Sort,
    pub search: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct MeshMetadata {
    pub bbox_min: Option<[f64; 3]>,
    pub bbox_max: Option<[f64; 3]>,
    #[ts(type = "number | null")]
    pub triangle_count: Option<i64>,
    pub volume_mm3: Option<f64>,
    pub surface_area_mm2: Option<f64>,
    #[ts(type = "number")]
    pub computed_at: i64,
    pub parse_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct FileDetails {
    pub file: FileEntry,
    pub metadata: Option<MeshMetadata>,
}

// ---- event payloads ----

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct ScanStartedEvent {
    #[ts(type = "number")]
    pub library_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressEvent {
    #[ts(type = "number")]
    pub library_id: i64,
    #[ts(type = "number")]
    pub scanned: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct ScanCompletedEvent {
    #[ts(type = "number")]
    pub library_id: i64,
    #[ts(type = "number")]
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct ScanErrorEvent {
    #[ts(type = "number")]
    pub library_id: i64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct FilesAddedEvent {
    pub files: Vec<FileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct FilesRemovedEvent {
    #[ts(type = "number[]")]
    pub file_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct FilesUpdatedEvent {
    pub files: Vec<FileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct MetadataReadyEvent {
    #[ts(type = "number")]
    pub file_id: i64,
    pub metadata: MeshMetadata,
}
