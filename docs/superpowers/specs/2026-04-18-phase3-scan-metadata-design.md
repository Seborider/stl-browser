# Phase 3 — Scanning + Metadata — Design

**Status:** approved for plan writing · 2026-04-18
**Scope reference:** PLAN.md §2 Phase 3, §3 IPC contract, §4 schema, §6 deps, §9 Rust patterns, §10 row 3.

## 1. Goals

Turn a library (a user-picked folder) into rows in SQLite with enough information for the grid to display file-level data and the inspector to display real mesh metadata — without any file watching (Phase 4), thumbnail pipeline (Phase 5), or detail viewer (Phase 6).

Exit criterion (PLAN §10 row 3): *"Add a folder of real STLs; every file appears in the grid within ~5s and has real metadata in the inspector."*

## 2. Decisions locked during brainstorming

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Inspector reads metadata via new `get_file_details(id) -> FileDetails` command, not a fattened `FileEntry` or a client-side event cache. | PLAN-compliant separation of grid vs. detail; avoids race where selection beats `metadata:ready`. |
| 2 | `mesh_metadata` deviates from PLAN §4: `bbox_*` and `triangle_count` are nullable. A CHECK constraint enforces *either* `parse_error IS NOT NULL` *or* the geometry columns are non-null. PLAN.md §4 to be updated in the same change. | Avoids zero-sentinel data leaking into the inspector for files that failed to parse. |
| 3 | Concurrency cap comes from `std::thread::available_parallelism()`, not the `num_cpus` crate. | Avoids adding a crate not in PLAN §6; `std` equivalent has been stable since Rust 1.59. |
| 4 | Scan tasks receive `AppHandle` via the Tauri command signature, not via `AppState`. | Smaller change to existing `state.rs`; Tauri's command macro already hands the handle in for free. |
| 5 | `rescan_library(id)` is additive-only in Phase 3: `INSERT OR IGNORE` new files, parse metadata for files with no `mesh_metadata` row; never deletes, never re-parses. | Keeps Phase 4 (watcher-driven removals/updates) scope lock intact. |
| 6 | Keep the per-type ts-rs file layout under `src/generated/`. | The existing `pnpm bindings` script already regenerates these cleanly; consolidating into a single `bindings.ts` would require a bespoke post-step. |

## 3. Module layout (added / changed)

```
src-tauri/src/
  scan/
    mod.rs            start_for_library(app, state, library_id) orchestration
    walker.rs         sync walkdir + blake3 hashing, inside spawn_blocking
  mesh/
    mod.rs            dispatch by extension → Vec<[[f64;3];3]>
    stl.rs            stl_io parser
    obj.rs            tobj parser
    threemf.rs        threemf parser (merges all meshes in first model → one logical mesh)
    metrics.rs        compute bbox, triangle_count, surface_area, optional volume
  db/
    files.rs          insert_files_batch, list_files(FileQuery), get_by_id
    mesh.rs           upsert_metadata, get_for_file
  events.rs           namespaced emit helpers (scan:*, files:*, metadata:*)
  types.rs            +FileQuery, FileDetails, MeshMetadata, event payload structs

src/
  ipc/events.ts       typed listen() wrappers for scan:*, files:*, metadata:*
  ipc/commands.ts     +getFileDetails, +rescanLibrary; listFiles now takes FileQuery
  state/files.ts      new Zustand store: filesByLibrary + metadataByFileId
  hooks/useVisibleFiles.ts  subscribe to files:added; merge from store
  components/Inspector.tsx  fetch via getFileDetails + listen to metadata:ready
```

`state.rs` is unchanged.

## 4. Dependencies to add

All listed in PLAN §6 (already approved), none new:

```toml
tokio = { version = "1", features = ["full"] }
walkdir = "2"
blake3 = "1"
stl_io = "0.7"
tobj = "4"
threemf = "0.5"
```

## 5. Schema migration v2

Applied by the existing `schema_version` runner as `MIGRATIONS[1]`.

