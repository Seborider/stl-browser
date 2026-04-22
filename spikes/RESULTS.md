# Phase 5 Spike Results

Throwaway experiments for the thumbnail pipeline. Each spike has a measurable success criterion from `PLAN.md` §7. Numbers recorded here guide the real pipeline decisions.

---

## Spike 1 — OffscreenCanvas + three.js in a Web Worker

**Target (PLAN.md §7):** <300ms for 100k tri STL, <2s for 1M tri STL. Time measured from worker `message` received to PNG `ArrayBuffer` posted back.

**Status:** ✅ pass

**Environment:** macOS, Safari (WKWebView parity), 2026-04-22

| Fixture | Triangles | Worker median (ms) | Min / Max (ms) | PNG size | Pass? |
|---------|-----------|--------------------|----------------|----------|-------|
| fixture-100k.stl | 100,352   | 29 | 26 / 34 | 88.6 KB | ✅ (target <300) |
| fixture-1m.stl   | 999,698   | 80 | 74 / 83 | 84.5 KB | ✅ (target <2000) |

**WebGL in OffscreenCanvas available in this webview?** Yes — both fixtures rendered correctly.

**Notes / observations:**
- ~10× and ~25× headroom vs targets. The bottleneck is not the worker.
- Single reused OffscreenCanvas + renderer survived 3 back-to-back jobs per fixture without degradation.
- esm.sh for three's bare-specifier imports inside the worker works fine in WebKit. Real pipeline will ship three as a local dep instead.

---

## Spike 2 — Tauri asset protocol streaming a 100MB STL

**Target:** <2s, no OOM.

**Status:** ✅ pass

**Environment:** macOS, Tauri 2.10.3 WKWebView, release build, 2026-04-22

| Fixture | Size | Warm-up (ms) | Runs (ms) | Median (ms) | Throughput |
|---------|------|--------------|-----------|-------------|------------|
| fixture-100mb.stl | 100.0 MB | 84 | 54 / 55 / 51 | 54 | ~1.9 GB/s |

**Pass?** ✅ — 54ms median vs <2000ms target (~37× headroom).

**Asset URL format:** `asset://localhost/<percent-encoded-absolute-path>` — so `convertFileSrc(absPath)` is what the real pipeline should use (works the same as an `<img src>` or `fetch()` target).

**Config requirements found:**
- `Cargo.toml`: `tauri` needs `features = ["protocol-asset"]`.
- `tauri.conf.json`: `app.security.assetProtocol.enable = true` plus a `scope` glob covering the library folders. `$HOME/**` worked for the spike; the real pipeline should scope per-library for defense in depth.
- `tauri.conf.json`: `app.withGlobalTauri = true` only needed for the static-HTML spike; the real app uses the `@tauri-apps/api` ESM package via Vite.
- Default icon at `icons/icon.png` required by `tauri::generate_context!()` at compile time.

**Notes:**
- No OOM; webview stayed responsive between and during fetches.
- `performance.memory` is Chromium-only — confirmed unavailable in WKWebView. OOM would be observable as a crash, which did not occur.
- Throughput is memory-bandwidth-bound, not IO — the OS file cache hydrated on warm-up, steady-state is RAM copy.

---

## Spike 3 — Raw-body IPC (1MB Uint8Array → Rust)

**Target:** <20ms round-trip for 1MB. Compare vs JSON-encoded `Vec<u8>`.

**Status:** ✅ pass — raw-body IPC is reliable, no temp-file fallback needed.

**Environment:** macOS, Tauri 2.10.3 WKWebView, release build, 2026-04-22

| Path | n | Min / Median / Max | Pass? |
|------|---|--------------------|-------|
| raw-body (`invoke(cmd, u8array)`, Rust `Request::body() → InvokeBody::Raw`) | 10 | 1.0 / 1.0 / 1.0 ms | ✅ (target <20ms) |
| json-encoded (`invoke(cmd, {bytes: [...]})`, Rust `Vec<u8>`) | 5 | 69 / 74 / 76 ms | baseline |

**Speedup:** raw is **~74× faster** than JSON-encoded `Vec<u8>`. The §3 "~4× slower" note for the JSON baseline understates it — the true ratio on a megabyte-sized `Array.from` / JSON serialise / `Vec<u8>` deserialise chain is much worse.

**Decision:** real pipeline uses raw-body IPC (`save_thumbnail(cacheKey: String, png: Uint8Array)` with the PNG as the raw body). No temp-file fallback.

**API shape that works:**
- JS: `invoke('save_thumbnail', u8array, { headers: { 'x-cache-key': cacheKey } })` — pass the typed array as arg 2, extra scalar args via headers.
- Rust: `fn save_thumbnail(request: tauri::ipc::Request<'_>) -> Result<(), IpcError>`, reading bytes via `request.body() → InvokeBody::Raw(Vec<u8>)` and the cache key via `request.headers()`.

**Notes:**
- Raw path stays ≤1ms even when the test re-slices a fresh ArrayBuffer each iteration — no hidden zero-copy transfer cheat.
- JSON round-trip spends most of its budget in `JSON.stringify` on a 1M-element number array and in serde deserialising that into `Vec<u8>`.
