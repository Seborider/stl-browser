# Grid Tile Context Menu — Reveal in Finder + Move to Bin

> **Save target on approval:** `docs/superpowers/plans/2026-05-03-grid-context-menu.md`
> Plan mode restricts writes to `~/.claude/plans/`; on `ExitPlanMode` approval the file moves to the path above.

## Context

Today the only way to reveal a file in Finder is the button inside the right-hand `Inspector` pane (`src/components/Inspector.tsx:115-122`), and there is no way at all to delete a file from the library — users must Cmd-Tab to Finder, navigate to the file, and Trash it there, then re-trigger a watcher event to clear the tile. We want the standard macOS right-click affordance directly on each grid tile so both actions are one gesture away. "Move to Bin" sends the file to the macOS Trash (recoverable via Finder → Put Back), removes the row from SQLite, and emits `files:removed` so the tile drops live without a rescan.

A useful side effect: wiring the `files:removed` event into the renderer also fixes a latent gap. The Rust watcher already emits `files:removed` after deleting rows for files that disappear from disk (`src-tauri/src/scan/watcher.rs:201-211`), but the renderer never listens — `src/ipc/events.ts` has no `FILES_REMOVED` constant and `useLiveEvents` (`src/hooks/useLiveEvents.ts:25-66`) only subscribes to `files:added`, `metadata:ready`, `thumbnails:needed`, `thumbnails:ready`. Today, externally-deleted files only disappear after a library switch re-runs `list_files`. The new listener fixes both call paths at once.

## Current state (cited)

### Reuse targets (do not duplicate)
- **Rust IPC `reveal_in_finder`** — `src-tauri/src/ipc/system.rs:17-34`. Validates absolute path, checks existence, shells `open -R` via `tauri-plugin-shell`. Registered at `src-tauri/src/lib.rs:160`.
- **TS wrapper `revealInFinder(path)`** — `src/ipc/commands.ts:74-76` (`invoke<void>("reveal_in_finder", { path })`).
- **Existing call site (Inspector)** — handler at `src/components/Inspector.tsx:61-69`, button at `:115-122`. Note the path construction: ``revealInFinder(`${library.path}/${file.relPath}`)`` (`:65`). The new context-menu item must build the path the same way.
- **DB delete** — `pub fn delete_by_ids(conn: &Connection, ids: &[i64]) -> Result<usize, IpcError>` at `src-tauri/src/db/files.rs:214-228`. Uses `unchecked_transaction` + prepared `DELETE FROM files WHERE id = ?1`. CASCADE on `mesh_metadata.file_id` is set in `src-tauri/src/db/migrations.rs:39`, so dependent rows go away automatically.
- **Rust event helper `files_removed`** — `src-tauri/src/events.rs:46-48` (`{ file_ids: Vec<i64> }`). Constant `FILES_REMOVED = "files:removed"` at `:15`. Already used by the watcher at `src-tauri/src/scan/watcher.rs:210` — reuse exactly, do **not** introduce a new event name.
- **Generated payload type** — `FilesRemovedEvent { fileIds: number[] }` already exists in `src/generated/` (per ts-rs export of `src-tauri/src/types.rs`).

### Things that don't exist yet (the surface we're adding)
- **TS listener wrapper** — `src/ipc/events.ts:21` defines `FILES_ADDED` but **no** `FILES_REMOVED` constant and **no** `onFilesRemoved(cb)` wrapper. Pattern to mirror: `onFilesAdded` at `:40-42`.
- **Zustand action** — `src/state/files.ts` has `setLibraryFiles`, `appendFiles`, `setMetadata`, `libraryFiles` (`:9-12`); no `removeFiles(ids: number[])`. Files live in `filesByLibrary: Record<number, Record<number, FileEntry>>` keyed by `id` for O(1) merge — same shape works for O(1) delete.
- **`useLiveEvents` subscription** — `src/hooks/useLiveEvents.ts:25-66` mounts once, never subscribes to `files:removed`.
- **`#[tauri::command] delete_file`** — no command exists. New file (or addition to `src-tauri/src/ipc/files.rs` after `:60`).
- **Context-menu UI primitive** — `src/components/GridTile.tsx:14-51` is a plain `<button>` with `onClick={onSelect}` and `onDoubleClick={onActivate}`; no `onContextMenu`. The default browser context menu fires today.
- **i18n strings** — `src/i18n/locales/{en,de}.json` have `inspector.revealInFinder` (en:51 / de:51) but no key for "Move to Bin" / "In den Papierkorb verschieben".
- **Keyboard shortcut** — `src/hooks/useKeyboardNav.ts:117-140` switch handles arrows + Enter; no Delete/Backspace branch.