```sql
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
```

## 6. Scan orchestration

Entry points: `ipc::libraries::add_library` (after successful insert) and new `ipc::files::rescan_library(id)` both call `scan::start_for_library(app, state, library_id)`.

### 6.1 Walker task (one per library)

```
emit scan:started { libraryId }

tokio::spawn(async move {
  let result = spawn_blocking(move || {
    let mut buffer = Vec::with_capacity(100);
    let mut last_flush = Instant::now();
    let mut scanned = 0u64;

    for entry in WalkDir::new(abs_path).follow_links(true) {
      let ext = entry.path().extension()?.to_ascii_lowercase();
      if !matches!(ext.as_str(), "stl" | "3mf" | "obj") { continue; }
      let md = entry.metadata()?;
      let size = md.len() as i64;
      let mtime = md.modified()?.duration_since(UNIX_EPOCH)?.as_millis() as i64;
      let cache_key = blake3(abs_path_bytes || mtime.le_bytes || size.le_bytes).to_hex();
      buffer.push(FileRow { library_id, rel_path, name, extension, size, mtime, cache_key });
      scanned += 1;

      if buffer.len() >= 100 || last_flush.elapsed() >= Duration::from_millis(250) {
        let inserted = {
          let conn = state.db.lock();
          db::files::insert_files_batch(&conn, &buffer)?
        };
        app.emit("files:added", FilesAddedEvent { files: inserted });
        app.emit("scan:progress", ScanProgressEvent { library_id, scanned });
        buffer.clear();
        last_flush = Instant::now();
      }
    }
    // final flush
    if !buffer.is_empty() { ... }
    Ok(scanned)
  }).await;

  match result {
    Ok(Ok(total)) => app.emit("scan:completed", ScanCompletedEvent { library_id, total }),
    Err(_) | Ok(Err(_)) => app.emit("scan:error", ScanErrorEvent { library_id, message }),
  }

  // hand off to mesh stage (§6.2)
});
```

`insert_files_batch` uses a transaction with `INSERT OR IGNORE INTO files …`, then fetches the newly-inserted rows by re-querying on `(library_id, cache_key)` for the batch. Rowid-range approaches rely on monotonic rowids which aren't guaranteed under WAL with concurrent writers, so we avoid them. Already-present rows produce no `files:added` entry.

### 6.2 Mesh-parsing stage

Runs after the walker finishes (inside the same `tokio::spawn`), not in parallel with it — walker I/O is the fast path to "file shows up in grid" and we don't want CPU-heavy parsing to delay DB inserts.

```rust
let parallelism = std::thread::available_parallelism()
                    .map(NonZeroUsize::get).unwrap_or(1).min(4);
let sem = Arc::new(tokio::sync::Semaphore::new(parallelism));

let to_parse = {
  let conn = state.db.lock();
  db::files::list_needing_metadata(&conn, library_id)?
};

let mut handles = Vec::new();
for row in to_parse {
  let permit = sem.clone().acquire_owned().await.unwrap();
  let state_c = state.clone();
  let app_c   = app.clone();
  handles.push(tokio::spawn(async move {
    let _permit = permit; // dropped when task ends
    let outcome = spawn_blocking(move || mesh::parse_file(&row.abs_path, &row.extension)).await;
    let (metadata, parse_error) = match outcome {
      Ok(Ok(m)) => (Some(m), None),
      Ok(Err(e)) => (None, Some(e.to_string())),
      Err(join_err) => (None, Some(join_err.to_string())),
    };
    let stored = {
      let conn = state_c.db.lock();
      db::mesh::upsert_metadata(&conn, row.id, metadata, parse_error)?
    };
    app_c.emit("metadata:ready", MetadataReadyEvent { file_id: row.id, metadata: stored });
    Ok::<(), IpcError>(())
  }));
}
```

### 6.3 Locking rule (critical)

`std::sync::Mutex<Connection>` is held **only** inside `spawn_blocking` bodies, never across an `.await`. The pattern:

