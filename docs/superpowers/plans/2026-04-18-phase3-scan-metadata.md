# Phase 3 — Scanning + Metadata — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recursive folder scanning, mesh metadata extraction, and the IPC wiring that makes a user-added library populate the grid (and inspector) with real STL/OBJ/3MF data.

**Architecture:** One `tokio::spawn` task per library kicks off a sync `walkdir` pass inside `spawn_blocking`, flushing `INSERT OR IGNORE` batches of ~100 and emitting `files:added` / `scan:progress`. After the walk completes, a second tokio stage parses meshes with bounded concurrency (`min(std::thread::available_parallelism(), 4)`), stores metrics into a new `mesh_metadata` table, and emits `metadata:ready`. The `std::sync::Mutex<Connection>` is only ever held inside `spawn_blocking` bodies, never across `.await`.

**Tech Stack:** Rust (tokio, walkdir, blake3, stl_io, tobj, threemf, rusqlite, thiserror, ts-rs) + React (Zustand, Tauri 2 `invoke`/`listen`).

**Source of truth for decisions:** `docs/superpowers/specs/2026-04-18-phase3-scan-metadata-design.md`.

---

## Scope locks (hard constraints from the user's prompt)

- No `notify` / watcher / `files:removed` / `files:updated` (Phase 4).
- No thumbnail pipeline, Web Worker, `save_thumbnail`, `get_thumbnail_url`, `thumbnails` table (Phase 5).
- No R3F detail viewer (Phase 6).
- No new crates beyond PLAN §6 (`tokio`, `walkdir`, `blake3`, `stl_io`, `tobj`, `threemf`). No `num_cpus`. No `tempfile` (tests use `std::env::temp_dir()` + manual cleanup).
- No hand-editing `src/generated/*.ts`.
- No placeholder TODOs or half-finished phases.

---

## File structure

**Rust — new files:**
- `src-tauri/src/scan/mod.rs` — orchestration (`start_for_library`)
- `src-tauri/src/scan/walker.rs` — sync walkdir + blake3 hashing
- `src-tauri/src/mesh/mod.rs` — dispatch by extension → `Vec<[[f64;3];3]>`
- `src-tauri/src/mesh/stl.rs` — stl_io parser
- `src-tauri/src/mesh/obj.rs` — tobj parser
- `src-tauri/src/mesh/threemf.rs` — threemf parser
- `src-tauri/src/mesh/metrics.rs` — bbox / tri_count / area / optional volume
- `src-tauri/src/db/files.rs` — `insert_files_batch`, `list_files`, `list_needing_metadata`, `get_by_id`
- `src-tauri/src/db/mesh.rs` — `upsert_metadata`, `get_for_file`
- `src-tauri/src/events.rs` — namespaced emit helpers

**Rust — modified files:**
- `src-tauri/Cargo.toml` — add tokio, walkdir, blake3, stl_io, tobj, threemf
- `src-tauri/src/lib.rs` — declare new modules; register new commands
- `src-tauri/src/types.rs` — add FileQuery, FileDetails, MeshMetadata, event payloads
- `src-tauri/src/db/mod.rs` — declare `files`, `mesh` submodules
- `src-tauri/src/db/migrations.rs` — append v2 SQL
- `src-tauri/src/ipc/mod.rs` — already exports files + libraries; no change needed unless a new submodule appears
- `src-tauri/src/ipc/files.rs` — new `list_files(FileQuery)` signature + `get_file_details` + `rescan_library`
- `src-tauri/src/ipc/libraries.rs` — `add_library` spawns a scan

**Frontend — new files:**
- `src/ipc/events.ts` — typed `listen()` wrappers
- `src/state/files.ts` — Zustand store for `filesByLibrary` + `metadataByFileId`
- `src/hooks/useLiveEvents.ts` — mounted once; subscribes to `files:added`, `metadata:ready`

**Frontend — modified files:**
- `src/ipc/commands.ts` — `listFiles(query)` signature change; add `getFileDetails`, `rescanLibrary`
- `src/hooks/useVisibleFiles.ts` — merges store with list_files baseline
- `src/components/Inspector.tsx` — fetches file details + subscribes to metadata updates
- `src/App.tsx` — mount `useLiveEvents` once

**Docs — modified:**
- `PLAN.md` — reflect schema + concurrency deviations; mark Phase 3 complete at the end.

---

## Verification commands (reused below)

```bash
# Rust build
cargo build --manifest-path src-tauri/Cargo.toml
# Rust tests (runs both our tests and ts-rs export_bindings_)
cargo test --manifest-path src-tauri/Cargo.toml
# Regenerate bindings only
pnpm bindings
# Frontend type check + vite build
pnpm build
```

---

## Task 1: Add Cargo dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the six new dependencies**

Replace the `[dependencies]` section of `src-tauri/Cargo.toml` with:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rusqlite = { version = "0.31", features = ["bundled"] }
thiserror = "1"
ts-rs = { version = "7", features = ["serde-compat"] }
tokio = { version = "1", features = ["full"] }
walkdir = "2"
blake3 = "1"
stl_io = "0.7"
tobj = "4"
threemf = "0.5"
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS (first build fetches crates; 2–5 min cold).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "phase3: add tokio/walkdir/blake3/stl_io/tobj/threemf deps"
```

---

## Task 2: Schema migration v2 — test-first

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`

- [ ] **Step 1: Add a fresh-DB migration test**

Append at the bottom of `src-tauri/src/db/migrations.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn open_memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode = MEMORY; PRAGMA foreign_keys = ON;",
        ).unwrap();
        conn
    }

    #[test]
    fn fresh_db_ends_at_latest_version() {
        let mut conn = open_memory();
        run(&mut conn).unwrap();

        let versions: Vec<i64> = conn
            .prepare("SELECT version FROM schema_version ORDER BY version")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(versions, vec![1, 2]);

        // files + mesh_metadata exist
        let has = |t: &str| -> bool {
            conn.query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
                [t],
                |_| Ok(()),
            ).is_ok()
        };
        assert!(has("libraries"));
        assert!(has("files"));
        assert!(has("mesh_metadata"));
    }

    #[test]
    fn upgrade_from_v1_only_db() {
        // Simulate a Phase-2 DB that only has v1 applied.
        let mut conn = open_memory();
        conn.execute_batch(
            "CREATE TABLE schema_version (version INTEGER PRIMARY KEY);\n\
             INSERT INTO schema_version (version) VALUES (1);\n\
             CREATE TABLE libraries (
               id       INTEGER PRIMARY KEY AUTOINCREMENT,
               path     TEXT    NOT NULL UNIQUE,
               name     TEXT    NOT NULL,
               added_at INTEGER NOT NULL
             );",
        ).unwrap();

        run(&mut conn).unwrap();

        let max: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(max, 2);
    }

    #[test]
    fn mesh_metadata_check_constraint_rejects_all_null_geometry() {
        // A row with no parse_error AND no bbox must fail the CHECK constraint.
        let mut conn = open_memory();
        run(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO libraries (path, name, added_at) VALUES ('/tmp/x', 'x', 0);\n\
             INSERT INTO files (library_id, rel_path, name, extension,\
                                size_bytes, mtime_ms, scanned_at, cache_key)\n\
             VALUES (1, 'a.stl', 'a.stl', 'stl', 0, 0, 0, 'k');",
        ).unwrap();
        let err = conn.execute(
            "INSERT INTO mesh_metadata (file_id, computed_at) VALUES (1, 0)",
            [],
        );
        assert!(err.is_err(), "CHECK constraint should reject the row");
    }

    #[test]
    fn mesh_metadata_accepts_parse_error_row() {
        let mut conn = open_memory();
        run(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO libraries (path, name, added_at) VALUES ('/tmp/x', 'x', 0);\n\
             INSERT INTO files (library_id, rel_path, name, extension,\
                                size_bytes, mtime_ms, scanned_at, cache_key)\n\
             VALUES (1, 'a.stl', 'a.stl', 'stl', 0, 0, 0, 'k');",
        ).unwrap();
        conn.execute(
            "INSERT INTO mesh_metadata (file_id, computed_at, parse_error)\n\
             VALUES (1, 0, 'bad header')",
            [],
        ).unwrap();
    }
}
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml migrations::tests`
Expected: `fresh_db_ends_at_latest_version` FAILs (MIGRATIONS only has index 0 so MAX(version)=1); others fail because `files`/`mesh_metadata` don't exist.

- [ ] **Step 3: Append migration v2 SQL**

Edit `src-tauri/src/db/migrations.rs`. Change the `MIGRATIONS` constant from:

```rust
const MIGRATIONS: &[&str] = &[
    // v1 — libraries table. Matches PLAN.md §4.
    r#"
    CREATE TABLE libraries (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      path     TEXT    NOT NULL UNIQUE,
      name     TEXT    NOT NULL,
      added_at INTEGER NOT NULL
    );
    "#,
];
```

to:

```rust
const MIGRATIONS: &[&str] = &[
    // v1 — libraries table. Matches PLAN.md §4.
    r#"
    CREATE TABLE libraries (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      path     TEXT    NOT NULL UNIQUE,
      name     TEXT    NOT NULL,
      added_at INTEGER NOT NULL
    );
    "#,
    // v2 — files + mesh_metadata. bbox_* / triangle_count nullable under a
    // CHECK constraint so parse_error rows can exist without sentinel zeros.
    r#"
    CREATE TABLE files (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      library_id   INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      rel_path     TEXT    NOT NULL,
      name         TEXT    NOT NULL,
      extension    TEXT    NOT NULL,
      size_bytes   INTEGER NOT NULL,
      mtime_ms     INTEGER NOT NULL,
      scanned_at   INTEGER NOT NULL,
      cache_key    TEXT    NOT NULL,
      UNIQUE(library_id, rel_path)
    );
    CREATE INDEX idx_files_library   ON files(library_id);
    CREATE INDEX idx_files_name      ON files(name COLLATE NOCASE);
    CREATE INDEX idx_files_mtime     ON files(mtime_ms);
    CREATE INDEX idx_files_size      ON files(size_bytes);
    CREATE INDEX idx_files_cache_key ON files(cache_key);

    CREATE TABLE mesh_metadata (
      file_id          INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      bbox_min_x       REAL, bbox_min_y       REAL, bbox_min_z       REAL,
      bbox_max_x       REAL, bbox_max_y       REAL, bbox_max_z       REAL,
      volume_mm3       REAL,
      surface_area_mm2 REAL,
      triangle_count   INTEGER,
      computed_at      INTEGER NOT NULL,
      parse_error      TEXT,
      CHECK (
        parse_error IS NOT NULL
        OR (bbox_min_x IS NOT NULL AND bbox_min_y IS NOT NULL AND bbox_min_z IS NOT NULL
            AND bbox_max_x IS NOT NULL AND bbox_max_y IS NOT NULL AND bbox_max_z IS NOT NULL
            AND triangle_count IS NOT NULL)
      )
    );
    "#,
];
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml migrations::tests`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/migrations.rs
git commit -m "phase3: add migration v2 (files + mesh_metadata, CHECK constraint)"
```

---

## Task 3: types.rs — FileQuery, MeshMetadata, FileDetails, event payloads

**Files:**
- Modify: `src-tauri/src/types.rs`

- [ ] **Step 1: Replace `src-tauri/src/types.rs` with the full set of types**

Write the full file:

```rust
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
pub struct MetadataReadyEvent {
    #[ts(type = "number")]
    pub file_id: i64,
    pub metadata: MeshMetadata,
}
```

- [ ] **Step 2: Regenerate bindings and confirm they compile**

Run: `pnpm bindings`
Expected: new `.ts` files appear under `src/generated/` for each new type. No errors.

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/types.rs src/generated/
git commit -m "phase3: add FileQuery, MeshMetadata, FileDetails, event payload types"
```

