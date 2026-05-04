# STL Browser

A macOS desktop preview browser for 3D printing files.

## Overview

STL Browser is a macOS desktop application that acts as a Photos.app-style preview browser for 3D printing files (`.stl`, `.3mf`, `.obj`). It renders thumbnails directly from the user's local mesh files and presents them in a virtualized grid alongside metadata and a detail viewer with orbit/pan/zoom.

Apple Silicon (arm64) only for v1. The architecture and phased build plan live in [PLAN.md](PLAN.md).

## Tech Stack

**Backend**
- Rust + Tauri 2
- tokio
- rusqlite (bundled)
- notify
- stl_io / tobj / threemf
- blake3
- ts-rs

**Frontend**
- React 19
- Vite 7
- TypeScript
- Tailwind v4
- @react-three/fiber + three.js
- @tanstack/react-virtual
- Zustand

## Requirements

- macOS 12.0 or later
- Apple Silicon (arm64)
- Rust toolchain (via [rustup](https://rustup.rs/))
- Node.js
- pnpm (installed via [Volta](https://volta.sh/))

## Build & Run

Install dependencies:

```bash
pnpm install
```

Run the app in development mode (Vite + cargo watch):

```bash
pnpm tauri dev
```

Produce a release build (`.app` and `.dmg`):

```bash
pnpm tauri build --target aarch64-apple-darwin
```

The first cold `cargo build` takes 2–5 minutes; incremental builds are fast.

Release artifacts are written to:

- `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/` — the `.app` bundle
- `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/` — the distributable `.dmg`

## Project Structure

```
3dbrowser/
├── PLAN.md         # architecture and phased build plan (living document)
├── CLAUDE.md       # project-specific context for Claude Code
├── src/            # React renderer (TypeScript)
└── src-tauri/      # Rust backend (Tauri 2)
```

## License

This project is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for the full text.
