# Spike 3 — Raw-body IPC (1MB Uint8Array → Rust)

Proves Tauri 2's raw-body IPC is fast enough that the thumbnail pipeline can
ship PNGs back to Rust without a temp-file round-trip.

**Targets (`PLAN.md` §7):**
- Raw-body 1MB round-trip median **<20ms**.
- Also measured: JSON-encoded `Vec<u8>` baseline, to confirm the ~4× speedup
  claim in `PLAN.md` §3.

**Fallback if raw-body is unreliable:** write PNG to a temp file via
`tauri-plugin-fs`, pass the temp path to `save_thumbnail`, which moves it
into place. This is the "temp-file fallback" alluded to in §5.

## Run it

```bash
# First run is a cold Tauri compile (deps are cached from Spike 2, so shorter
# than the initial Spike 2 build).
cargo build --release
./target/release/spike3-raw-ipc
```

In the window:
1. Click **Run both** — runs raw-body ×10 and JSON ×5 (JSON is slow, 5 is enough).
2. Paste the `raw-body`, `json-encoded`, and `speedup` rows into `../RESULTS.md`.

## Layout

- `src/main.rs` — two commands: `save_raw(Request<'_>)` using raw-body,
  `save_json(bytes: Vec<u8>)` using standard JSON IPC. Both return the
  received byte count so the JS side can assert correctness.
- `dist/main.js` — issues 1MB test payloads and times each round trip.
- `Cargo.toml` — minimal Tauri deps. `protocol-asset` feature NOT needed
  (no asset protocol used in this spike).