---

## Task 4: events.rs — namespaced emit helpers

**Files:**
- Create: `src-tauri/src/events.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod events;`)

- [ ] **Step 1: Create `src-tauri/src/events.rs`**

```rust
use tauri::{AppHandle, Emitter};

use crate::types::{
    FilesAddedEvent, MetadataReadyEvent, ScanCompletedEvent, ScanErrorEvent,
    ScanProgressEvent, ScanStartedEvent,
};

// Event names live here so no caller can accidentally typo "scan:strted".
pub const SCAN_STARTED: &str = "scan:started";
pub const SCAN_PROGRESS: &str = "scan:progress";
pub const SCAN_COMPLETED: &str = "scan:completed";
pub const SCAN_ERROR: &str = "scan:error";
pub const FILES_ADDED: &str = "files:added";
pub const METADATA_READY: &str = "metadata:ready";

// `Emitter` is Tauri 2's trait that puts `.emit` on AppHandle. Errors are
// logged and swallowed — emit failures mean the webview is gone, in which
// case there's nothing we can do.
pub fn scan_started(app: &AppHandle, library_id: i64) {
    let _ = app.emit(SCAN_STARTED, ScanStartedEvent { library_id });
}

pub fn scan_progress(app: &AppHandle, library_id: i64, scanned: u64) {
    let _ = app.emit(SCAN_PROGRESS, ScanProgressEvent { library_id, scanned });
}

pub fn scan_completed(app: &AppHandle, library_id: i64, total: u64) {
    let _ = app.emit(SCAN_COMPLETED, ScanCompletedEvent { library_id, total });
}

pub fn scan_error(app: &AppHandle, library_id: i64, message: String) {
    let _ = app.emit(SCAN_ERROR, ScanErrorEvent { library_id, message });
}

pub fn files_added(app: &AppHandle, files: Vec<crate::types::FileEntry>) {
    let _ = app.emit(FILES_ADDED, FilesAddedEvent { files });
}

pub fn metadata_ready(app: &AppHandle, file_id: i64, metadata: crate::types::MeshMetadata) {
    let _ = app.emit(METADATA_READY, MetadataReadyEvent { file_id, metadata });
}
```

- [ ] **Step 2: Register the module in lib.rs**

In `src-tauri/src/lib.rs`, at the top (module declarations), change:

```rust
mod db;
mod error;
mod ipc;
mod state;
mod types;
```

to:

```rust
mod db;
mod error;
mod events;
mod ipc;
mod mesh;
mod scan;
mod state;
mod types;
```

(The `mesh` and `scan` modules are added here now so subsequent tasks can just create their files and have them compile.)

- [ ] **Step 3: Create empty module stubs so lib.rs compiles**

Create `src-tauri/src/scan/mod.rs`:

```rust
// Populated in later tasks.
pub mod walker;
```

Create `src-tauri/src/scan/walker.rs`:

```rust
// Populated in Task 12.
```

Create `src-tauri/src/mesh/mod.rs`:

```rust
// Populated in later tasks.
pub mod metrics;
pub mod stl;
pub mod obj;
pub mod threemf;
```

Create `src-tauri/src/mesh/metrics.rs`, `src-tauri/src/mesh/stl.rs`, `src-tauri/src/mesh/obj.rs`, `src-tauri/src/mesh/threemf.rs` — each with a single comment line:

```rust
// Populated in later tasks.
```

- [ ] **Step 4: Verify the tree compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/events.rs src-tauri/src/lib.rs src-tauri/src/scan/ src-tauri/src/mesh/
git commit -m "phase3: add events.rs helpers and module skeletons for scan/mesh"
```

---

## Task 5: db/files.rs — test-first

**Files:**
- Create: `src-tauri/src/db/files.rs`
- Modify: `src-tauri/src/db/mod.rs`

- [ ] **Step 1: Register the module in `db/mod.rs`**

Change:

```rust
pub mod libraries;
pub mod migrations;
```

to:

```rust
pub mod files;
pub mod libraries;
pub mod mesh;
pub mod migrations;
```

(`mesh` added now too — Task 6 will populate it. Until then, create an empty stub file so the compile keeps working.)

Create `src-tauri/src/db/mesh.rs` with one line:

```rust
// Populated in Task 6.
```

- [ ] **Step 2: Create `src-tauri/src/db/files.rs` with failing tests + skeleton**

```rust
use rusqlite::{params, Connection, ToSql};

use crate::error::IpcError;
use crate::types::{FileEntry, FileQuery, SortDirection, SortKey};

// FileRow is the pre-DB shape the scanner emits: everything we know about a
// file before it has an `id`. insert_files_batch turns these into FileEntry
// rows.
#[derive(Debug, Clone)]
pub struct FileRow {
    pub library_id: i64,
    pub rel_path: String,
    pub name: String,
    pub extension: String,
    pub size_bytes: i64,
    pub mtime_ms: i64,
    pub scanned_at: i64,
    pub cache_key: String,
}

// NeedsMetadata is the per-file shape mesh parsing needs to locate the bytes.
pub struct NeedsMetadata {
    pub id: i64,
    pub abs_path: String, // library.path + "/" + rel_path
    pub extension: String,
}

pub fn insert_files_batch(
    conn: &Connection,
    rows: &[FileRow],
) -> Result<Vec<FileEntry>, IpcError> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    // Transaction so the batch is atomic — a mid-batch error leaves the DB
    // untouched. Post-insert we re-query by (library_id, cache_key) for each
    // row that was actually inserted (changes() returns 1 vs 0 on IGNORE).
    let tx = conn.unchecked_transaction()?;
    let mut inserted_keys: Vec<(i64, String)> = Vec::new();
    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO files\n\
             (library_id, rel_path, name, extension, size_bytes, mtime_ms, scanned_at, cache_key)\n\
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        for row in rows {
            let changed = stmt.execute(params![
                row.library_id,
                row.rel_path,
                row.name,
                row.extension,
                row.size_bytes,
                row.mtime_ms,
                row.scanned_at,
                row.cache_key,
            ])?;
            if changed == 1 {
                inserted_keys.push((row.library_id, row.cache_key.clone()));
            }
        }
    }
    tx.commit()?;

    // Re-query the inserted rows in one shot. Using (library_id, cache_key)
    // avoids relying on rowid monotonicity under WAL.
    let mut out = Vec::with_capacity(inserted_keys.len());
    for (library_id, cache_key) in inserted_keys {
        let entry: FileEntry = conn.query_row(
            "SELECT id, library_id, rel_path, name, extension, size_bytes, mtime_ms, cache_key\n\
             FROM files WHERE library_id = ?1 AND cache_key = ?2",
            params![library_id, cache_key],
            |row| Ok(FileEntry {
                id: row.get(0)?,
                library_id: row.get(1)?,
                rel_path: row.get(2)?,
                name: row.get(3)?,
                extension: row.get(4)?,
                size_bytes: row.get(5)?,
                mtime_ms: row.get(6)?,
                cache_key: row.get(7)?,
            }),
        )?;
        out.push(entry);
    }
    Ok(out)
}

pub fn list_files(conn: &Connection, query: &FileQuery) -> Result<Vec<FileEntry>, IpcError> {
    let order = match (query.sort.key, query.sort.direction) {
        (SortKey::Name,   SortDirection::Asc)  => "name COLLATE NOCASE ASC",
        (SortKey::Name,   SortDirection::Desc) => "name COLLATE NOCASE DESC",
        (SortKey::Size,   SortDirection::Asc)  => "size_bytes ASC",
        (SortKey::Size,   SortDirection::Desc) => "size_bytes DESC",
        (SortKey::Mtime,  SortDirection::Asc)  => "mtime_ms ASC",
        (SortKey::Mtime,  SortDirection::Desc) => "mtime_ms DESC",
        (SortKey::Format, SortDirection::Asc)  => "extension ASC, name COLLATE NOCASE ASC",
        (SortKey::Format, SortDirection::Desc) => "extension DESC, name COLLATE NOCASE DESC",
    };

    let mut sql = String::from(
        "SELECT id, library_id, rel_path, name, extension, size_bytes, mtime_ms, cache_key \
         FROM files WHERE 1=1",
    );
    let mut args: Vec<Box<dyn ToSql>> = Vec::new();
    if let Some(lib) = query.library_id {
        sql.push_str(" AND library_id = ?");
        args.push(Box::new(lib));
    }
    if !query.search.trim().is_empty() {
        sql.push_str(" AND name LIKE ? COLLATE NOCASE");
        args.push(Box::new(format!("%{}%", query.search.trim())));
    }
    sql.push_str(" ORDER BY ");
    sql.push_str(order);

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let rows: rusqlite::Result<Vec<FileEntry>> = stmt
        .query_map(rusqlite::params_from_iter(param_refs.iter()), |row| {
            Ok(FileEntry {
                id: row.get(0)?,
                library_id: row.get(1)?,
                rel_path: row.get(2)?,
                name: row.get(3)?,
                extension: row.get(4)?,
                size_bytes: row.get(5)?,
                mtime_ms: row.get(6)?,
                cache_key: row.get(7)?,
            })
        })?
        .collect();
    Ok(rows?)
}

