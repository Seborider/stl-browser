# Spike 2 — Tauri asset:// protocol streaming a 100MB STL

Proves that the renderer can `fetch()` a large file via Tauri 2's asset
protocol without OOMing the webview, and quickly enough for the thumbnail
pipeline.

**Target (`PLAN.md` §7):** 100MB STL reaches the renderer in <2s, no OOM.

This is a **minimal standalone Tauri app**, not part of the main project. It
has its own `Cargo.toml`, so the first `cargo build` downloads + compiles
Tauri from scratch (~3–5 min cold).

## Run it

```bash
# 1. Generate the ~100MB fixture (gitignored)
node gen-fixture.mjs

# 2. Launch the spike (first run is a cold Tauri build — be patient)
cargo run --release

#    ... or debug build if you want faster iteration:
cargo run
```

When the Tauri window opens:
1. Click **Run fetch ×3**.
2. Rows appear for each fetch with elapsed time + throughput.
3. The summary row turns green if median <2s, red otherwise.

Paste the numbers into `../RESULTS.md` under Spike 2.

## What the spike proves (or disproves)

| Question | How it's answered |
|---|---|
| Does `asset://localhost/<abs_path>` work in Tauri 2 WKWebView? | The fetch either succeeds or throws. |
| Does it stream, or does Tauri buffer the whole file? | Throughput + JS heap check — a buffered 100MB file would spike heap. Inside WKWebView `performance.memory` is usually not exposed, but an OOM crash is the unambiguous signal. |
| Scope config correct? | If scope misconfigured, fetch fails with 403-style error. |

## Layout

- `Cargo.toml` / `build.rs` / `src/main.rs` — minimal Tauri backend with one
  command (`fixture_path`) returning the absolute path of the fixture.
- `tauri.conf.json` — asset protocol enabled, scope allows `$HOME/**`.
- `capabilities/default.json` — just `core:default`.
- `dist/index.html` + `dist/main.js` — static frontend (no Vite / React).
- `gen-fixture.mjs` — writes `fixture-100mb.stl` (gitignored via `spikes/.gitignore`).

Throwaway — do not import from this in the real app.
