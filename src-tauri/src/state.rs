use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::scan::watcher::WatcherHandle;

// `Arc<Mutex<_>>` is the standard "shared mutable state" pattern:
//   - `Arc` ("atomic reference count") lets multiple owners hold the same value;
//     Tauri hands copies of `State<'_, Arc<AppState>>` to command handlers, and
//     scanner tasks clone the Arc to keep their own reference.
//   - `Mutex` serializes access — `rusqlite::Connection` isn't thread-safe on
//     its own so this is the cheapest correct choice until contention shows up.
pub struct AppState {
    pub db: Mutex<Connection>,
    // Per-library watcher handles. Dropping a handle (via `remove`) stops the
    // underlying notify watch; we keep them alive here for the app's lifetime.
    pub watchers: Mutex<HashMap<i64, WatcherHandle>>,
}

impl AppState {
    pub fn new(conn: Connection) -> Arc<Self> {
        Arc::new(Self {
            db: Mutex::new(conn),
            watchers: Mutex::new(HashMap::new()),
        })
    }
}
