import { create } from "zustand";
import type { FileEntry, MeshMetadata } from "../generated";

interface FilesState {
  // Files keyed by id for O(1) merge from streaming events.
  filesByLibrary: Record<number, Record<number, FileEntry>>;
  metadataByFileId: Record<number, MeshMetadata>;

  setLibraryFiles: (libraryId: number, files: FileEntry[]) => void;
  appendFiles: (files: FileEntry[]) => void;
  setMetadata: (fileId: number, metadata: MeshMetadata) => void;
  libraryFiles: (libraryId: number) => FileEntry[];
}

export const useFilesStore = create<FilesState>((set, get) => ({
  filesByLibrary: {},
  metadataByFileId: {},

  setLibraryFiles: (libraryId, files) =>
    set((s) => ({
      filesByLibrary: {
        ...s.filesByLibrary,
        [libraryId]: Object.fromEntries(files.map((f) => [f.id, f])),
      },
    })),

  appendFiles: (files) =>
    set((s) => {
      const next: Record<number, Record<number, FileEntry>> = {
        ...s.filesByLibrary,
      };
      for (const f of files) {
        const bucket = { ...(next[f.libraryId] ?? {}) };
        bucket[f.id] = f;
        next[f.libraryId] = bucket;
      }
      return { filesByLibrary: next };
    }),

  setMetadata: (fileId, metadata) =>
    set((s) => ({
      metadataByFileId: { ...s.metadataByFileId, [fileId]: metadata },
    })),

  libraryFiles: (libraryId) => {
    const bucket = get().filesByLibrary[libraryId];
    return bucket ? Object.values(bucket) : [];
  },
}));