### Constraints already in the tree
- `IpcError` variants available: `NotFound`, `Conflict`, `Io(String)`, `Database(String)`, `Invalid(String)`, `Internal(String)`. The `reveal_in_finder` precedent (`Io` for shell failures, `NotFound` for missing path, `Invalid` for non-absolute) is the model.
- AppState shape: `pub db: Mutex<Connection>`, `pub watchers: Mutex<HashMap<i64, WatcherHandle>>`, `pub menu_handles`. The new command needs only `state.db` + `app: AppHandle`.
- Radix is already adopted: `@radix-ui/react-popover@^1.1.15` (`package.json:16`), used in `src/components/viewer/AppearanceControls.tsx`. The `@radix-ui/react-context-menu` package would slot in consistently — but it is **not** currently a dep.
- The existing Grid uses CSS Grid inside a `@tanstack/react-virtual` row at `src/components/Grid.tsx:161-197`; tiles are rendered at `:185-193`. Wrapping each `GridTile` in a Radix `ContextMenu.Root`/`Trigger` works inside the virtualizer because Radix's portal pulls the menu out of the row's `transform`.

## Proposed change

### 1. macOS Trash — Rust side
- Add a new `#[tauri::command] async fn delete_file(state, app, id: i64) -> Result<(), IpcError>` in `src-tauri/src/ipc/files.rs` (after `rescan_library` at `:60`). Steps:
  1. Resolve abs path via existing `db::files::abs_path_for(&conn, id)` (`src-tauri/src/db/files.rs:140`). Drop the lock before the trash call.
  2. Move to Trash via the `trash` crate: `trash::delete(&abs_path).map_err(|e| IpcError::Io(format!("trash failed: {e}")))?`. (See Open Questions for the dep add.)
  3. Re-acquire the DB lock; call `db::files::delete_by_ids(&conn, &[id])`. Drop lock.
  4. Emit `events::files_removed(&app, vec![id])` — same helper the watcher already calls.
- Register in `src-tauri/src/lib.rs:149-167` after `ipc::files::rescan_library` at `:156`.
- Path-not-found behaviour: if `abs_path_for` returns `NotFound` (file already gone — race with watcher), still call `delete_by_ids` and emit `files_removed` so the UI converges. Surface other errors verbatim.

### 2. Renderer — IPC + state plumbing
- **`src/ipc/commands.ts`** (after `:76`): add `export function deleteFile(id: number): Promise<void> { return invoke<void>("delete_file", { id }); }`.
- **`src/ipc/events.ts`**: add `FILES_REMOVED = "files:removed"` constant alongside `FILES_ADDED` (`:21`); add `onFilesRemoved(cb: (e: FilesRemovedEvent) => void)` wrapper mirroring `onFilesAdded` (`:40-42`); import `FilesRemovedEvent` from `../generated`.
- **`src/state/files.ts`**: add `removeFiles: (ids: number[]) => void` to the interface (`:9-12`) and implement after `appendFiles` (`:38`). Implementation iterates `filesByLibrary` buckets and deletes the keys; cleans `metadataByFileId` for the same ids. Both maps are id-keyed so this stays O(N_removed).
- **`src/hooks/useLiveEvents.ts`**: select `removeFiles` from the store (mirror `:20-21`); subscribe via `onFilesRemoved((e) => { if (!cancelled) removeFiles(e.fileIds); })` next to `onFilesAdded` (`:43-45`); add the new dep to the effect's deps array (`:66`).
- **Selection cleanup**: if the deleted id matches `useAppStore.getState().selectedFileId` or `viewerFileId` (`src/state/store.ts:19-20`), null them out. Cleanest: do this inside the `removeFiles` action (it can read/write the other store via `useAppStore.getState()` / `setState()`), so both the menu-triggered delete and watcher-triggered delete behave consistently. Alternative: do it in `useLiveEvents` next to the `removeFiles(...)` call — pick whichever the reviewer prefers; flagged in Open Questions.

### 3. Context menu UI
- Wrap each tile in `ContextMenu.Root` / `ContextMenu.Trigger` from `@radix-ui/react-context-menu` (see Open Questions for the dep). Two items:
  - `t("contextMenu.revealInFinder")` → builds path as `` `${library.path}/${file.relPath}` `` (mirror Inspector `:65`) and calls `revealInFinder(...)`.
  - `t("contextMenu.moveToTrash")` → calls `deleteFile(file.id)`. Optimistic: do **not** call `removeFiles` in the click handler; let the `files:removed` event be the single source of truth so external deletions and menu-driven deletions take the same path.
