use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

use crate::error::IpcError;

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
