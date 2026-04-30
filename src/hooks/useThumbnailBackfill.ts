import { useEffect } from "react";
import type { Library, ThumbnailsNeededItem } from "../generated";
import { useFilesStore } from "../state/files";
import { useThumbsStore } from "../state/thumbnails";
import { renderQueue } from "../thumbs/queue";

// Rust only emits `thumbnails:needed` from live scan/watcher events. Files
// already in the DB from a previous session don't fire that event — they just
// load via `list_files`. This hook closes that gap by enqueuing renders for
// any known file whose `cacheKey` doesn't have a PNG yet.
//
// Runs after the thumbs store has its cache dir + availableKeys seeded (via
// useLiveEvents) and whenever the files store / libraries change.
export function useThumbnailBackfill(libraries: Library[]): void {
  const filesByLibrary = useFilesStore((s) => s.filesByLibrary);
  const availableKeys = useThumbsStore((s) => s.availableKeys);
  const cacheDir = useThumbsStore((s) => s.cacheDir);

  useEffect(() => {
    // Wait until the store knows where thumbnails live — before that we can't
    // trust `availableKeys` to be fully seeded.
    if (!cacheDir) return;
    if (libraries.length === 0) return;

    const libById = new Map(libraries.map((l) => [l.id, l]));
    const items: ThumbnailsNeededItem[] = [];
    const seen = new Set<string>();
    const queue = renderQueue();

    for (const [libIdStr, bucket] of Object.entries(filesByLibrary)) {
      const lib = libById.get(Number(libIdStr));
      if (!lib) continue;
      for (const file of Object.values(bucket)) {
        if (availableKeys[file.cacheKey]) continue;
        if (queue.hasFailed(file.cacheKey)) continue;
        if (seen.has(file.cacheKey)) continue;
        seen.add(file.cacheKey);
        items.push({
          fileId: file.id,
          cacheKey: file.cacheKey,
          absPath: joinPath(lib.path, file.relPath),
          extension: file.extension,
        });
      }
    }

    if (items.length > 0) {
      queue.enqueue(items);
    }
  }, [libraries, filesByLibrary, availableKeys, cacheDir]);
}

function joinPath(a: string, b: string): string {
  if (a.endsWith("/")) return a + b;
  return `${a}/${b}`;
}
