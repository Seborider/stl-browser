use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

use crate::db;
use crate::error::IpcError;
use crate::events;
use crate::state::AppState;
use crate::types::{Language, Preferences, ThemeMode};

/// Reveal a file in Finder via `open -R <abs_path>`.
///
/// The shell plugin's Rust API bypasses the frontend capability scope, so we
/// validate the input here: the path must be absolute and must point to an
/// existing entry. `open -R` is a user-facing, non-destructive action, so a
/// non-zero exit (e.g. file moved between click and call) is surfaced back as
/// an `IpcError::Io` rather than a panic.
#[tauri::command]
pub async fn reveal_in_finder(app: AppHandle, path: String) -> Result<(), IpcError> {
    let p = std::path::Path::new(&path);
    if !p.is_absolute() {
        return Err(IpcError::Invalid(format!("not an absolute path: {path}")));
    }
    if !p.exists() {
        return Err(IpcError::NotFound(path));
    }

    app.shell()
        .command("open")
        .args(["-R", &path])
        .status()
        .await
        .map_err(|e| IpcError::Io(format!("open -R failed: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn get_theme_mode(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
) -> Result<ThemeMode, IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::settings::get_theme_mode(&conn)
}

/// Combined accessor so the renderer's bootstrap path needs one IPC round
/// trip rather than two before React mounts. Language defaults to `System`
/// if no row exists — the setup hook persists a concrete value on first
/// launch, so the fallback is only hit if the row is manually wiped.
#[tauri::command]
pub async fn get_preferences(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
) -> Result<Preferences, IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    let theme = db::settings::get_theme_mode(&conn)?;
    let language = db::settings::get_language(&conn)?.unwrap_or(Language::System);
    let model_color = db::settings::get_model_color(&conn)?;
    let light_color = db::settings::get_light_color(&conn)?;
    let light_azimuth_deg = db::settings::get_light_azimuth_deg(&conn)?;
    Ok(Preferences {
        theme,
        language,
        model_color,
        light_color,
        light_azimuth_deg,
    })
}

#[tauri::command]
pub async fn set_model_color(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    hex: String,
) -> Result<(), IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::settings::set_model_color(&conn, &hex)
}

#[tauri::command]
pub async fn set_light_color(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    hex: String,
) -> Result<(), IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::settings::set_light_color(&conn, &hex)
}

#[tauri::command]
pub async fn set_light_azimuth(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    deg: f32,
) -> Result<(), IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::settings::set_light_azimuth_deg(&conn, deg)
}

#[tauri::command]
pub async fn set_language(
    app: AppHandle,
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    language: Language,
) -> Result<(), IpcError> {
    apply_language(&app, state.inner(), language)
}

// Shared by the IPC command and the on_menu_event handler in `lib.rs`.
// Reads the current theme and persists language under one DB lock, then
// rebuilds the native menu (so labels relabel) and emits `language:changed`
// so the renderer reconciles too.
pub(crate) fn apply_language(
    app: &AppHandle,
    state: &std::sync::Arc<AppState>,
    language: Language,
) -> Result<(), IpcError> {
    let theme = {
        let conn = state
            .db
            .lock()
            .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
        db::settings::set_language(&conn, language)?;
        db::settings::get_theme_mode(&conn)?
    };
    crate::menu::rebuild(app, state, theme, language)?;
    events::language_changed(app, language);
    Ok(())
}
