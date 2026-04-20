mod db;
mod error;
mod events;
mod ipc;
mod mesh;
mod scan;
mod state;
mod types;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // `setup` runs once on startup with access to the app handle. We use
        // it to resolve the per-app data dir, open SQLite, apply migrations,
        // then register the connection as shared state.
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data)?;
            let db_path = app_data.join("library.db");
            let conn = db::open(&db_path)?;
            let state = AppState::new(conn);
            app.manage(Arc::clone(&state));

            // Start a watcher for every library already present in the DB.
            // A missing or unreadable path surfaces via scan:error but does
            // not block startup.
            let libraries = {
                let conn = state
                    .db
                    .lock()
                    .map_err(|e| format!("db mutex poisoned: {e}"))?;
                db::libraries::list(&conn).map_err(|e| e.to_string())?
            };
            let handle = app.handle();
            for lib in libraries {
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::libraries::list_libraries,
            ipc::libraries::add_library,
            ipc::libraries::remove_library,
            ipc::files::list_files,
            ipc::files::get_file_details,
            ipc::files::rescan_library,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
