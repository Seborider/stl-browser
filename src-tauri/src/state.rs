use std::sync::{Arc, Mutex};

use rusqlite::Connection;

// `Arc<Mutex<_>>` in Rust is the "shared mutable state" pattern:
//   - `Arc` ("atomic reference count") lets multiple owners hold the same value;
//     Tauri hands copies of `State<'_, AppState>` to every command handler.
//   - `Mutex` serializes access — only one caller holds the DB connection at a
//     time. `rusqlite::Connection` isn't thread-safe on its own so this is the
//     cheapest correct choice until contention shows up in a profile.
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
}

impl AppState {
    pub fn new(conn: Connection) -> Self {
        Self {
            db: Arc::new(Mutex::new(conn)),
        }
    }
}
