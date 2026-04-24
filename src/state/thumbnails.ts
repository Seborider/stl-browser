import { create } from "zustand";

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

  setCacheDir: (dir: string) => void;
  markAvailable: (keys: string[]) => void;
}

export const useThumbsStore = create<ThumbsState>((set) => ({
  cacheDir: null,
  availableKeys: {},

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
      return { availableKeys: next };
    }),
}));
