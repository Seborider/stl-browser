import { useEffect } from "react";
import {
  getThumbnailCacheDir,
  listThumbnailKeys,
} from "../ipc/commands";
import {
  onFilesAdded,
  onMetadataReady,
  onThumbnailsNeeded,
  onThumbnailsReady,
} from "../ipc/events";
import { useFilesStore } from "../state/files";
import { useThumbsStore } from "../state/thumbnails";
import { disposeRenderQueue, renderQueue } from "../thumbs/queue";

// Mount once, at the top of the tree. Subscribes to the backend's live events
// and merges them into the files store. Also owns the thumbnail render queue
// for the app's lifetime.
export function useLiveEvents(): void {
  const appendFiles = useFilesStore((s) => s.appendFiles);
  const setMetadata = useFilesStore((s) => s.setMetadata);
  const setCacheDir = useThumbsStore((s) => s.setCacheDir);
  const markAvailable = useThumbsStore((s) => s.markAvailable);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    let cancelled = false;

    // Resolve cache dir + seed the "already rendered" set before the first
    // thumbnails:needed fires, so freshly-listed libraries don't re-render
    // PNGs that already exist on disk from a previous session.
    Promise.all([getThumbnailCacheDir(), listThumbnailKeys()])
      .then(([dir, keys]) => {
        if (cancelled) return;
        setCacheDir(dir);
        markAvailable(keys);
      })
      .catch((err) => console.error("thumbnail bootstrap failed", err));

    // Boot the render queue up front so live events don't race it.
    const queue = renderQueue();

    onFilesAdded((e) => {
      if (!cancelled) appendFiles(e.files);
    }).then((u) => unsubs.push(u));

    onMetadataReady((e) => {
      if (!cancelled) setMetadata(e.fileId, e.metadata);
    }).then((u) => unsubs.push(u));

    onThumbnailsNeeded((e) => {
      if (cancelled) return;
      queue.enqueue(e.items);
    }).then((u) => unsubs.push(u));

    onThumbnailsReady((e) => {
      if (cancelled) return;
      markAvailable([e.cacheKey]);
    }).then((u) => unsubs.push(u));

    return () => {
      cancelled = true;
      for (const u of unsubs) u();
      disposeRenderQueue();
    };
  }, [appendFiles, setMetadata, setCacheDir, markAvailable]);
}
