import { convertFileSrc } from "@tauri-apps/api/core";
import type { ThumbnailsNeededItem } from "../generated";
import { saveThumbnail } from "../ipc/commands";
import type { RenderJob, RenderResult } from "./render-worker";

// Single long-lived worker shared by the app. Spike 1 showed it handles 100k
// and 1M triangle STLs with ~25× headroom vs targets, and a reused canvas +
// renderer stays stable across jobs. One worker keeps WebGL contexts low.

type WorkerStatus = "idle" | "busy";

export interface RenderQueue {
  enqueue: (items: ThumbnailsNeededItem[]) => void;
  prioritize: (cacheKeys: string[]) => void;
  drop: (cacheKeys: string[]) => void;
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
  const worker = new Worker(
    new URL("./render-worker.ts", import.meta.url),
    { type: "module" },
  );

  // FIFO with priority. Duplicate cacheKey entries are collapsed — the first
  // enqueue wins; a later `prioritize` bumps it ahead.
  const queue: QueueItem[] = [];
  const byKey = new Map<string, QueueItem>();
  let status: WorkerStatus = "idle";
  let current: QueueItem | null = null;

  function sort() {
    queue.sort((a, b) => b.priority - a.priority);
  }

  function pump() {
    if (status !== "idle") return;
    const next = queue.shift();
    if (!next) return;
    byKey.delete(next.cacheKey);
    status = "busy";
    current = next;
    const job: RenderJob = {
      fileId: next.fileId,
      cacheKey: next.cacheKey,
      meshUrl: convertFileSrc(next.absPath),
      extension: next.extension,
      width: 512,
      height: 512,
    };
    worker.postMessage(job);
  }

  worker.addEventListener("message", async (ev: MessageEvent<RenderResult>) => {
    const msg = ev.data;
    status = "idle";
    current = null;
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
    }
    pump();
  });

  worker.addEventListener("error", (ev) => {
    console.error("thumbnail worker error", ev.message, ev.error);
    // Free the slot so the queue keeps moving even if one job wedges the worker.
    status = "idle";
    current = null;
    pump();
  });

  return {
    enqueue(items) {
      let added = false;
      for (const it of items) {
        if (byKey.has(it.cacheKey)) continue;
        if (current?.cacheKey === it.cacheKey) continue;
        const entry: QueueItem = { ...it, priority: 0 };
        queue.push(entry);
        byKey.set(it.cacheKey, entry);
        added = true;
      }
      if (added) pump();
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
      worker.terminate();
      queue.length = 0;
      byKey.clear();
    },

    size: () => queue.length,
  };
}