```rust
let result = {
  let conn = state.db.lock().map_err(poisoned)?;
  db::foo(&conn, ...)?   // pure sync work
};  // lock released here before any .await
```

This avoids the std-Mutex-across-await footgun and lets us keep the existing `state.rs` shape.

## 7. Mesh parsing (mesh/)

### 7.1 Uniform output

Each parser returns `Vec<[[f64; 3]; 3]>` (list of triangles, each three xyz vertices) plus the source triangle count (sometimes different if a parser deduplicates). `metrics::compute(&triangles)` takes it from there.

### 7.2 Per-format notes

- **stl** — `stl_io::read_stl(&mut Cursor::new(bytes))`. Binary/ASCII auto-detection is built-in. Map `IndexedTriangle` + `vertices` into our uniform form.
- **obj** — `tobj::load_obj_buf(&mut Cursor::new(bytes), &LoadOptions::default(), |_| Err(tobj::LoadError::GenericFailure))`. The closure returning an error skips materials (we never need MTL). Iterate `Model.mesh.indices` in groups of three to build triangles.
- **3mf** — `threemf::read(Cursor::new(bytes))` returns models. For v1, concatenate all meshes inside the first model into one logical mesh. This matches PLAN §7 "3MF with multiple objects" note: single-mesh v1, revisit for v2.

### 7.3 Metrics

```rust
pub struct MeshMetrics {
  bbox_min: [f64; 3],
  bbox_max: [f64; 3],
  triangle_count: i64,
  surface_area_mm2: f64,        // always populated
  volume_mm3: Option<f64>,      // Some only if watertight-edge check passes
}

pub fn compute(triangles: &[[[f64; 3]; 3]]) -> MeshMetrics {
  // bbox:    fold min/max across all vertices
  // area:    Σ 0.5 * |(b - a) × (c - a)|
  // watertight check:
  //   build HashMap<CanonicalEdge, u32>, count edges;
  //   watertight iff every canonical edge has count == 2
  // volume (if watertight):
  //   |Σ (a · (b × c)) / 6|    // divergence-theorem, absolute to ignore orientation
}
```

Unit tests on a unit cube (12 tris, volume = 1, area = 6) and a unit tetrahedron (4 tris, volume = 1/6, area = 1 + 3·(√3/4)).

Units: STL/3MF/OBJ all default to mm for 3D-print files. No unit conversion in v1.

## 8. IPC contract delta

### 8.1 Types (`types.rs`, all `#[ts(export, export_to = "../src/generated/")]`)

```rust
#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileQuery {
  pub library_id: Option<i64>,
  pub sort: Sort,
  pub search: String,
}

#[derive(Serialize, Deserialize, TS, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MeshMetadata {
  pub bbox_min: Option<[f64; 3]>,
  pub bbox_max: Option<[f64; 3]>,
  pub triangle_count: Option<i64>,
  pub volume_mm3: Option<f64>,
  pub surface_area_mm2: Option<f64>,
  pub computed_at: i64,
  pub parse_error: Option<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileDetails {
  pub file: FileEntry,
  pub metadata: Option<MeshMetadata>,
}

// Event payloads (all serde rename_all = "camelCase", all #[ts(export)])
pub struct ScanStartedEvent   { library_id: i64 }
pub struct ScanProgressEvent  { library_id: i64, scanned: u64 }
pub struct ScanCompletedEvent { library_id: i64, total: u64 }
pub struct ScanErrorEvent     { library_id: i64, message: String }
pub struct FilesAddedEvent    { files: Vec<FileEntry> }
pub struct MetadataReadyEvent { file_id: i64, metadata: MeshMetadata }
```

### 8.2 Commands

| Command | Change |
|---|---|
| `list_files(query: FileQuery) -> Vec<FileEntry>` | signature consolidated into single FileQuery param |
| `get_file_details(id: i64) -> FileDetails` | new |
| `rescan_library(id: i64) -> ()` | new |
| `add_library(path: String) -> Library` | unchanged signature; side-effect added (spawns scan) |