- Cleanest split: keep `GridTile.tsx` presentational and create a new `src/components/GridTileContextMenu.tsx` that wraps it, taking `file` + `library` (or just the absolute path + id). Grid passes `library` into the wrapper (lookup by `file.libraryId` against `librariesStore`). This keeps `GridTile` mounted unchanged inside the virtualizer.
- Selecting a tile on right-click (Finder behaviour): in the `Trigger`'s `onContextMenu` handler, call `setSelectedFile(file.id)` before the menu opens so "right-click → action" matches what the user sees highlighted.
- Suppress the default browser menu globally for the grid container (`src/components/Grid.tsx`) — Radix's `Trigger` already calls `preventDefault`, but adding `onContextMenu={(e) => e.preventDefault()}` to the outer scroll container guarantees no default menu when the user right-clicks between tiles.
- Error handling: surface trash failures inline. Smallest viable: a `useState`-tracked error string rendered as a thin red strip beneath the inspector (mirroring `revealError` at `Inspector.tsx:59, 123-127`). Out of scope to add a global toast system.

### 4. i18n
Add new top-level `contextMenu` namespace to keep the strings co-located and discoverable, instead of overloading `inspector.*` (which is for the right pane). Two keys per locale:
- `src/i18n/locales/en.json`: `"contextMenu": { "revealInFinder": "Reveal in Finder", "moveToTrash": "Move to Bin" }`
- `src/i18n/locales/de.json`: `"contextMenu": { "revealInFinder": "Im Finder anzeigen", "moveToTrash": "In den Papierkorb verschieben" }`

`revealInFinder` is duplicated across `inspector` and `contextMenu` rather than reaching across namespaces — keeps each surface free to drift independently, and the strings are short. (Could collapse later.) `i18next` is initialized at `src/i18n/index.ts:25-34`; new keys are picked up automatically.

## Files to touch

**Rust**
- `src-tauri/Cargo.toml` — add `trash` dep (Open Question).
- `src-tauri/src/ipc/files.rs` — new `delete_file` command after current `rescan_library` (`:52-60`).
- `src-tauri/src/lib.rs` — register `ipc::files::delete_file` in the `generate_handler!` block (`:149-167`).

**TS**
- `src/ipc/commands.ts` — add `deleteFile(id)` after `:76`.
- `src/ipc/events.ts` — add `FILES_REMOVED` constant + `onFilesRemoved` wrapper.
- `src/state/files.ts` — add `removeFiles(ids)` action; clear stale `selectedFileId`/`viewerFileId`.
- `src/hooks/useLiveEvents.ts` — subscribe to `onFilesRemoved`.
- `src/components/GridTileContextMenu.tsx` — **new** wrapper component.
- `src/components/Grid.tsx` — wrap `GridTile` (`:185-193`) in the new context-menu wrapper; pass `library`; add `onContextMenu` preventDefault on the scroll container if needed.
- `src/i18n/locales/en.json` + `src/i18n/locales/de.json` — new `contextMenu` namespace.
- `src/hooks/useKeyboardNav.ts` — optional Delete handler (Open Question).

**Deps**
- `package.json` — `@radix-ui/react-context-menu` (Open Question).

## Open questions

