use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tauri::menu::CheckMenuItem;
use tauri::Wry;

use crate::scan::watcher::WatcherHandle;

// `Arc<Mutex<_>>` is the standard "shared mutable state" pattern:
//   - `Arc` ("atomic reference count") lets multiple owners hold the same value;
//     Tauri hands copies of `State<'_, Arc<AppState>>` to command handlers, and
//     scanner tasks clone the Arc to keep their own reference.
//   - `Mutex` serializes access — `rusqlite::Connection` isn't thread-safe on
//     its own so this is the cheapest correct choice until contention shows up.
pub struct AppState {
    pub db: Mutex<Connection>,
    pub watchers: Mutex<HashMap<i64, WatcherHandle>>,
    // Theme `CheckMenuItem` handles, used by `on_menu_event` to flip
    // checkmarks. Language items are rebuilt wholesale on language change,
    // so they're not retained here.
    pub menu_handles: Mutex<Option<ThemeMenuHandles>>,
}

pub struct ThemeMenuHandles {
    pub system: CheckMenuItem<Wry>,
    pub light: CheckMenuItem<Wry>,
    pub dark: CheckMenuItem<Wry>,
}

impl AppState {
    pub fn new(conn: Connection) -> Arc<Self> {
        Arc::new(Self {
            db: Mutex::new(conn),
            watchers: Mutex::new(HashMap::new()),
            menu_handles: Mutex::new(None),
        })
    }
}
