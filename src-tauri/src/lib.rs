mod db;
mod error;
mod ipc;
mod state;
mod types;

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
            app.manage(AppState::new(conn));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::libraries::list_libraries,
            ipc::libraries::add_library,
            ipc::libraries::remove_library,
            ipc::files::list_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