### 8.3 Events

All namespaced per PLAN §3:

- `scan:started`, `scan:progress`, `scan:completed`, `scan:error`
- `files:added` (batched ~100 or every 250ms)
- `metadata:ready` (one per file, after parse)

Wrapped by helpers in `events.rs` so call sites can't typo event names or payload shapes.

## 9. Frontend wiring

### 9.1 IPC layer

`src/ipc/events.ts` — typed `listen()` wrappers:

```ts
export function onFilesAdded(cb: (e: FilesAddedEvent) => void): UnlistenFn
export function onMetadataReady(cb: (e: MetadataReadyEvent) => void): UnlistenFn
// …etc
```

`src/ipc/commands.ts` — `listFiles(query: FileQuery)` replaces the split-arg signature; new `getFileDetails`, `rescanLibrary`.

### 9.2 State

New `src/state/files.ts` Zustand store (separate from the existing view store, which keeps its single-responsibility shape):

```ts
interface FilesStore {
  filesByLibrary: Record<number, FileEntry[]>;
  metadataByFileId: Record<number, MeshMetadata>;
  appendFiles: (files: FileEntry[]) => void;
  setMetadata: (fileId: number, m: MeshMetadata) => void;
  replaceLibraryFiles: (libraryId: number, files: FileEntry[]) => void;
}
```

A single top-level effect (mounted in `App.tsx` or a dedicated `useLiveFiles` hook) subscribes to `files:added` and `metadata:ready` and calls the store actions.

### 9.3 Hooks & components

- `useVisibleFiles` — on `(activeLibraryId, sort, search)` change: `listFiles({ libraryId, sort, search })`, then use the result as the baseline. Additionally reads the store so `files:added` rows merge in live. Re-sort/filter client-side to avoid a round-trip on every append.
- `Inspector.tsx` — on selection change: `getFileDetails(id)`; subscribe to `metadata:ready` filtered to the selected `fileId` for late-arriving updates.

## 10. Rust patterns introduced in this phase

Inline one-liners in the PR-style summary (not in code comments) when each first appears:

- `tokio::spawn` — schedules an async task on the tokio runtime; returns a `JoinHandle`.
- `spawn_blocking` — offloads CPU-bound or sync IO work to a dedicated blocking threadpool so the async runtime isn't stalled.
- `tokio::sync::Semaphore` — bounds concurrency; `acquire_owned()` yields a permit that's dropped with the task.
- `#[from]` in thiserror — auto-generates `impl From<SourceError> for IpcError` so `?` composes cleanly across error types.

## 11. Verification checklist

Checkpoints (matching the user's gating list):

1. Design doc written + committed.
2. Migration v2 applies cleanly on a fresh DB **and** on an existing Phase-2 DB (schema_version → 2, no error).
3. `cargo build` passes with new scan + mesh modules and new deps.
4. `pnpm bindings` regenerates without drift (`git status src/generated/` is clean after).
5. Scanner emits `files:added` batches end-to-end (verified with a tiny fixture + `tauri::test` or a temp-dir integration test that listens for events).
6. Mesh parser emits `metadata:ready` for an STL, OBJ, and 3MF fixture — each with known bbox/tri_count values asserted by a unit test on `metrics::compute`.
7. Frontend grid populates from real IPC (user-verified in `pnpm tauri dev` on a real folder).

Exit criterion (user-verified): adding a folder of real STLs, every file appears in the grid within ~5s and the inspector shows real metadata.

## 12. Out of scope (explicit scope lock)

- No `notify` crate, no watcher, no `files:removed` / `files:updated`. That's Phase 4.
- No thumbnail pipeline, Web Worker, `save_thumbnail`, `get_thumbnail_url`, or `thumbnails` table. That's Phase 5.
- No R3F detail viewer or asset-protocol plumbing. That's Phase 6.
- No `num_cpus` crate. No pnpm → npm swap. No hand-editing generated bindings. No placeholder TODOs.
