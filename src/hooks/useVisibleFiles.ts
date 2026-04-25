import { useEffect, useMemo } from "react";
import type { FileEntry } from "../generated";
import { listFiles } from "../ipc/commands";
import { useAppStore } from "../state/store";
import { useFilesStore } from "../state/files";

// Fetches the file view from the Rust backend when (library, sort, search)
// changes, writes it into the files store as the baseline, and returns a
// client-side view that merges live `files:added` rows into that baseline.
export function useVisibleFiles(): FileEntry[] {
  const activeLibraryId = useAppStore((s) => s.activeLibraryId);
  const sortKey = useAppStore((s) => s.sortKey);
  const sortDirection = useAppStore((s) => s.sortDirection);
  const search = useAppStore((s) => s.search);

  const setLibraryFiles = useFilesStore((s) => s.setLibraryFiles);
  const filesByLibrary = useFilesStore((s) => s.filesByLibrary);

  useEffect(() => {
    let cancelled = false;
    listFiles({
      libraryId: activeLibraryId,
      sort: { key: sortKey, direction: sortDirection },
      search,
    })
      .then((rows) => {
        if (cancelled) return;
        if (activeLibraryId != null) {
          setLibraryFiles(activeLibraryId, rows);
        } else {
          // "All Files": fan rows out into per-library buckets so the
          // flattened view below can read them, and so live `files:added`
          // merges keep working through the existing per-library store.
          const grouped = new Map<number, FileEntry[]>();
          for (const row of rows) {
            const bucket = grouped.get(row.libraryId);
            if (bucket) bucket.push(row);
            else grouped.set(row.libraryId, [row]);
          }
          for (const [libId, libRows] of grouped) {
            setLibraryFiles(libId, libRows);
          }
        }
      })
      .catch((err) => {
        console.error("list_files failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [activeLibraryId, sortKey, sortDirection, search, setLibraryFiles]);

  // Client-side apply of sort + search to the store bucket so freshly-appended
  // rows sort correctly without a new backend round-trip. The backend's order
  // is authoritative on initial load; the merged view replays the same sort.
  return useMemo(() => {
    const all =
      activeLibraryId == null
        ? Object.values(filesByLibrary).flatMap((bucket) =>
            Object.values(bucket),
          )
        : Object.values(filesByLibrary[activeLibraryId] ?? {});
    const q = search.trim().toLowerCase();
    const filtered = q
      ? all.filter((f) => f.name.toLowerCase().includes(q))
      : all;
    const dir = sortDirection === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return dir * a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        case "size":
          return dir * (a.sizeBytes - b.sizeBytes);
        case "mtime":
          return dir * (a.mtimeMs - b.mtimeMs);
        case "format":
          return (
            dir *
            (a.extension.localeCompare(b.extension) ||
              a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
          );
      }
    });
    return filtered;
  }, [activeLibraryId, filesByLibrary, search, sortKey, sortDirection]);
}