1. **Add `trash` crate to `src-tauri/Cargo.toml`?** Recommend `trash = "5"` (current major). Pure Rust on Linux/Win; on macOS it wraps `NSFileManager.trashItem(at:)` via objc bindings, which is what Finder itself uses — preserves "Put Back", does not require any sandbox entitlement, and works fine under hardened runtime + notarization. Rejected alternatives: `osascript "tell app Finder to move to trash"` (slow, can flash a Finder window, breaks if Finder is quit); `mv ~/.Trash/...` (loses "Put Back" metadata, won't show up correctly in Finder Trash view). **Stop and confirm before adding.**
2. **Add `@radix-ui/react-context-menu` to `package.json`?** Recommend yes, version-aligned with the existing `@radix-ui/react-popover@^1.1.15`. Keeps a11y (keyboard, focus, ARIA roles) and dark-mode handling consistent with the popover already in use. Build-from-scratch with a Tailwind menu is feasible (~50 lines) but reinvents Radix's keyboard handling. **Stop and confirm before adding.**
3. **Confirmation dialog for "Move to Bin"?** Recommend **none**. macOS Finder itself does not confirm a single-file Trash via Delete key, and Trash is recoverable. If we want symmetry with the existing `sidebar.confirmRemove` flow (`en.json:30`, native `confirm()`), it costs ~3 lines. Trade-off: no confirm = one accidental right-click → wrong-item could move a file silently; with confirm = one extra click on every delete. Default to none, revisit if testers misclick.
4. **Selection-cleanup placement?** Inside `removeFiles` (covers both menu and watcher paths in one place) vs. inside `useLiveEvents` (closer to the event source). Recommend inside `removeFiles` for single-source-of-truth.
5. **Delete-key parity?** Recommend yes — `useKeyboardNav.ts:117-140` already handles selection. Add `case "Delete": case "Backspace":` → if `selectedFileId !== null`, call `deleteFile(selectedFileId)`. Same no-confirm / event-driven UI update path. Skip if the no-confirm decision above is contentious; Delete-by-keyboard amplifies misclick risk.
6. **Reveal Inspector button — keep, or remove now that the context menu exists?** Recommend keep for v1 (discoverability for users who haven't tried right-click), revisit after dogfooding.
7. **Hard delete vs soft delete in `files`?** Recommend hard delete (reuse `delete_by_ids`). Reasoning: the file itself is recoverable via macOS Trash, so the DB doesn't need its own undo. A soft-delete column would also need filter conditions in `db::files::list_files` (`:92`), index changes, and a GC step — meaningful surface area for zero user-visible benefit. The existing watcher already hard-deletes for filesystem-detected disappearances, so introducing soft-delete here would create two divergent deletion semantics.
8. **Trash failure surfacing.** Inline error strip (mirror `Inspector` `revealError` at `:59,123-127`) vs silent log + console. Recommend inline near the tile for now; revisit when a global toast system lands.

## Risks

- **`trash` crate vs notarization** — low risk in practice (no special entitlement needed; uses public NSFileManager API). Verify by running `pnpm tauri build` against the local signing identity before shipping.
- **Watcher race** — between menu click and Rust handler, `notify` may already have fired for the trash move (the file disappears from the watched folder), causing two `files:removed` emits with the same id. The frontend listener must tolerate this: `removeFiles([id])` is idempotent because it just deletes a key; double-emit is harmless. The DB `delete_by_ids` returns `Ok(0)` on a missing id (since `DELETE WHERE id = ?` matches zero rows) — also fine.
- **macOS Trash on external volumes** — files on volumes without a `.Trashes` folder fall through to a permanent delete inside the `trash` crate's macOS implementation. For v1 this is acceptable (matches Finder behaviour with a "Put back will not be available" prompt — which we won't show). Document in release notes.
- **Selection state stale** — addressed by clearing `selectedFileId` / `viewerFileId` inside `removeFiles`. Without that, `Inspector` would render against a stale id and show "Loading…" forever.
- **Right-click while a tile is mid-render in the virtualizer** — Radix `ContextMenu` uses portals so this is fine even if the underlying row is recycled mid-action; the menu ref keeps the click context alive.
- **WebView freeze sensitivity** — per `MEMORY.md`, the WebView has been killed by reactive-graph stack overflows in the past. Radix's context menu is not a reactive graph — pure event-driven, used in many Tauri 2 apps. Low risk, but worth a smoke-test scrolling through 5k tiles with the menu mounted.

## Verification

End-to-end:
1. `pnpm tauri dev` (cold start ~2 min).
2. With a library containing ~10 STLs:
   - Right-click a tile → menu appears with "Reveal in Finder" + "Move to Bin", localized to current language.
   - Click "Reveal in Finder" → Finder opens with the file selected.
   - Click "Move to Bin" → the tile disappears within ~100ms, the file lands in `~/.Trash`, and Finder's "Put Back" restores it to the original folder.
   - After "Put Back", the watcher should re-add the file (existing `files:added` path); confirm the tile reappears.
3. Right-click a different tile (one not currently selected) → that tile becomes selected before the menu opens.
4. Press Delete on a selected tile → same behaviour as menu's "Move to Bin" (only if Delete-key parity is approved).
5. Switch to German via Settings → Language → context-menu labels relabel without restart.
6. With the watcher running, delete a file in Finder while the app is open → tile drops within ~1s **without** any library-switch (this is the latent-bug fix).
7. Right-click on a tile while another window is in front → menu still positions correctly (Radix portal handles this).
8. Quick smoke test: scroll a 5k-file library full-speed for 30s, opening + closing the menu randomly — no WebView freeze, no `urx` stack overflow.

Tests (if/when test scaffolding lands): Rust unit test for `delete_file` happy path + missing-file race; TS unit test for `removeFiles` clearing selection.
