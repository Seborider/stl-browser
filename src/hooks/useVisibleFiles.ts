import { useMemo } from "react";
import { mockFiles, type MockFile } from "../mocks/fixtures";
import { useAppStore, type SortKey, type SortDirection } from "../state/store";
import { createFuse } from "../lib/fuse";

const fuseByLibrary = new Map<string, ReturnType<typeof createFuse>>();

function getFuse(libraryId: string | null): ReturnType<typeof createFuse> {
  const key = libraryId ?? "__all__";
  let cached = fuseByLibrary.get(key);
  if (!cached) {
    const pool = libraryId
      ? mockFiles.filter((f) => f.libraryId === libraryId)
      : mockFiles;
    cached = createFuse(pool);
    fuseByLibrary.set(key, cached);
  }
  return cached;
}

function compare(a: MockFile, b: MockFile, key: SortKey): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    case "size":
      return a.sizeBytes - b.sizeBytes;
    case "mtime":
      return a.mtimeMs - b.mtimeMs;
    case "format":
      return a.format.localeCompare(b.format);
  }
}

function sortFiles(
  files: MockFile[],
  key: SortKey,
  direction: SortDirection,
): MockFile[] {
  const sorted = [...files].sort((a, b) => compare(a, b, key));
  if (direction === "desc") sorted.reverse();
  return sorted;
}

export function useVisibleFiles(): MockFile[] {
  const activeLibraryId = useAppStore((s) => s.activeLibraryId);
  const sortKey = useAppStore((s) => s.sortKey);
  const sortDirection = useAppStore((s) => s.sortDirection);
  const search = useAppStore((s) => s.search);

  return useMemo(() => {
    const query = search.trim();
    let base: MockFile[];

    if (query.length > 0) {
      base = getFuse(activeLibraryId)
        .search(query)
        .map((r) => r.item);
      // Fuse returns in relevance order. Only apply explicit sort when user
      // picks a non-default key; for default name-asc, keep relevance.
      if (sortKey === "name" && sortDirection === "asc") {
        return base;
      }
    } else {
      base = activeLibraryId
        ? mockFiles.filter((f) => f.libraryId === activeLibraryId)
        : mockFiles;
    }

    return sortFiles(base, sortKey, sortDirection);
  }, [activeLibraryId, sortKey, sortDirection, search]);
}
