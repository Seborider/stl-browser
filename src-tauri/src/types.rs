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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailsNeededItem {
    #[ts(type = "number")]
    pub file_id: i64,
    pub cache_key: String,
    pub abs_path: String,
    pub extension: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailsNeededEvent {
    pub items: Vec<ThumbnailsNeededItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailsReadyEvent {
    pub cache_key: String,
    #[ts(type = "number")]
    pub width: i64,
    #[ts(type = "number")]
    pub height: i64,
    #[ts(type = "number")]
    pub generated_at: i64,
    #[ts(type = "number[]")]
    pub file_ids: Vec<i64>,
}

// ---- theme override ----

// Lowercase serde rename so JSON values match the strings the renderer stores
// in localStorage and reads from the bootstrap inline script in index.html.
// Don't change the wire format without updating index.html and state/store.ts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    System,
    Light,
    Dark,
}

impl ThemeMode {
    pub fn menu_id(self) -> &'static str {
        match self {
            ThemeMode::System => "theme:system",
            ThemeMode::Light => "theme:light",
            ThemeMode::Dark => "theme:dark",
        }
    }

    pub fn from_menu_id(id: &str) -> Option<Self> {
        match id {
            "theme:system" => Some(ThemeMode::System),
            "theme:light" => Some(ThemeMode::Light),
            "theme:dark" => Some(ThemeMode::Dark),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct ThemeChangedEvent {
    pub mode: ThemeMode,
}

// ---- language override ----

// Lowercase serde rename keeps wire values stable as plain strings ("system"
// / "en" / "de") and matches the language tags used by react-i18next on the
// frontend, so the same payload travels end-to-end without remapping.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "lowercase")]
pub enum Language {
    System,
    En,
    De,
}

impl Language {
    pub fn menu_id(self) -> &'static str {
        match self {
            Language::System => "language:system",
            Language::En => "language:en",
            Language::De => "language:de",
        }
    }

    pub fn from_menu_id(id: &str) -> Option<Self> {
        match id {
            "language:system" => Some(Language::System),
            "language:en" => Some(Language::En),
            "language:de" => Some(Language::De),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct LightConfig {
    pub color: String,
    pub intensity_norm: f32,
    pub azimuth_deg: f32,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub theme: ThemeMode,
    pub language: Language,
    pub model_color: String,
    pub lights: Vec<LightConfig>,
    pub background_color: String,
}

pub const DEFAULT_MODEL_COLOR: &str = "#c0c0d0";
pub const DEFAULT_LIGHT_COLOR: &str = "#ffffff";
pub const DEFAULT_LIGHT_AZIMUTH_DEG: f32 = 45.0;
pub const DEFAULT_LIGHT_INTENSITY_NORM: f32 = 1.0;
pub const DEFAULT_BACKGROUND_COLOR: &str = "#1f1f24";
pub const MAX_LIGHTS: usize = 4;

pub fn default_lights() -> Vec<LightConfig> {
    vec![LightConfig {
        color: DEFAULT_LIGHT_COLOR.to_string(),
        intensity_norm: DEFAULT_LIGHT_INTENSITY_NORM,
        azimuth_deg: DEFAULT_LIGHT_AZIMUTH_DEG,
        enabled: true,
    }]
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct LanguageChangedEvent {
    pub language: Language,
}
