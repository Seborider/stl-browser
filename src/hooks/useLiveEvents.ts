import { useEffect } from "react";
import { onFilesAdded, onMetadataReady } from "../ipc/events";
import { useFilesStore } from "../state/files";

// Mount once, at the top of the tree. Subscribes to the backend's live events
// and merges them into the files store. Returns nothing.
export function useLiveEvents(): void {
  const appendFiles = useFilesStore((s) => s.appendFiles);
  const setMetadata = useFilesStore((s) => s.setMetadata);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    let cancelled = false;

    onFilesAdded((e) => {
      if (!cancelled) appendFiles(e.files);
    }).then((u) => unsubs.push(u));

    onMetadataReady((e) => {
      if (!cancelled) setMetadata(e.fileId, e.metadata);
    }).then((u) => unsubs.push(u));

    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, [appendFiles, setMetadata]);
}
