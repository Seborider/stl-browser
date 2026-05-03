import { create } from "zustand";
import type { FileEntry, MeshMetadata } from "../generated";
import { useAppStore } from "./store";

interface FilesState {
  // Files keyed by id for O(1) merge from streaming events.
  filesByLibrary: Record<number, Record<number, FileEntry>>;
  metadataByFileId: Record<number, MeshMetadata>;

  setLibraryFiles: (libraryId: number, files: FileEntry[]) => void;
  appendFiles: (files: FileEntry[]) => void;
  removeFiles: (ids: number[]) => void;
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

  removeFiles: (ids) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    set((s) => {
      const nextFiles: Record<number, Record<number, FileEntry>> = {};
      let filesChanged = false;
      for (const [libIdStr, bucket] of Object.entries(s.filesByLibrary)) {
        const libId = Number(libIdStr);
        const bucketKeys = Object.keys(bucket);
        const filtered: Record<number, FileEntry> = {};
        let bucketChanged = false;
        for (const k of bucketKeys) {
          const fileId = Number(k);
          if (idSet.has(fileId)) {
            bucketChanged = true;
            continue;
          }
          filtered[fileId] = bucket[fileId];
        }
        nextFiles[libId] = bucketChanged ? filtered : bucket;
        if (bucketChanged) filesChanged = true;
      }

      let nextMetadata = s.metadataByFileId;
      let metaChanged = false;
      for (const id of ids) {
        if (id in nextMetadata) {
          if (!metaChanged) {
            nextMetadata = { ...nextMetadata };
            metaChanged = true;
          }
          delete nextMetadata[id];
        }
      }

      if (!filesChanged && !metaChanged) return s;
      return {
        filesByLibrary: filesChanged ? nextFiles : s.filesByLibrary,
        metadataByFileId: nextMetadata,
      };
    });

    // Clear selection / open viewer if either pointed at a deleted id.
    // Done outside `set` so the cross-store update doesn't tear with this one.
    const app = useAppStore.getState();
    if (app.selectedFileId !== null && idSet.has(app.selectedFileId)) {
      app.setSelectedFile(null);
    }
    if (app.viewerFileId !== null && idSet.has(app.viewerFileId)) {
      app.setViewerFileId(null);
    }
  },

  setMetadata: (fileId, metadata) =>
    set((s) => ({
      metadataByFileId: { ...s.metadataByFileId, [fileId]: metadata },
    })),

  libraryFiles: (libraryId) => {
    const bucket = get().filesByLibrary[libraryId];
    return bucket ? Object.values(bucket) : [];
  },
}));
