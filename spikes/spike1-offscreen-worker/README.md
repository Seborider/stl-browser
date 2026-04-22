# Spike 1 — OffscreenCanvas + three.js in a Web Worker

Proves that a Web Worker can parse an STL, render it to a 512×512 PNG via an
OffscreenCanvas, and post the PNG back — fast enough for the thumbnail
pipeline.

**Targets (`PLAN.md` §7):**
- 100k-triangle STL: render in <300ms (worker-side, message-in → bytes-out)
- 1M-triangle STL: render in <2s

## Run it

From this directory:

```bash
# 1. Generate test fixtures (~5MB and ~50MB STLs, gitignored)
node gen-stl.mjs

# 2. Serve over HTTP — required because ES modules + workers don't work over file://
python3 -m http.server 8765

# 3. Open http://localhost:8765 in Safari (same WebKit engine as Tauri's WKWebView)
```

Click "Run both" — the page will run each fixture three times (after a warm-up
pass), then report min / median / max worker-side elapsed time.

Transfer the measured numbers into `../RESULTS.md` when done.

## Why Safari

The STL Browser app ships in a Tauri window, which on macOS uses WKWebView —
same WebKit engine as Safari. Chrome / Firefox behave differently; we care
about Safari's results for the real decision.

## Layout

- `gen-stl.mjs` — Node script that emits `fixture-100k.stl` and `fixture-1m.stl`
  (binary STL, a displaced grid).
- `index.html` — entry page, import map, UI.
- `main.js` — main-thread: fetches STL, ships it (transferable) to the worker,
  awaits the PNG, records timings.
- `render-worker.js` — the worker: parses with three.js `STLLoader`, renders
  on a reused `OffscreenCanvas`, encodes PNG, posts the bytes back.

Everything in `spikes/` is throwaway. Do not import from it in the real app.
