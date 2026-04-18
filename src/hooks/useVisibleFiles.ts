import { useEffect, useState } from "react";
import type { FileEntry } from "../generated";
import { listFiles } from "../ipc/commands";
import { useAppStore } from "../state/store";

// Pulls the current file view from the Rust backend whenever the query shape
// changes. Phase 2's backend always returns `[]`; the scanner in Phase 3 is
// what makes this produce real rows.
export function useVisibleFiles(): FileEntry[] {
  const activeLibraryId = useAppStore((s) => s.activeLibraryId);
  const sortKey = useAppStore((s) => s.sortKey);
  const sortDirection = useAppStore((s) => s.sortDirection);
  const search = useAppStore((s) => s.search);
  const [files, setFiles] = useState<FileEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    listFiles(activeLibraryId, { key: sortKey, direction: sortDirection }, search)
      .then((next) => {
        if (!cancelled) setFiles(next);
      })
      .catch((err) => {
        console.error("list_files failed", err);
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeLibraryId, sortKey, sortDirection, search]);

  return files;
}
