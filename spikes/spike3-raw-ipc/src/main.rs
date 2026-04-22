// Spike 3 — raw-body IPC vs JSON-encoded Vec<u8>.
//
// `save_raw`  receives bytes via Tauri 2's raw-body IPC path. The JS side
//             passes a typed array as the second argument to `invoke` and
//             Tauri delivers it to this handler via `Request::body()`.
//
// `save_json` is the comparison baseline — the JS side sends
//             `{ bytes: [0, 1, 2, ...] }` as JSON, which Tauri deserializes
//             into `Vec<u8>`. Expected to be much slower due to JSON parse
//             overhead on a megabyte-sized number array.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::ipc::{InvokeBody, Request};

#[tauri::command]
fn save_raw(request: Request<'_>) -> Result<usize, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.len()),
        InvokeBody::Json(_) => {
            Err("expected raw body, got JSON — pass a Uint8Array/ArrayBuffer as the 2nd invoke arg".into())
        }
    }
}

#[tauri::command]
fn save_json(bytes: Vec<u8>) -> usize {
    bytes.len()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_raw, save_json])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
