import { convertFileSrc } from "@tauri-apps/api/core";
import type { ThumbnailsNeededItem } from "../generated";
import { saveThumbnail } from "../ipc/commands";
import type { RenderJob, RenderResult } from "./render-worker";

// Pool of long-lived workers. Each owns its own OffscreenCanvas + WebGL
// context (~90 MB resident per context). In WKWebView, web workers run in
// the SAME WebContent process as the main thread, so worker memory counts
// against the renderer's macOS Jetsam cap. With 3 workers, ~270 MB stays
// resident forever (long after the initial scan finishes), which has been
// correlated with WebContent termination during sustained grid scroll.
// Dropped to 1: serialises 3MF parsing behind STLs but caps sustained
// worker memory at ~90 MB. Revisit if scan throughput becomes a concern.
const POOL_SIZE = 1;

interface PoolWorker {
  worker: Worker;
  busy: boolean;
  currentKey: string | null;
}

export interface RenderQueue {
  enqueue: (items: ThumbnailsNeededItem[]) => void;
  prioritize: (cacheKeys: string[]) => void;
  drop: (cacheKeys: string[]) => void;
  hasFailed: (cacheKey: string) => boolean;
  dispose: () => void;
  // For diagnostics / tests.
  size: () => number;
}

interface QueueItem extends ThumbnailsNeededItem {
  priority: number; // higher = run first
}

// Module-level singleton so any component can enqueue without threading the
// queue through props / context. `useLiveEvents` owns the lifecycle and calls
// `disposeRenderQueue` on unmount.
let singleton: RenderQueue | null = null;

export function renderQueue(): RenderQueue {
  if (!singleton) singleton = createRenderQueue();
  return singleton;
}

export function disposeRenderQueue(): void {
  singleton?.dispose();
  singleton = null;
}

export function createRenderQueue(): RenderQueue {
  const pool: PoolWorker[] = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const worker = new Worker(
      new URL("./render-worker.ts", import.meta.url),
      { type: "module" },
    );
    const entry: PoolWorker = { worker, busy: false, currentKey: null };
    pool.push(entry);

    worker.addEventListener(
      "message",
      async (ev: MessageEvent<RenderResult>) => {
        const msg = ev.data;
        entry.busy = false;
        entry.currentKey = null;
        if (msg.kind === "ok") {
          try {
            await saveThumbnail(
              msg.cacheKey,
              msg.width,
              msg.height,
              new Uint8Array(msg.png),
            );
          } catch (e) {
            console.error("save_thumbnail failed", msg.cacheKey, e);
          }
        } else {
          console.warn("thumbnail render failed", msg.cacheKey, msg.message);
          failedKeys.add(msg.cacheKey);
        }
        pump();
      },
    );

    worker.addEventListener("error", (ev) => {
      console.error("thumbnail worker error", ev.message, ev.error);
      entry.busy = false;
      entry.currentKey = null;
      pump();
    });
  }

  // FIFO with priority. Duplicate cacheKey entries are collapsed — the first
  // enqueue wins; a later `prioritize` bumps it ahead.
  const queue: QueueItem[] = [];
  const byKey = new Map<string, QueueItem>();
  // Cache keys that failed to render this session. Without this, broken files
  // (e.g. malformed 3MFs) get re-enqueued every time `availableKeys` mutates,
  // and any worker crash on them recurs indefinitely.
  const failedKeys = new Set<string>();

  function sort() {
    queue.sort((a, b) => b.priority - a.priority);
  }

  function isCurrent(cacheKey: string): boolean {
    for (const w of pool) if (w.currentKey === cacheKey) return true;
    return false;
  }

  function pump() {
    for (const w of pool) {
      if (w.busy) continue;
      const next = queue.shift();
      if (!next) return;
      byKey.delete(next.cacheKey);
      w.busy = true;
      w.currentKey = next.cacheKey;
      const job: RenderJob = {
        fileId: next.fileId,
        cacheKey: next.cacheKey,
        meshUrl: convertFileSrc(next.absPath),
        extension: next.extension,
      };
      w.worker.postMessage(job);
    }
  }

  return {
    enqueue(items) {
      let added = false;
      for (const it of items) {
        if (failedKeys.has(it.cacheKey)) continue;
        if (byKey.has(it.cacheKey)) continue;
        if (isCurrent(it.cacheKey)) continue;
        const entry: QueueItem = { ...it, priority: 0 };
        queue.push(entry);
        byKey.set(it.cacheKey, entry);
        added = true;
      }
      if (added) pump();
    },

    hasFailed(cacheKey) {
      return failedKeys.has(cacheKey);
    },

    prioritize(cacheKeys) {
      if (cacheKeys.length === 0) return;
      const boost = new Set(cacheKeys);
      let bumped = false;
      for (const item of queue) {
        if (boost.has(item.cacheKey)) {
          item.priority = Math.max(item.priority, 1);
          bumped = true;
        }
      }
      if (bumped) sort();
    },

    drop(cacheKeys) {
      if (cacheKeys.length === 0) return;
      const drop = new Set(cacheKeys);
      for (let i = queue.length - 1; i >= 0; i--) {
        if (drop.has(queue[i].cacheKey)) {
          byKey.delete(queue[i].cacheKey);
          queue.splice(i, 1);
        }
      }
    },

    dispose() {
      for (const w of pool) w.worker.terminate();
      pool.length = 0;
      queue.length = 0;
      byKey.clear();
      failedKeys.clear();
    },

    size: () => queue.length,
  };
}