pub fn get_by_id(conn: &Connection, id: i64) -> Result<FileEntry, IpcError> {
    conn.query_row(
        "SELECT id, library_id, rel_path, name, extension, size_bytes, mtime_ms, cache_key\n\
         FROM files WHERE id = ?1",
        params![id],
        |row| Ok(FileEntry {
            id: row.get(0)?,
            library_id: row.get(1)?,
            rel_path: row.get(2)?,
            name: row.get(3)?,
            extension: row.get(4)?,
            size_bytes: row.get(5)?,
            mtime_ms: row.get(6)?,
            cache_key: row.get(7)?,
        }),
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => IpcError::NotFound(format!("file id {id}")),
        other => other.into(),
    })
}

pub fn list_needing_metadata(
    conn: &Connection,
    library_id: i64,
) -> Result<Vec<NeedsMetadata>, IpcError> {
    let mut stmt = conn.prepare(
        "SELECT f.id, l.path, f.rel_path, f.extension\n\
         FROM files f\n\
         JOIN libraries l ON l.id = f.library_id\n\
         WHERE f.library_id = ?1 AND f.id NOT IN (SELECT file_id FROM mesh_metadata)",
    )?;
    let rows: rusqlite::Result<Vec<NeedsMetadata>> = stmt
        .query_map(params![library_id], |row| {
            let lib_path: String = row.get(1)?;
            let rel: String = row.get(2)?;
            Ok(NeedsMetadata {
                id: row.get(0)?,
                abs_path: format!("{}/{}", lib_path.trim_end_matches('/'), rel),
                extension: row.get(3)?,
            })
        })?
        .collect();
    Ok(rows?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use crate::types::{Sort, SortDirection, SortKey};

    fn setup() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrations::run(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO libraries (path, name, added_at) VALUES (?1, ?2, ?3)",
            params!["/tmp/lib", "lib", 0i64],
        )
        .unwrap();
        conn
    }

    fn row(name: &str, ext: &str, size: i64, cache_key: &str) -> FileRow {
        FileRow {
            library_id: 1,
            rel_path: format!("sub/{name}.{ext}"),
            name: format!("{name}.{ext}"),
            extension: ext.to_string(),
            size_bytes: size,
            mtime_ms: 123,
            scanned_at: 456,
            cache_key: cache_key.to_string(),
        }
    }

    fn q(library_id: Option<i64>, key: SortKey, search: &str) -> FileQuery {
        FileQuery {
            library_id,
            sort: Sort { key, direction: SortDirection::Asc },
            search: search.to_string(),
        }
    }

    #[test]
    fn batch_insert_returns_new_rows_only() {
        let conn = setup();
        let rows = vec![
            row("a", "stl", 10, "ka"),
            row("b", "obj", 20, "kb"),
        ];
        let first = insert_files_batch(&conn, &rows).unwrap();
        assert_eq!(first.len(), 2);
        assert!(first[0].id > 0);

        // Re-inserting the same rows must be a no-op thanks to UNIQUE(library_id, rel_path).
        let second = insert_files_batch(&conn, &rows).unwrap();
        assert_eq!(second.len(), 0);
    }

    #[test]
    fn list_filters_by_library_and_search_and_sort() {
        let conn = setup();
        insert_files_batch(
            &conn,
            &[
                row("Apple", "stl", 30, "k1"),
                row("banana", "obj", 10, "k2"),
                row("cherry", "3mf", 20, "k3"),
            ],
        )
        .unwrap();

        // library filter
        assert_eq!(list_files(&conn, &q(Some(1), SortKey::Name, "")).unwrap().len(), 3);
        assert_eq!(list_files(&conn, &q(Some(999), SortKey::Name, "")).unwrap().len(), 0);

        // search (NOCASE)
        let r = list_files(&conn, &q(Some(1), SortKey::Name, "APP")).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].name, "Apple.stl");

        // sort by size ASC: banana(10), cherry(20), Apple(30)
        let r = list_files(&conn, &q(Some(1), SortKey::Size, "")).unwrap();
        let order: Vec<&str> = r.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(order, vec!["banana.obj", "cherry.3mf", "Apple.stl"]);
    }

    #[test]
    fn list_needing_metadata_excludes_files_with_rows() {
        let conn = setup();
        let inserted = insert_files_batch(
            &conn,
            &[row("a", "stl", 10, "ka"), row("b", "stl", 20, "kb")],
        )
        .unwrap();
        // Mark only the first as having metadata.
        conn.execute(
            "INSERT INTO mesh_metadata (file_id, computed_at, parse_error) VALUES (?1, 0, 'x')",
            params![inserted[0].id],
        )
        .unwrap();

        let pending = list_needing_metadata(&conn, 1).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, inserted[1].id);
        assert_eq!(pending[0].extension, "stl");
        assert_eq!(pending[0].abs_path, "/tmp/lib/sub/b.stl");
    }
}
```

- [ ] **Step 3: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::files::tests`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/files.rs src-tauri/src/db/mod.rs src-tauri/src/db/mesh.rs
git commit -m "phase3: add db::files (insert_files_batch, list_files, list_needing_metadata)"
```

---

## Task 6: db/mesh.rs — test-first

**Files:**
- Modify: `src-tauri/src/db/mesh.rs`

- [ ] **Step 1: Replace `src-tauri/src/db/mesh.rs` with the full module + tests**

```rust
use rusqlite::{params, Connection};

use crate::error::IpcError;
use crate::types::MeshMetadata;

/// Result of parsing a mesh (geometric data) or a parse failure string.
/// Pass `Ok(metrics)` or `Err(msg)` into `upsert_metadata`.
pub struct MeshMetricsRow {
    pub bbox_min: [f64; 3],
    pub bbox_max: [f64; 3],
    pub triangle_count: i64,
    pub surface_area_mm2: f64,
    pub volume_mm3: Option<f64>,
}

pub fn upsert_metadata(
    conn: &Connection,
    file_id: i64,
    outcome: Result<MeshMetricsRow, String>,
    computed_at: i64,
) -> Result<MeshMetadata, IpcError> {
    match outcome {
        Ok(m) => {
            conn.execute(
                "INSERT INTO mesh_metadata (\n\
                   file_id,\n\
                   bbox_min_x, bbox_min_y, bbox_min_z,\n\
                   bbox_max_x, bbox_max_y, bbox_max_z,\n\
                   triangle_count, surface_area_mm2, volume_mm3,\n\
                   computed_at, parse_error\n\
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,NULL)\n\
                 ON CONFLICT(file_id) DO UPDATE SET\n\
                   bbox_min_x=excluded.bbox_min_x, bbox_min_y=excluded.bbox_min_y, bbox_min_z=excluded.bbox_min_z,\n\
                   bbox_max_x=excluded.bbox_max_x, bbox_max_y=excluded.bbox_max_y, bbox_max_z=excluded.bbox_max_z,\n\
                   triangle_count=excluded.triangle_count,\n\
                   surface_area_mm2=excluded.surface_area_mm2,\n\
                   volume_mm3=excluded.volume_mm3,\n\
                   computed_at=excluded.computed_at,\n\
                   parse_error=NULL",
                params![
                    file_id,
                    m.bbox_min[0], m.bbox_min[1], m.bbox_min[2],
                    m.bbox_max[0], m.bbox_max[1], m.bbox_max[2],
                    m.triangle_count,
                    m.surface_area_mm2,
                    m.volume_mm3,
                    computed_at,
                ],
            )?;
            Ok(MeshMetadata {
                bbox_min: Some(m.bbox_min),
                bbox_max: Some(m.bbox_max),
                triangle_count: Some(m.triangle_count),
                surface_area_mm2: Some(m.surface_area_mm2),
                volume_mm3: m.volume_mm3,
                computed_at,
                parse_error: None,
            })
        }
        Err(msg) => {
            conn.execute(
                "INSERT INTO mesh_metadata (file_id, computed_at, parse_error)\n\
                 VALUES (?1, ?2, ?3)\n\
                 ON CONFLICT(file_id) DO UPDATE SET\n\
                   bbox_min_x=NULL, bbox_min_y=NULL, bbox_min_z=NULL,\n\
                   bbox_max_x=NULL, bbox_max_y=NULL, bbox_max_z=NULL,\n\
                   triangle_count=NULL, surface_area_mm2=NULL, volume_mm3=NULL,\n\
                   computed_at=excluded.computed_at, parse_error=excluded.parse_error",
                params![file_id, computed_at, msg],
            )?;
            Ok(MeshMetadata {
                bbox_min: None,
                bbox_max: None,
                triangle_count: None,
                surface_area_mm2: None,
                volume_mm3: None,
                computed_at,
                parse_error: Some(msg),
            })
        }
    }
}

