mod cache;
mod db;
mod error;
mod events;
mod i18n;
mod ipc;
mod menu;
mod mesh;
mod scan;
mod state;
mod types;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;

use crate::state::AppState;
use crate::types::{Language, ThemeMode};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            let state: tauri::State<Arc<AppState>> = app.state();

            if let Some(mode) = ThemeMode::from_menu_id(id) {
                if let Ok(conn) = state.db.lock() {
                    let _ = crate::db::settings::set_theme_mode(&conn, mode);
                }
                if let Ok(handles) = state.menu_handles.lock() {
                    if let Some(h) = handles.as_ref() {
                        let _ = h.system.set_checked(mode == ThemeMode::System);
                        let _ = h.light.set_checked(mode == ThemeMode::Light);
                        let _ = h.dark.set_checked(mode == ThemeMode::Dark);
                    }
                }
                crate::events::theme_changed(app, mode);
                return;
            }

            if let Some(lang) = Language::from_menu_id(id) {
                let _ = crate::ipc::system::apply_language(app, &state, lang);
            }
        })
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data)?;
            let thumb_dir = cache::thumb_cache_dir(&app_data);
            std::fs::create_dir_all(&thumb_dir)?;
            let db_path = app_data.join("library.db");
            let conn = db::open(&db_path)?;
            let state = AppState::new(conn);
            app.manage(Arc::clone(&state));

            // `tauri.conf.json` ships with an empty asset:// scope because
            // library paths aren't known until the user picks them. Allowlist
            // the thumbnail dir + every existing library path at runtime so
            // `convertFileSrc(path)` URLs load in `<img>` / `fetch`.
            let asset_scope = app.asset_protocol_scope();
            let _ = asset_scope.allow_directory(&thumb_dir, true);

            let libraries = {
                let conn = state
                    .db
                    .lock()
                    .map_err(|e| format!("db mutex poisoned: {e}"))?;
                db::libraries::list(&conn).map_err(|e| e.to_string())?
            };
            let handle = app.handle();
            for lib in libraries {
                let _ = asset_scope.allow_directory(&lib.path, true);
                match scan::watcher::start(
                    handle.clone(),
                    Arc::clone(&state),
                    lib.id,
                    PathBuf::from(&lib.path),
                ) {
                    Ok(w) => {
                        if let Ok(mut map) = state.watchers.lock() {
                            map.insert(lib.id, w);
                        }
                    }
                    Err(e) => {
                        events::scan_error(handle, lib.id, format!("watcher start: {e}"));
                    }
                }
            }

            // One critical section: read both prefs, persist a detected
            // language if this is a fresh DB. Subsequent launches read the
            // stored value untouched, so changing macOS region later won't
            // override an explicit user choice.
            let (initial_mode, initial_lang) = {
                let conn = state
                    .db
                    .lock()
                    .map_err(|e| format!("db mutex poisoned: {e}"))?;
                let mode = crate::db::settings::get_theme_mode(&conn)
                    .map_err(|e| e.to_string())?;
                let lang = match crate::db::settings::get_language(&conn)
                    .map_err(|e| e.to_string())?
                {
                    Some(l) => l,
                    None => {
                        let detected = crate::i18n::detect_os_language();
                        crate::db::settings::set_language(&conn, detected)
                            .map_err(|e| e.to_string())?;
                        detected
                    }
                };
                (mode, lang)
            };

            let theme_handles = crate::menu::build(app.handle(), initial_mode, initial_lang)
                .map_err(|e| e.to_string())?;
            *state
                .menu_handles
                .lock()
                .map_err(|e| format!("menu_handles mutex poisoned: {e}"))? = Some(theme_handles);

            // Avoid the dark-flash when the user is in light mode and Tauri
            // would otherwise paint the WKWebView container dark before the
            // first frame.
            if let Some(window) = app.get_webview_window("main") {
                let resolved_dark = match initial_mode {
                    ThemeMode::Dark => true,
                    ThemeMode::Light => false,
                    // System: prefers-color-scheme isn't readable from Rust;
                    // pick the OS theme via Tauri's Window API.
                    ThemeMode::System => window
                        .theme()
                        .map(|t| t == tauri::Theme::Dark)
                        .unwrap_or(true),
                };
                let bg = if resolved_dark {
                    tauri::window::Color(10, 10, 10, 255)
                } else {
                    tauri::window::Color(255, 255, 255, 255)
                };
                let _ = window.set_background_color(Some(bg));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::libraries::list_libraries,
            ipc::libraries::add_library,
            ipc::libraries::remove_library,
            ipc::files::list_files,
            ipc::files::get_file_details,
            ipc::files::get_mesh_asset_url,
            ipc::files::rescan_library,
            ipc::thumbnails::save_thumbnail,
            ipc::thumbnails::get_thumbnail_cache_dir,
            ipc::thumbnails::list_thumbnail_keys,
            ipc::system::reveal_in_finder,
            ipc::system::get_theme_mode,
            ipc::system::get_preferences,
            ipc::system::set_language,
            ipc::system::set_model_color,
            ipc::system::set_lights,
            ipc::system::set_background_color,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
