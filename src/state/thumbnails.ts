import { create } from "zustand";
import { convertFileSrc } from "@tauri-apps/api/core";

// Thumbnails are addressed by `cache_key` (blake3 of abs_path + mtime + size).
// Multiple file rows can share one cache_key when their content is identical.
//
// We don't keep the PNG blob in memory — we rely on the asset:// protocol to
// stream it from disk on demand. This store only tracks (1) where the cache
// dir lives so we can build asset URLs, and (2) which keys currently have a
// PNG so tiles can decide whether to render the image or a placeholder.

interface ThumbsState {
  cacheDir: string | null;
  availableKeys: Record<string, true>;
  // Bumped whenever availableKeys gains entries — used by consumers to
  // invalidate memoized URLs derived from it without keeping the full set
  // as a subscription dependency.
  version: number;

  setCacheDir: (dir: string) => void;
  markAvailable: (keys: string[]) => void;
  thumbnailSrc: (cacheKey: string) => string | null;
}

export const useThumbsStore = create<ThumbsState>((set, get) => ({
  cacheDir: null,
  availableKeys: {},
  version: 0,

  setCacheDir: (dir) => set({ cacheDir: dir }),

  markAvailable: (keys) =>
    set((s) => {
      if (keys.length === 0) return s;
      let changed = false;
      const next = { ...s.availableKeys };
      for (const k of keys) {
        if (!next[k]) {
          next[k] = true;
          changed = true;
        }
      }
      if (!changed) return s;
      return { availableKeys: next, version: s.version + 1 };
    }),

  thumbnailSrc: (cacheKey) => {
    const { cacheDir, availableKeys } = get();
    if (!cacheDir) return null;
    if (!availableKeys[cacheKey]) return null;
    // `?v=<version>` defeats the webview's asset-protocol cache so a
    // regenerated thumbnail (same cache_key is rare, but possible via rescan
    // or a stale-cache bug) actually refreshes in the UI.
    return `${convertFileSrc(`${cacheDir}/${cacheKey}.png`)}?v=${cacheKey.slice(0, 8)}`;
  },
}));