pub fn get_for_file(conn: &Connection, file_id: i64) -> Result<Option<MeshMetadata>, IpcError> {
    let res = conn.query_row(
        "SELECT bbox_min_x, bbox_min_y, bbox_min_z,\n\
                bbox_max_x, bbox_max_y, bbox_max_z,\n\
                triangle_count, surface_area_mm2, volume_mm3,\n\
                computed_at, parse_error\n\
         FROM mesh_metadata WHERE file_id = ?1",
        params![file_id],
        |row| {
            let min_x: Option<f64> = row.get(0)?;
            let min_y: Option<f64> = row.get(1)?;
            let min_z: Option<f64> = row.get(2)?;
            let max_x: Option<f64> = row.get(3)?;
            let max_y: Option<f64> = row.get(4)?;
            let max_z: Option<f64> = row.get(5)?;
            let bbox_min = match (min_x, min_y, min_z) {
                (Some(x), Some(y), Some(z)) => Some([x, y, z]),
                _ => None,
            };
            let bbox_max = match (max_x, max_y, max_z) {
                (Some(x), Some(y), Some(z)) => Some([x, y, z]),
                _ => None,
            };
            Ok(MeshMetadata {
                bbox_min,
                bbox_max,
                triangle_count: row.get(6)?,
                surface_area_mm2: row.get(7)?,
                volume_mm3: row.get(8)?,
                computed_at: row.get(9)?,
                parse_error: row.get(10)?,
            })
        },
    );
    match res {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use crate::db::files::{insert_files_batch, FileRow};

    fn setup() -> (Connection, i64) {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrations::run(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO libraries (path, name, added_at) VALUES ('/tmp/lib', 'lib', 0)",
            [],
        )
        .unwrap();
        let inserted = insert_files_batch(
            &conn,
            &[FileRow {
                library_id: 1,
                rel_path: "a.stl".into(),
                name: "a.stl".into(),
                extension: "stl".into(),
                size_bytes: 1,
                mtime_ms: 1,
                scanned_at: 1,
                cache_key: "k".into(),
            }],
        )
        .unwrap();
        (conn, inserted[0].id)
    }

    #[test]
    fn upsert_success_then_read_back() {
        let (conn, file_id) = setup();
        let metrics = MeshMetricsRow {
            bbox_min: [0.0, 0.0, 0.0],
            bbox_max: [1.0, 2.0, 3.0],
            triangle_count: 12,
            surface_area_mm2: 6.0,
            volume_mm3: Some(6.0),
        };
        let m = upsert_metadata(&conn, file_id, Ok(metrics), 999).unwrap();
        assert_eq!(m.bbox_max, Some([1.0, 2.0, 3.0]));
        assert_eq!(m.triangle_count, Some(12));
        assert!(m.parse_error.is_none());

        let round = get_for_file(&conn, file_id).unwrap().unwrap();
        assert_eq!(round.bbox_max, Some([1.0, 2.0, 3.0]));
        assert_eq!(round.volume_mm3, Some(6.0));
    }

    #[test]
    fn upsert_error_stores_parse_error_only() {
        let (conn, file_id) = setup();
        let m = upsert_metadata(&conn, file_id, Err("bad bytes".into()), 777).unwrap();
        assert!(m.bbox_min.is_none());
        assert_eq!(m.parse_error.as_deref(), Some("bad bytes"));

        let round = get_for_file(&conn, file_id).unwrap().unwrap();
        assert_eq!(round.parse_error.as_deref(), Some("bad bytes"));
    }

    #[test]
    fn upsert_replaces_existing() {
        let (conn, file_id) = setup();
        upsert_metadata(&conn, file_id, Err("first".into()), 1).unwrap();
        let metrics = MeshMetricsRow {
            bbox_min: [-1.0, -1.0, -1.0],
            bbox_max: [1.0, 1.0, 1.0],
            triangle_count: 4,
            surface_area_mm2: 2.0,
            volume_mm3: None,
        };
        upsert_metadata(&conn, file_id, Ok(metrics), 2).unwrap();
        let round = get_for_file(&conn, file_id).unwrap().unwrap();
        assert!(round.parse_error.is_none());
        assert_eq!(round.triangle_count, Some(4));
    }

    #[test]
    fn get_for_file_returns_none_when_missing() {
        let (conn, _) = setup();
        assert!(get_for_file(&conn, 9999).unwrap().is_none());
    }
}
```

- [ ] **Step 2: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::mesh::tests`
Expected: 4 passed.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db/mesh.rs
git commit -m "phase3: add db::mesh (upsert_metadata, get_for_file) with CHECK-compatible nulling"
```

---

## Task 7: mesh/metrics.rs — test-first

**Files:**
- Modify: `src-tauri/src/mesh/metrics.rs`

- [ ] **Step 1: Replace `src-tauri/src/mesh/metrics.rs`**

```rust
use std::collections::HashMap;

use crate::db::mesh::MeshMetricsRow;

pub type Tri = [[f64; 3]; 3];

/// Accepts a slice of triangles (each three vertices in world-space mm) and
/// returns bbox, triangle count, surface area (always), and volume (only if
/// the mesh is edge-watertight — every canonical edge appears exactly twice).
pub fn compute(triangles: &[Tri]) -> MeshMetricsRow {
    let triangle_count = triangles.len() as i64;

    let mut bbox_min = [f64::INFINITY; 3];
    let mut bbox_max = [f64::NEG_INFINITY; 3];
    let mut area = 0.0f64;
    let mut signed_volume_sum = 0.0f64;

    // Edge -> count for watertight check. Canonical order (min,max) so
    // opposing half-edges share a bucket.
    let mut edges: HashMap<(u64, u64), u32> = HashMap::new();

    for tri in triangles {
        for v in tri {
            for i in 0..3 {
                if v[i] < bbox_min[i] { bbox_min[i] = v[i]; }
                if v[i] > bbox_max[i] { bbox_max[i] = v[i]; }
            }
        }
        let a = tri[0];
        let b = tri[1];
        let c = tri[2];

        // Area: 0.5 * |AB × AC|
        let ab = sub(b, a);
        let ac = sub(c, a);
        area += 0.5 * length(cross(ab, ac));

        // Signed volume (divergence theorem): a · (b × c) / 6
        signed_volume_sum += dot(a, cross(b, c)) / 6.0;

        // Quantize vertices so equal coords hash identically.
        let ka = quantize(a);
        let kb = quantize(b);
        let kc = quantize(c);
        for (p, q) in [(ka, kb), (kb, kc), (kc, ka)] {
            let e = if p <= q { (p, q) } else { (q, p) };
            *edges.entry(e).or_insert(0) += 1;
        }
    }

    if triangles.is_empty() {
        bbox_min = [0.0; 3];
        bbox_max = [0.0; 3];
    }

    let watertight = !edges.is_empty() && edges.values().all(|&c| c == 2);
    let volume_mm3 = if watertight { Some(signed_volume_sum.abs()) } else { None };

    MeshMetricsRow {
        bbox_min,
        bbox_max,
        triangle_count,
        surface_area_mm2: area,
        volume_mm3,
    }
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn length(v: [f64; 3]) -> f64 {
    (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt()
}

// 1e-5 mm quantization — tight enough for mesh-printer tolerances, loose
// enough to survive f32 precision in the source files.
fn quantize(p: [f64; 3]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for v in p {
        let q = (v * 100_000.0).round() as i64;
        h ^= q as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    // 12 triangles of a unit cube from (0,0,0) to (1,1,1) with outward normals.
    fn unit_cube() -> Vec<Tri> {
        let v = |x: f64, y: f64, z: f64| [x, y, z];
        let a = v(0.0, 0.0, 0.0);
        let b = v(1.0, 0.0, 0.0);
        let c = v(1.0, 1.0, 0.0);
        let d = v(0.0, 1.0, 0.0);
        let e = v(0.0, 0.0, 1.0);
        let f = v(1.0, 0.0, 1.0);
        let g = v(1.0, 1.0, 1.0);
        let h = v(0.0, 1.0, 1.0);
        vec![
            // bottom (z=0, outward -z): reversed winding
            [a, c, b], [a, d, c],
            // top (z=1, outward +z)
            [e, f, g], [e, g, h],
            // front (y=0, outward -y)
            [a, b, f], [a, f, e],
            // back (y=1, outward +y)
            [d, h, g], [d, g, c],
            // left (x=0, outward -x)
            [a, e, h], [a, h, d],
            // right (x=1, outward +x)
            [b, c, g], [b, g, f],
        ]
    }

    #[test]
    fn cube_metrics() {
        let m = compute(&unit_cube());
        assert_eq!(m.triangle_count, 12);
        assert_eq!(m.bbox_min, [0.0, 0.0, 0.0]);
        assert_eq!(m.bbox_max, [1.0, 1.0, 1.0]);
        assert!((m.surface_area_mm2 - 6.0).abs() < 1e-9);
        assert!(matches!(m.volume_mm3, Some(v) if (v - 1.0).abs() < 1e-9));
    }

    #[test]
    fn single_triangle_is_not_watertight() {
        let tri: Tri = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let m = compute(&[tri]);
        assert_eq!(m.triangle_count, 1);
        assert!((m.surface_area_mm2 - 0.5).abs() < 1e-9);
        assert!(m.volume_mm3.is_none());
    }

    #[test]
    fn empty_mesh_degenerates_gracefully() {
        let m = compute(&[]);
        assert_eq!(m.triangle_count, 0);
        assert_eq!(m.bbox_min, [0.0, 0.0, 0.0]);
        assert_eq!(m.bbox_max, [0.0, 0.0, 0.0]);
        assert_eq!(m.surface_area_mm2, 0.0);
        assert!(m.volume_mm3.is_none());
    }
}
```

- [ ] **Step 2: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mesh::metrics::tests`
Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/mesh/metrics.rs
git commit -m "phase3: add mesh::metrics (bbox, area, watertight volume) with cube+tetra tests"
```

---

## Task 8: mesh/stl.rs — test-first

**Files:**
- Modify: `src-tauri/src/mesh/stl.rs`

- [ ] **Step 1: Replace `src-tauri/src/mesh/stl.rs`**

```rust
use std::io::Cursor;

use crate::mesh::metrics::Tri;

pub fn parse(bytes: &[u8]) -> Result<Vec<Tri>, String> {
    let mut cursor = Cursor::new(bytes);
    let mesh = stl_io::read_stl(&mut cursor).map_err(|e| format!("stl: {e}"))?;

    let verts: Vec<[f64; 3]> = mesh
        .vertices
        .iter()
        .map(|v| [v[0] as f64, v[1] as f64, v[2] as f64])
        .collect();

    let mut out = Vec::with_capacity(mesh.faces.len());
    for face in &mesh.faces {
        let [i, j, k] = face.vertices;
        if i >= verts.len() || j >= verts.len() || k >= verts.len() {
            return Err("stl: face index out of bounds".into());
        }
        out.push([verts[i], verts[j], verts[k]]);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::metrics;

    // Builds a binary STL for a single triangle. Binary STL layout:
    //   80 bytes header, 4 bytes u32 triangle count,
    //   then per-triangle: 12 f32s (normal+3 verts) + u16 attr.
    fn binary_stl_single_triangle() -> Vec<u8> {
        let mut out = vec![0u8; 80];
        out.extend_from_slice(&1u32.to_le_bytes()); // triangle count
        // normal
        for _ in 0..3 { out.extend_from_slice(&0f32.to_le_bytes()); }
        // v0
        out.extend_from_slice(&0f32.to_le_bytes());
        out.extend_from_slice(&0f32.to_le_bytes());
        out.extend_from_slice(&0f32.to_le_bytes());
        // v1
        out.extend_from_slice(&1f32.to_le_bytes());
        out.extend_from_slice(&0f32.to_le_bytes());
        out.extend_from_slice(&0f32.to_le_bytes());
        // v2
        out.extend_from_slice(&0f32.to_le_bytes());
        out.extend_from_slice(&1f32.to_le_bytes());
        out.extend_from_slice(&0f32.to_le_bytes());
        // attr
        out.extend_from_slice(&0u16.to_le_bytes());
        out
    }

    #[test]
    fn parses_single_triangle_binary_stl() {
        let bytes = binary_stl_single_triangle();
        let tris = parse(&bytes).expect("parse failed");
        assert_eq!(tris.len(), 1);
        let m = metrics::compute(&tris);
        assert_eq!(m.triangle_count, 1);
        assert!((m.surface_area_mm2 - 0.5).abs() < 1e-6);
    }

    #[test]
    fn garbage_bytes_return_err() {
        let err = parse(b"not an stl file").unwrap_err();
        assert!(err.starts_with("stl: "));
    }
}
```

- [ ] **Step 2: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mesh::stl::tests`
Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/mesh/stl.rs
git commit -m "phase3: stl parser via stl_io, normalized to Vec<Tri>"
```

---

## Task 9: mesh/obj.rs — test-first

**Files:**
- Modify: `src-tauri/src/mesh/obj.rs`

- [ ] **Step 1: Replace `src-tauri/src/mesh/obj.rs`**

```rust
use std::io::Cursor;

use crate::mesh::metrics::Tri;

pub fn parse(bytes: &[u8]) -> Result<Vec<Tri>, String> {
    // tobj's load_obj_buf takes a material loader. We always reject MTLs —
    // this app only cares about geometry.
    let (models, _materials) = tobj::load_obj_buf(
        &mut Cursor::new(bytes),
        &tobj::LoadOptions {
            triangulate: true,
            single_index: true,
            ..Default::default()
        },
        |_| Err(tobj::LoadError::GenericFailure),
    )
    .map_err(|e| format!("obj: {e}"))?;

    let mut out = Vec::new();
    for model in &models {
        let pos = &model.mesh.positions; // flat [x0,y0,z0,x1,...]
        let idx = &model.mesh.indices;
        if idx.len() % 3 != 0 {
            return Err("obj: non-triangulated face".into());
        }
        for tri in idx.chunks_exact(3) {
            let mut verts = [[0.0f64; 3]; 3];
            for (k, &i) in tri.iter().enumerate() {
                let i = i as usize;
                let base = i.checked_mul(3).ok_or("obj: index overflow")?;
                if base + 2 >= pos.len() {
                    return Err("obj: index out of bounds".into());
                }
                verts[k] = [pos[base] as f64, pos[base + 1] as f64, pos[base + 2] as f64];
            }
            out.push(verts);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::metrics;

    #[test]
    fn parses_minimal_triangle_obj() {
        let bytes = b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
        let tris = parse(bytes).expect("parse failed");
        assert_eq!(tris.len(), 1);
        let m = metrics::compute(&tris);
        assert!((m.surface_area_mm2 - 0.5).abs() < 1e-6);
    }

    #[test]
    fn parses_quad_via_triangulation() {
        let bytes =
            b"v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n";
        let tris = parse(bytes).expect("parse failed");
        assert_eq!(tris.len(), 2);
        let m = metrics::compute(&tris);
        assert!((m.surface_area_mm2 - 1.0).abs() < 1e-6);
    }

    #[test]
    fn garbage_bytes_return_err() {
        let err = parse(b"\x00\x01\x02garbage").unwrap_err();
        assert!(err.starts_with("obj: "));
    }
}
```

- [ ] **Step 2: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mesh::obj::tests`
Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/mesh/obj.rs
git commit -m "phase3: obj parser via tobj, triangulated + material-free"
```

---

## Task 10: mesh/threemf.rs (no unit test — covered by exit-criterion check)

**Files:**
- Modify: `src-tauri/src/mesh/threemf.rs`

Building a valid 3MF from scratch requires zip + XML, and adding the `zip` crate is out of scope per the forbidden list. The 3MF parser is instead covered end-to-end by the exit-criterion check on a real `.3mf` file, matching the user's Checkpoint 6 ("STL, OBJ, 3MF samples").

- [ ] **Step 1: Replace `src-tauri/src/mesh/threemf.rs`**

```rust
use std::io::Cursor;

use crate::mesh::metrics::Tri;

pub fn parse(bytes: &[u8]) -> Result<Vec<Tri>, String> {
    let models = threemf::read(Cursor::new(bytes)).map_err(|e| format!("3mf: {e}"))?;

    // v1 policy (PLAN §7 "3MF with multiple objects"): merge all meshes in the
    // first model into one logical mesh. Revisit for multi-object support in v2.
    let Some(model) = models.into_iter().next() else {
        return Err("3mf: no models".into());
    };

    let mut out = Vec::new();
    for mesh in &model.resources.object {
        let threemf::model::ObjectData::Mesh(m) = &mesh.mesh else {
            continue; // components, etc — skipped in v1
        };
        let verts: Vec<[f64; 3]> = m
            .vertices
            .vertex
            .iter()
            .map(|v| [v.x, v.y, v.z])
            .collect();
        for tri in &m.triangles.triangle {
            let (i, j, k) = (tri.v1 as usize, tri.v2 as usize, tri.v3 as usize);
            if i >= verts.len() || j >= verts.len() || k >= verts.len() {
                return Err("3mf: face index out of bounds".into());
            }
            out.push([verts[i], verts[j], verts[k]]);
        }
    }

    if out.is_empty() {
        return Err("3mf: no triangles in first model".into());
    }
    Ok(out)
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS. The exact field names on `threemf::model::*` are crate-specific — if the compiler rejects a field (API drift), consult `cargo doc --open -p threemf` and adjust vertex/triangle access; the overall shape is always "Vec vertices + Vec of (u32,u32,u32) triangles."

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/mesh/threemf.rs
git commit -m "phase3: 3mf parser via threemf crate, single-model merge for v1"
```

---

## Task 11: mesh/mod.rs dispatcher

**Files:**
- Modify: `src-tauri/src/mesh/mod.rs`

- [ ] **Step 1: Replace `src-tauri/src/mesh/mod.rs`**

```rust
use std::fs;

use crate::db::mesh::MeshMetricsRow;

pub mod metrics;
pub mod obj;
pub mod stl;
pub mod threemf;

/// Read a file and parse its mesh. Caller provides extension (lowercase).
/// Returns metrics on success, `Err(String)` on any failure; the string is
/// stored in `mesh_metadata.parse_error` so we never retry a broken file.
pub fn parse_file(abs_path: &str, extension: &str) -> Result<MeshMetricsRow, String> {
    let bytes = fs::read(abs_path).map_err(|e| format!("io: {e}"))?;
    let triangles = match extension {
        "stl" => stl::parse(&bytes)?,
        "obj" => obj::parse(&bytes)?,
        "3mf" => threemf::parse(&bytes)?,
        other => return Err(format!("unsupported extension: {other}")),
    };
    Ok(metrics::compute(&triangles))
}
```

- [ ] **Step 2: Build**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/mesh/mod.rs
git commit -m "phase3: mesh::parse_file dispatcher (extension → parser → metrics)"
```

---

## Task 12: scan/walker.rs — test-first

**Files:**
- Modify: `src-tauri/src/scan/walker.rs`

- [ ] **Step 1: Replace `src-tauri/src/scan/walker.rs`**

```rust
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use walkdir::WalkDir;

use crate::db::files::FileRow;

/// Invoked by the walker when a file is found. Callers use it to buffer +
/// batch-flush into SQLite. Returns `true` to continue, `false` to stop.
/// Errors from the callback are propagated back out.
pub type OnFile = dyn FnMut(FileRow) -> std::io::Result<()>;

pub fn walk(library_id: i64, library_path: &Path, on_file: &mut OnFile) -> std::io::Result<u64> {
    let lib_str = library_path.to_string_lossy().to_string();
    let mut count = 0u64;
    for entry in WalkDir::new(library_path).follow_links(true) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue, // skip permission errors, broken symlinks
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let ext_lower = match entry.path().extension() {
            Some(e) => e.to_string_lossy().to_ascii_lowercase(),
            None => continue,
        };
        if !matches!(ext_lower.as_str(), "stl" | "3mf" | "obj") {
            continue;
        }

        let md = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let size = md.len() as i64;
        let mtime_ms = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let abs_str = entry.path().to_string_lossy().to_string();
        let cache_key = compute_cache_key(&abs_str, mtime_ms, size);

        let rel = entry
            .path()
            .strip_prefix(library_path)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| abs_str.clone());
        let name = entry
            .path()
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| rel.clone());

        let scanned_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let row = FileRow {
            library_id,
            rel_path: rel,
            name,
            extension: ext_lower,
            size_bytes: size,
            mtime_ms,
            scanned_at,
            cache_key,
        };
        on_file(row)?;
        count += 1;
        let _ = &lib_str; // keep the variable for symmetry; tree-walking doesn't need it again
    }
    Ok(count)
}

pub fn compute_cache_key(abs_path: &str, mtime_ms: i64, size_bytes: i64) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(abs_path.as_bytes());
    hasher.update(&mtime_ms.to_le_bytes());
    hasher.update(&size_bytes.to_le_bytes());
    hasher.finalize().to_hex().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::PathBuf;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(name: &str) -> Self {
            let mut path = std::env::temp_dir();
            path.push(format!(
                "phase3-walker-{}-{}-{}",
                name,
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }
        fn path(&self) -> &Path { &self.0 }
    }
    impl Drop for TempDir {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    fn touch(dir: &Path, rel: &str, bytes: &[u8]) {
        let p = dir.join(rel);
        if let Some(parent) = p.parent() { fs::create_dir_all(parent).unwrap(); }
        let mut f = File::create(&p).unwrap();
        f.write_all(bytes).unwrap();
    }

    #[test]
    fn walker_filters_by_extension_case_insensitively() {
        let tmp = TempDir::new("ext");
        touch(tmp.path(), "a.stl", b"stl");
        touch(tmp.path(), "sub/B.STL", b"stl");
        touch(tmp.path(), "sub/c.obj", b"obj");
        touch(tmp.path(), "sub/d.3MF", b"3mf");
        touch(tmp.path(), "ignore.txt", b"txt");

        let mut rows: Vec<FileRow> = Vec::new();
        let count = walk(1, tmp.path(), &mut |row| {
            rows.push(row);
            Ok(())
        })
        .unwrap();
        assert_eq!(count, 4);
        assert_eq!(rows.len(), 4);

        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert!(names.contains(&"a.stl"));
        assert!(names.contains(&"B.STL"));
        assert!(names.contains(&"c.obj"));
        assert!(names.contains(&"d.3MF"));

        // extension is always lowercase
        for r in &rows {
            assert!(matches!(r.extension.as_str(), "stl" | "obj" | "3mf"));
        }
    }

    #[test]
    fn cache_key_is_deterministic() {
        let k1 = compute_cache_key("/x/a.stl", 42, 1000);
        let k2 = compute_cache_key("/x/a.stl", 42, 1000);
        assert_eq!(k1, k2);
        let k3 = compute_cache_key("/x/a.stl", 43, 1000);
        assert_ne!(k1, k3);
    }
}
```

- [ ] **Step 2: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml scan::walker::tests`
Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/scan/walker.rs
git commit -m "phase3: walker emits FileRow per supported extension + blake3 cache key"
```

---

## Task 13: scan/mod.rs — orchestration

**Files:**
- Modify: `src-tauri/src/scan/mod.rs`

This task spawns tokio tasks and emits events. It isn't unit-tested in isolation; coverage comes from the exit-criterion check (Checkpoint 5 in the user's prompt).

### Rust concepts first introduced here (briefly)

- `tokio::spawn` — schedules a future on tokio's multi-threaded async runtime; returns a `JoinHandle`.
- `tokio::task::spawn_blocking` — offloads a synchronous/CPU-bound closure to a dedicated blocking threadpool so async tasks aren't stalled. We use it for walkdir and mesh parsing.
- `tokio::sync::Semaphore` — bounds concurrency. `acquire_owned().await` returns a permit that's held for the life of the task, so dropping the task releases the permit.

- [ ] **Step 1: Replace `src-tauri/src/scan/mod.rs`**

```rust
use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rusqlite::params;
use tauri::AppHandle;
use tokio::sync::Semaphore;
use tokio::task::spawn_blocking;

use crate::db;
use crate::db::files::{FileRow, NeedsMetadata};
use crate::error::IpcError;
use crate::events;
use crate::mesh;
use crate::state::AppState;

pub mod walker;

/// Kicks off a scan for `library_id`. Returns quickly; the actual walk +
/// mesh-parse happen in tokio tasks that emit events.
pub fn start_for_library(app: AppHandle, state: Arc<AppState>, library_id: i64) {
    tokio::spawn(async move {
        let library_path: PathBuf = {
            let conn = match state.db.lock() {
                Ok(g) => g,
                Err(e) => {
                    events::scan_error(&app, library_id, format!("db mutex poisoned: {e}"));
                    return;
                }
            };
            match conn.query_row::<String, _, _>(
                "SELECT path FROM libraries WHERE id = ?1",
                params![library_id],
                |r| r.get(0),
            ) {
                Ok(p) => PathBuf::from(p),
                Err(e) => {
                    events::scan_error(&app, library_id, format!("library not found: {e}"));
                    return;
                }
            }
        };

        events::scan_started(&app, library_id);

        // -------- Stage 1: walk + batched insert --------
        let walk_app = app.clone();
        let walk_state = Arc::clone(&state);
        let walk_result = spawn_blocking(move || -> Result<u64, IpcError> {
            let mut buffer: Vec<FileRow> = Vec::with_capacity(128);
            let mut last_flush = Instant::now();
            let mut scanned = 0u64;

            let flush = |state: &AppState,
                         app: &AppHandle,
                         buf: &mut Vec<FileRow>,
                         scanned_total: u64|
             -> Result<(), IpcError> {
                if buf.is_empty() {
                    return Ok(());
                }
                let inserted = {
                    let conn = state
                        .db
                        .lock()
                        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
                    db::files::insert_files_batch(&conn, buf)?
                };
                buf.clear();
                if !inserted.is_empty() {
                    events::files_added(app, inserted);
                }
                events::scan_progress(app, library_id, scanned_total);
                Ok(())
            };

            walker::walk(library_id, &library_path, &mut |row| {
                buffer.push(row);
                scanned += 1;
                if buffer.len() >= 100 || last_flush.elapsed() >= Duration::from_millis(250) {
                    flush(&walk_state, &walk_app, &mut buffer, scanned)
                        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
                    last_flush = Instant::now();
                }
                Ok(())
            })?;
            flush(&walk_state, &walk_app, &mut buffer, scanned)?;
            Ok(scanned)
        })
        .await;

        let total = match walk_result {
            Ok(Ok(n)) => n,
            Ok(Err(e)) => {
                events::scan_error(&app, library_id, e.to_string());
                return;
            }
            Err(e) => {
                events::scan_error(&app, library_id, format!("walker task panicked: {e}"));
                return;
            }
        };

        events::scan_completed(&app, library_id, total);

        // -------- Stage 2: mesh parsing with bounded concurrency --------
        let parallelism = std::thread::available_parallelism()
            .map(NonZeroUsize::get)
            .unwrap_or(1)
            .min(4);
        let sem = Arc::new(Semaphore::new(parallelism));

        let pending: Vec<NeedsMetadata> = {
            let conn = match state.db.lock() {
                Ok(g) => g,
                Err(e) => {
                    events::scan_error(&app, library_id, format!("db mutex poisoned: {e}"));
                    return;
                }
            };
            match db::files::list_needing_metadata(&conn, library_id) {
                Ok(v) => v,
                Err(e) => {
                    events::scan_error(&app, library_id, e.to_string());
                    return;
                }
            }
        };

        for row in pending {
            let permit = match sem.clone().acquire_owned().await {
                Ok(p) => p,
                Err(_) => break, // semaphore closed — shouldn't happen
            };
            let app_c = app.clone();
            let state_c = Arc::clone(&state);
            tokio::spawn(async move {
                let _permit = permit;
                let computed_at = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                let outcome = spawn_blocking(move || {
                    mesh::parse_file(&row.abs_path, &row.extension)
                })
                .await
                .unwrap_or_else(|e| Err(format!("parser task panicked: {e}")));

                let stored = {
                    let conn = match state_c.db.lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                    match db::mesh::upsert_metadata(&conn, row.id, outcome, computed_at) {
                        Ok(m) => m,
                        Err(_) => return,
                    }
                };
                events::metadata_ready(&app_c, row.id, stored);
            });
        }
    });
}
```

- [ ] **Step 2: Build the whole crate**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/scan/mod.rs
git commit -m "phase3: scan::start_for_library (walk → batch insert → bounded mesh parse)"
```

---

## Task 14: state.rs — wrap in Arc so tokio tasks can share it

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs` (the `.manage(...)` call)

`tokio::spawn` needs `'static + Send` data, so `scan::start_for_library` takes `Arc<AppState>`. Command handlers currently receive `State<'_, AppState>` which already hands out references to the managed value — we just need to manage it as `Arc<AppState>` so cloning hands a new `Arc` (cheap) into the spawned task.

- [ ] **Step 1: Replace `src-tauri/src/state.rs`**

```rust
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

// `Arc<Mutex<_>>` is the standard "shared mutable state" pattern:
//   - `Arc` ("atomic reference count") lets multiple owners hold the same value;
//     Tauri hands copies of `State<'_, Arc<AppState>>` to command handlers, and
//     scanner tasks clone the Arc to keep their own reference.
//   - `Mutex` serializes access — `rusqlite::Connection` isn't thread-safe on
//     its own so this is the cheapest correct choice until contention shows up.
pub struct AppState {
    pub db: Mutex<Connection>,
}

impl AppState {
    pub fn new(conn: Connection) -> Arc<Self> {
        Arc::new(Self {
            db: Mutex::new(conn),
        })
    }
}
```

- [ ] **Step 2: Update the `.manage(...)` call in lib.rs**

In `src-tauri/src/lib.rs`, the setup hook currently calls `app.manage(AppState::new(conn));`. Because `AppState::new` now returns `Arc<AppState>`, we register that Arc as the managed state:

```rust
app.manage(AppState::new(conn));
```

(No change needed — `app.manage()` accepts an `Arc`, and every site that references `AppState` via `State<'_, Arc<AppState>>` will be updated in the next task.)

- [ ] **Step 3: Update command signatures that take AppState**

`src-tauri/src/ipc/libraries.rs` and `src-tauri/src/ipc/files.rs` currently destructure `State<'_, AppState>` and call `state.db.lock()`. Change the state parameter type to `State<'_, Arc<AppState>>` (Task 15 + Task 16 rewrite these files anyway; leaving this note here so the reader knows why the shape changed).

- [ ] **Step 4: Build**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: some errors in `ipc/libraries.rs` + `ipc/files.rs` about the State type — these go away in Tasks 15 and 16.

Actually: we want a clean build at every commit. Easier order: do Task 14 + 15 + 16 together in one commit. Merge the three commits into one labelled "phase3: Arc<AppState> + new IPC commands".

Revised: move Task 14's commit step to the end of Task 16 and instead skip it here.

- [ ] **Step 5: Do NOT commit yet — proceed to Task 15**

---

## Task 15: ipc/libraries.rs — trigger scan on add_library

**Files:**
- Modify: `src-tauri/src/ipc/libraries.rs`

- [ ] **Step 1: Replace `src-tauri/src/ipc/libraries.rs`**

```rust
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::db;
use crate::error::IpcError;
use crate::scan;
use crate::state::AppState;
use crate::types::Library;

// `#[tauri::command]` generates the IPC glue that makes this callable from the
// renderer via `invoke("list_libraries")`. `State<'_, Arc<AppState>>` pulls the
// value registered with `.manage()` at app setup.
#[tauri::command]
pub fn list_libraries(state: State<'_, Arc<AppState>>) -> Result<Vec<Library>, IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::libraries::list(&conn)
}

#[tauri::command]
pub fn add_library(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<Library, IpcError> {
    let library = {
        let conn = state
            .db
            .lock()
            .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
        db::libraries::add(&conn, &path)?
    };
    // Kick off the scan after we've released the lock. start_for_library
    // returns immediately; events flow back via `scan:*` / `files:*`.
    scan::start_for_library(app, Arc::clone(&state), library.id);
    Ok(library)
}

#[tauri::command]
pub fn remove_library(
    state: State<'_, Arc<AppState>>,
    id: i64,
) -> Result<(), IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::libraries::remove(&conn, id)
}
```

---

## Task 16: ipc/files.rs — list_files(FileQuery), get_file_details, rescan_library

**Files:**
- Modify: `src-tauri/src/ipc/files.rs`

- [ ] **Step 1: Replace `src-tauri/src/ipc/files.rs`**

```rust
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::db;
use crate::error::IpcError;
use crate::scan;
use crate::state::AppState;
use crate::types::{FileDetails, FileEntry, FileQuery};

#[tauri::command]
pub fn list_files(
    state: State<'_, Arc<AppState>>,
    query: FileQuery,
) -> Result<Vec<FileEntry>, IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::files::list_files(&conn, &query)
}

#[tauri::command]
pub fn get_file_details(
    state: State<'_, Arc<AppState>>,
    id: i64,
) -> Result<FileDetails, IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    let file = db::files::get_by_id(&conn, id)?;
    let metadata = db::mesh::get_for_file(&conn, id)?;
    Ok(FileDetails { file, metadata })
}

#[tauri::command]
pub fn rescan_library(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: i64,
) -> Result<(), IpcError> {
    scan::start_for_library(app, Arc::clone(&state), id);
    Ok(())
}
```

- [ ] **Step 2: Register the new commands in lib.rs**

In `src-tauri/src/lib.rs`, change the `invoke_handler(tauri::generate_handler![...])` call to:

```rust
.invoke_handler(tauri::generate_handler![
    ipc::libraries::list_libraries,
    ipc::libraries::add_library,
    ipc::libraries::remove_library,
    ipc::files::list_files,
    ipc::files::get_file_details,
    ipc::files::rescan_library,
])
```

- [ ] **Step 3: Build the whole crate**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 4: Run the test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass (migrations, db::files, db::mesh, mesh::metrics, mesh::stl, mesh::obj, scan::walker + ts-rs `export_bindings_*`).

- [ ] **Step 5: Regenerate bindings**

Run: `pnpm bindings`
Expected: `src/generated/` is unchanged (types already regenerated in Task 3). If anything changes, commit that diff here.

- [ ] **Step 6: Commit the backend changes from Tasks 14+15+16 together**

```bash
git add src-tauri/src/state.rs src-tauri/src/ipc/libraries.rs src-tauri/src/ipc/files.rs src-tauri/src/lib.rs src/generated/
git commit -m "phase3: Arc<AppState>, add_library triggers scan, new list_files/get_file_details/rescan_library IPC"
```

---

## Task 17: frontend — src/ipc/events.ts

**Files:**
- Create: `src/ipc/events.ts`

- [ ] **Step 1: Create the file**

```ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  FilesAddedEvent,
  MetadataReadyEvent,
  ScanCompletedEvent,
  ScanErrorEvent,
  ScanProgressEvent,
  ScanStartedEvent,
} from "../generated";

// Event names are duplicated from src-tauri/src/events.rs. If you change one,
// change the other in the same commit.
export const SCAN_STARTED = "scan:started";
export const SCAN_PROGRESS = "scan:progress";
export const SCAN_COMPLETED = "scan:completed";
export const SCAN_ERROR = "scan:error";
export const FILES_ADDED = "files:added";
export const METADATA_READY = "metadata:ready";

export function onScanStarted(cb: (e: ScanStartedEvent) => void): Promise<UnlistenFn> {
  return listen<ScanStartedEvent>(SCAN_STARTED, (ev) => cb(ev.payload));
}
export function onScanProgress(cb: (e: ScanProgressEvent) => void): Promise<UnlistenFn> {
  return listen<ScanProgressEvent>(SCAN_PROGRESS, (ev) => cb(ev.payload));
}
export function onScanCompleted(cb: (e: ScanCompletedEvent) => void): Promise<UnlistenFn> {
  return listen<ScanCompletedEvent>(SCAN_COMPLETED, (ev) => cb(ev.payload));
}
export function onScanError(cb: (e: ScanErrorEvent) => void): Promise<UnlistenFn> {
  return listen<ScanErrorEvent>(SCAN_ERROR, (ev) => cb(ev.payload));
}
export function onFilesAdded(cb: (e: FilesAddedEvent) => void): Promise<UnlistenFn> {
  return listen<FilesAddedEvent>(FILES_ADDED, (ev) => cb(ev.payload));
}
export function onMetadataReady(cb: (e: MetadataReadyEvent) => void): Promise<UnlistenFn> {
  return listen<MetadataReadyEvent>(METADATA_READY, (ev) => cb(ev.payload));
}
```

- [ ] **Step 2: Commit after Task 18 (shared commit)**

---

## Task 18: frontend — src/ipc/commands.ts update

**Files:**
- Modify: `src/ipc/commands.ts`

- [ ] **Step 1: Replace `src/ipc/commands.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import type {
  FileDetails,
  FileEntry,
  FileQuery,
  Library,
} from "../generated";

// Thin, typed wrappers over Tauri's `invoke`. Keep these dumb so the hooks /
// stores have one place to mock for tests and one place to look when the IPC
// contract shifts.

export function listLibraries(): Promise<Library[]> {
  return invoke<Library[]>("list_libraries");
}

export function addLibrary(path: string): Promise<Library> {
  return invoke<Library>("add_library", { path });
}

export function removeLibrary(id: number): Promise<void> {
  return invoke<void>("remove_library", { id });
}

export function listFiles(query: FileQuery): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_files", { query });
}

export function getFileDetails(id: number): Promise<FileDetails> {
  return invoke<FileDetails>("get_file_details", { id });
}

export function rescanLibrary(id: number): Promise<void> {
  return invoke<void>("rescan_library", { id });
}
```

- [ ] **Step 2: Commit both new/changed ipc files**

```bash
git add src/ipc/events.ts src/ipc/commands.ts
git commit -m "phase3: typed event wrappers and updated command signatures"
```

---

## Task 19: frontend — src/state/files.ts (live file + metadata store)

**Files:**
- Create: `src/state/files.ts`

- [ ] **Step 1: Create the file**

```ts
import { create } from "zustand";
import type { FileEntry, MeshMetadata } from "../generated";

interface FilesState {
  // Files keyed by id for O(1) merge from streaming events.
  filesByLibrary: Record<number, Record<number, FileEntry>>;
  metadataByFileId: Record<number, MeshMetadata>;

  setLibraryFiles: (libraryId: number, files: FileEntry[]) => void;
  appendFiles: (files: FileEntry[]) => void;
  setMetadata: (fileId: number, metadata: MeshMetadata) => void;
  libraryFiles: (libraryId: number) => FileEntry[];
}

export const useFilesStore = create<FilesState>((set, get) => ({
  filesByLibrary: {},
  metadataByFileId: {},

  setLibraryFiles: (libraryId, files) =>
    set((s) => ({
      filesByLibrary: {
        ...s.filesByLibrary,
        [libraryId]: Object.fromEntries(files.map((f) => [f.id, f])),
      },
    })),

  appendFiles: (files) =>
    set((s) => {
      const next: Record<number, Record<number, FileEntry>> = {
        ...s.filesByLibrary,
      };
      for (const f of files) {
        const bucket = { ...(next[f.libraryId] ?? {}) };
        bucket[f.id] = f;
        next[f.libraryId] = bucket;
      }
      return { filesByLibrary: next };
    }),

  setMetadata: (fileId, metadata) =>
    set((s) => ({
      metadataByFileId: { ...s.metadataByFileId, [fileId]: metadata },
    })),

  libraryFiles: (libraryId) => {
    const bucket = get().filesByLibrary[libraryId];
    return bucket ? Object.values(bucket) : [];
  },
}));
```

- [ ] **Step 2: Commit after Task 20 (shared commit)**

---

## Task 20: frontend — useLiveEvents hook + mount it in App.tsx

**Files:**
- Create: `src/hooks/useLiveEvents.ts`
- Modify: `src/App.tsx` (add one call)

- [ ] **Step 1: Create `src/hooks/useLiveEvents.ts`**

```ts
import { useEffect } from "react";
import { onFilesAdded, onMetadataReady } from "../ipc/events";
import { useFilesStore } from "../state/files";

// Mount once, at the top of the tree. Subscribes to the backend's live events
// and merges them into the files store. Returns nothing.
export function useLiveEvents(): void {
  const appendFiles = useFilesStore((s) => s.appendFiles);
  const setMetadata = useFilesStore((s) => s.setMetadata);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    let cancelled = false;

    onFilesAdded((e) => {
      if (!cancelled) appendFiles(e.files);
    }).then((u) => unsubs.push(u));

    onMetadataReady((e) => {
      if (!cancelled) setMetadata(e.fileId, e.metadata);
    }).then((u) => unsubs.push(u));

    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, [appendFiles, setMetadata]);
}
```

- [ ] **Step 2: Mount it in `src/App.tsx`**

At the top of `src/App.tsx`, add the import:

```ts
import { useLiveEvents } from "./hooks/useLiveEvents";
```

Inside the `App` component body, after the existing hook calls (e.g. after `const paneWidths = useAppStore(...)`), add:

```ts
useLiveEvents();
```

- [ ] **Step 3: Commit the files store + live events wiring together**

```bash
git add src/state/files.ts src/hooks/useLiveEvents.ts src/App.tsx
git commit -m "phase3: live files store + useLiveEvents (files:added, metadata:ready)"
```

---

## Task 21: frontend — useVisibleFiles merges baseline + live rows

**Files:**
- Modify: `src/hooks/useVisibleFiles.ts`

- [ ] **Step 1: Replace `src/hooks/useVisibleFiles.ts`**

```ts
import { useEffect, useMemo } from "react";
import type { FileEntry } from "../generated";
import { listFiles } from "../ipc/commands";
import { useAppStore } from "../state/store";
import { useFilesStore } from "../state/files";

// Fetches the file view from the Rust backend when (library, sort, search)
// changes, writes it into the files store as the baseline, and returns a
// client-side view that merges live `files:added` rows into that baseline.
export function useVisibleFiles(): FileEntry[] {
  const activeLibraryId = useAppStore((s) => s.activeLibraryId);
  const sortKey = useAppStore((s) => s.sortKey);
  const sortDirection = useAppStore((s) => s.sortDirection);
  const search = useAppStore((s) => s.search);

  const setLibraryFiles = useFilesStore((s) => s.setLibraryFiles);
  const filesByLibrary = useFilesStore((s) => s.filesByLibrary);

  useEffect(() => {
    let cancelled = false;
    listFiles({
      libraryId: activeLibraryId,
      sort: { key: sortKey, direction: sortDirection },
      search,
    })
      .then((rows) => {
        if (cancelled) return;
        if (activeLibraryId != null) {
          setLibraryFiles(activeLibraryId, rows);
        }
      })
      .catch((err) => {
        console.error("list_files failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [activeLibraryId, sortKey, sortDirection, search, setLibraryFiles]);

  // Client-side apply of sort + search to the store bucket so freshly-appended
  // rows sort correctly without a new backend round-trip. The backend's order
  // is authoritative on initial load; the merged view replays the same sort.
  return useMemo(() => {
    if (activeLibraryId == null) return [];
    const bucket = filesByLibrary[activeLibraryId];
    if (!bucket) return [];
    const all = Object.values(bucket);
    const q = search.trim().toLowerCase();
    const filtered = q
      ? all.filter((f) => f.name.toLowerCase().includes(q))
      : all;
    const dir = sortDirection === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return dir * a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        case "size":
          return dir * (a.sizeBytes - b.sizeBytes);
        case "mtime":
          return dir * (a.mtimeMs - b.mtimeMs);
        case "format":
          return (
            dir *
            (a.extension.localeCompare(b.extension) ||
              a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
          );
      }
    });
    return filtered;
  }, [activeLibraryId, filesByLibrary, search, sortKey, sortDirection]);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useVisibleFiles.ts
git commit -m "phase3: useVisibleFiles merges backend baseline with live files:added"
```

---

## Task 22: frontend — Inspector fetches FileDetails + listens for metadata:ready

**Files:**
- Modify: `src/components/Inspector.tsx`

Read the existing `Inspector.tsx` first to match its prop shape; the snippet below assumes the current `{ file: FileEntry | null, libraries: Library[] }` signature used in `App.tsx:105`. If the actual shape differs, adjust the changes but preserve the metadata-display blocks.

- [ ] **Step 1: Read the existing component to confirm its prop shape and markup**

Run: open `src/components/Inspector.tsx` and locate (a) the props type, (b) where `file.name`, `file.sizeBytes`, etc. are rendered.

- [ ] **Step 2: Add state + effect that pull metadata**

Near the top of the component, alongside the existing hooks, add:

```tsx
import { useEffect, useState } from "react";
import type { MeshMetadata } from "../generated";
import { getFileDetails } from "../ipc/commands";
import { useFilesStore } from "../state/files";

// ... inside the component:
const metadataFromStore = useFilesStore((s) =>
  file ? s.metadataByFileId[file.id] : undefined,
);
const [fetched, setFetched] = useState<MeshMetadata | null>(null);

useEffect(() => {
  let cancelled = false;
  if (!file) {
    setFetched(null);
    return;
  }
  getFileDetails(file.id)
    .then((details) => {
      if (!cancelled) setFetched(details.metadata ?? null);
    })
    .catch(() => {
      if (!cancelled) setFetched(null);
    });
  return () => {
    cancelled = true;
  };
}, [file?.id]);

const metadata = metadataFromStore ?? fetched ?? null;
```

- [ ] **Step 3: Render metadata**

In the inspector body, add a metadata section. Insert wherever the component already shows file info:

```tsx
{metadata && !metadata.parseError && metadata.bboxMin && metadata.bboxMax && (
  <section className="space-y-1 border-t border-neutral-800 pt-2 text-[12px] text-neutral-300">
    <div>
      <span className="text-neutral-500">Triangles:</span>{" "}
      {metadata.triangleCount?.toLocaleString() ?? "—"}
    </div>
    <div>
      <span className="text-neutral-500">Size (mm):</span>{" "}
      {(metadata.bboxMax[0] - metadata.bboxMin[0]).toFixed(1)} ×{" "}
      {(metadata.bboxMax[1] - metadata.bboxMin[1]).toFixed(1)} ×{" "}
      {(metadata.bboxMax[2] - metadata.bboxMin[2]).toFixed(1)}
    </div>
    <div>
      <span className="text-neutral-500">Surface area:</span>{" "}
      {metadata.surfaceAreaMm2?.toFixed(1) ?? "—"} mm²
    </div>
    <div>
      <span className="text-neutral-500">Volume:</span>{" "}
      {metadata.volumeMm3 != null ? `${metadata.volumeMm3.toFixed(1)} mm³` : "— (not watertight)"}
    </div>
  </section>
)}
{metadata?.parseError && (
  <section className="border-t border-neutral-800 pt-2 text-[12px] text-red-400">
    Parse failed: {metadata.parseError}
  </section>
)}
{!metadata && file && (
  <section className="border-t border-neutral-800 pt-2 text-[12px] text-neutral-500">
    Parsing mesh…
  </section>
)}
```

- [ ] **Step 4: Type-check + vite build**

Run: `pnpm build`
Expected: PASS (tsc green, vite bundle emitted).

- [ ] **Step 5: Commit**

```bash
git add src/components/Inspector.tsx
git commit -m "phase3: Inspector shows real mesh metadata via get_file_details + metadata:ready"
```

---

## Task 23: PLAN.md — document deviations, mark Phase 3 complete

**Files:**
- Modify: `PLAN.md`

- [ ] **Step 1: Update the §4 `mesh_metadata` SQL block**

Replace the table definition (roughly PLAN.md:283–292) with:

```sql
CREATE TABLE mesh_metadata (
  file_id         INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  bbox_min_x REAL, bbox_min_y REAL, bbox_min_z REAL,    -- nullable on parse_error rows
  bbox_max_x REAL, bbox_max_y REAL, bbox_max_z REAL,    -- "
  volume_mm3      REAL,                    -- nullable: Some only when edge-watertight
  surface_area_mm2 REAL,
  triangle_count  INTEGER,                 -- nullable on parse_error rows
  computed_at     INTEGER NOT NULL,
  parse_error     TEXT,                    -- non-null if parse failed; row still exists so we don't retry
  CHECK (parse_error IS NOT NULL
         OR (bbox_min_x IS NOT NULL AND bbox_min_y IS NOT NULL AND bbox_min_z IS NOT NULL
             AND bbox_max_x IS NOT NULL AND bbox_max_y IS NOT NULL AND bbox_max_z IS NOT NULL
             AND triangle_count IS NOT NULL))
);
```

In the "Design notes" block just below, append:

```
- **bbox_* and triangle_count nullable** — a file with a `parse_error` has no geometry. A CHECK constraint enforces "either parse_error OR full geometry", so non-null geometry always round-trips through `get_file_details`.
```

- [ ] **Step 2: Update the §6 Rust dependencies table**

Leave the table alone (`num_cpus` was never added). Under the table, append a note:

```
**Concurrency cap:** `std::thread::available_parallelism()` is used in `scan/mod.rs` (capped at 4). `num_cpus` was considered but skipped to avoid an extra dep when `std` gives the same answer.
```

- [ ] **Step 3: Update §2 Phase 3 exit criterion line**

At the end of the Phase 3 section (roughly PLAN.md:161), append:

```
- **Phase 3 — Status: complete.**
```

- [ ] **Step 4: Update CLAUDE.md "Current phase" line**

Change CLAUDE.md's current-phase note from:

```
Phase 2 (Rust data layer: SQLite, migrations, libraries CRUD, ts-rs bindings, folder picker) complete. Next: Phase 3 — scanning + metadata. See `PLAN.md` §2 for the full phased roadmap.
```

to:

```
Phase 3 (scanning + metadata: walkdir + blake3 cache keys, tokio-spawned walk + mesh parse, mesh_metadata schema, new IPC commands and namespaced events) complete. Next: Phase 4 — file watching. See `PLAN.md` §2 for the full phased roadmap.
```

- [ ] **Step 5: Commit**

```bash
git add PLAN.md CLAUDE.md
git commit -m "phase3: document schema + concurrency deviations; mark Phase 3 complete"
```

---

## Task 24: exit-criterion verification with the user

**Files:** none

This task is verification only — no code changes. It matches the user's Checkpoint 7 (frontend grid populates from real IPC) and the exit criterion from PLAN §10 row 3.

- [ ] **Step 1: Start the dev server**

Run: `pnpm tauri dev`
Expected: Vite reports "Local: http://localhost:...", Rust compiles without errors, a desktop window opens.

- [ ] **Step 2: Hand off to the user**

Post the following message to the user verbatim:

> `[OK]` Phase 3 ready for exit-criterion check. `pnpm tauri dev` is running. Please:
>
> 1. Click the "+" / "Add library" control in the sidebar and pick a folder containing real STL/OBJ/3MF files.
> 2. Confirm every file appears in the grid within ~5 seconds.
> 3. Click any file and confirm the inspector shows real triangle count, bounding-box size, surface area, and volume.
> 4. Optionally click "Rescan" (or call `rescanLibrary` via DevTools) and confirm no duplicates appear.
>
> Reply "confirmed" (or "failed: …") and I'll either mark Phase 3 done or dig into what went wrong.

- [ ] **Step 3: Await user confirmation before claiming Phase 3 complete.**

Do NOT mark this phase done until the user replies "confirmed". If they report a failure, debug using the `superpowers:systematic-debugging` skill before attempting fixes.

---

## Self-review outcomes (applied inline)

1. **Spec coverage** — every spec section is covered: §3 module layout → Tasks 4/5/6/7/8/9/10/11/12/13; §4 deps → Task 1; §5 schema → Task 2; §6 orchestration → Task 13; §7 mesh → Tasks 7–11; §8 IPC → Tasks 3/15/16; §9 frontend → Tasks 17–22; §11 verification → Tasks 2/5/6/7/8/9/12/16/22/24; PLAN deviations → Task 23.
2. **Placeholder scan** — no TBD / TODO / "handle edge cases" left.
3. **Type consistency** — `MeshMetricsRow` (used in Task 6 + Task 7) and `MeshMetadata` (used in Task 3 + Task 6 + Task 22) are distinct by design: `MeshMetricsRow` is the pre-DB non-null metrics shape from the parser, `MeshMetadata` is the post-DB shape with `Option<_>` fields for the IPC boundary. Check sites cross-reference correctly.
4. **Cross-task signatures** — `AppState::new(conn) -> Arc<AppState>` (Task 14) matches all `State<'_, Arc<AppState>>` command signatures (Tasks 15/16) and `start_for_library(app, state: Arc<AppState>, library_id)` (Task 13). `FileQuery { libraryId, sort, search }` (Task 3) matches the wrapper in Task 18 and the hook in Task 21. Event names duplicated across `events.rs` (Task 4) and `src/ipc/events.ts` (Task 17) use identical strings.
