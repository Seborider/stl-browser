# CLAUDE.md

Project-specific context for Claude Code. The authoritative architecture and phased build plan lives in `PLAN.md` at the repo root — read it before making non-trivial changes.

## Project

**STL Browser** (working name): a macOS desktop app that acts as a visual preview browser for 3D printing files (STL, 3MF, OBJ). Photos.app-style grid of thumbnails rendered from the user's mesh files.

## Tech stack

- **Backend:** Rust + Tauri 2, tokio, rusqlite (bundled), notify, stl_io / tobj / threemf, blake3, thiserror, ts-rs.
- **Frontend:** React 19 + Vite 7 + TypeScript, Tailwind v4 (via `@tailwindcss/vite`), @react-three/fiber + three.js (detail viewer), react-virtuoso (grid), Zustand (state), shadcn/ui (planned).
- **Package manager:** pnpm (installed via Volta). Do not switch to npm or yarn.

## Commands

```bash
pnpm install          # first-time setup
pnpm tauri dev        # dev window (Vite + cargo watch)
pnpm tauri build      # production bundle (.app + .dmg)
pnpm tauri info       # env sanity check
```

First cold `cargo build` takes 2–5 min; incremental builds are fast.

## Locked-in decisions (don't relitigate without asking)

- **Distribution:** Developer ID + notarized DMG, no sandbox.
- **Rust → TS types:** `ts-rs` (not specta).
- **Architecture:** Apple Silicon (arm64) only for v1.
- **Cache key:** `blake3(abs_path + mtime_ms + size_bytes)`.
- **Thumbnails:** generated in a Web Worker via three.js + OffscreenCanvas, persisted by Rust. See `PLAN.md` §5.

## Repo layout

Top level is the Tauri project (`src/`, `src-tauri/`, `package.json`, `vite.config.ts`, `PLAN.md`, `CLAUDE.md`).

- `src/` — React renderer. Subfolders planned: `ipc/`, `components/`, `state/`, `thumbs/`, `hooks/`, `lib/`, `generated/` (auto-generated bindings, commit but don't hand-edit).
- `src-tauri/` — Rust backend. Split by responsibility: `db/`, `scan/`, `mesh/`, `cache/`, `ipc/`, plus `state.rs`, `events.rs`, `error.rs`, `types.rs`.

See `PLAN.md` §1 for the full planned tree.

## Conventions

- **`PLAN.md` is a living document** — when architecture changes, update `PLAN.md` in the same change, not later.
- **User is a TypeScript dev new to Rust.** Briefly explain Rust-specific patterns (`Result`, `Arc<Mutex<_>>`, lifetimes, tokio) inline when they first show up in a change; don't lecture on them once they're established.
- **Rust organization:** split by responsibility (db, scan, mesh…), not by technical layer.
- **IPC:** all commands return `Result<T, IpcError>`; events are namespaced with colons (`scan:started`, `files:added`, `thumbnails:ready`).
- **SQLite:** migrations live in `src-tauri/src/db/migrations.rs`; apply on startup via schema_version.
- **Thumbnail PNGs** live on disk at `<app_data>/thumbnails/<cache_key>.png`, indexed by the `thumbnails` table.
- **Don't introduce placeholder TODOs or half-finished implementations.** If a phase isn't started, leave the code out entirely.

## Verification

Tauri UI changes cannot be observed from the agent side — after `pnpm tauri dev` confirms it's listening and Rust compiled, ask the user to confirm the visual behavior before claiming a UI task is done.

## Current phase

Phase 2 (Rust data layer: SQLite, migrations, libraries CRUD, ts-rs bindings, folder picker) complete. Next: Phase 3 — scanning + metadata. See `PLAN.md` §2 for the full phased roadmap.

### Bindings workflow
ts-rs bindings regenerate via `pnpm bindings` (runs `cargo test --lib export_bindings_`), chained into `predev` and `prebuild` so `pnpm tauri dev` and `pnpm tauri build` regenerate automatically. Doing it from `build.rs` needs the workspace-split trick (separate types crate) to avoid cargo target-dir lock recursion; revisit if the pnpm chain becomes a problem.
