import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SortKey = "name" | "size" | "mtime" | "format";
export type SortDirection = "asc" | "desc";
export type GridSize = "sm" | "md" | "lg" | "xl";

export interface PaneWidths {
  sidebar: number;
  inspector: number;
}

interface AppState {
  activeLibraryId: string | null;
  selectedFileId: string | null;
  sortKey: SortKey;
  sortDirection: SortDirection;
  search: string;
  gridSize: GridSize;
  paneWidths: PaneWidths;

  setActiveLibrary: (id: string | null) => void;
  setSelectedFile: (id: string | null) => void;
  setSort: (key: SortKey, direction?: SortDirection) => void;
  toggleSortDirection: () => void;
  setSearch: (q: string) => void;
  setGridSize: (size: GridSize) => void;
  setPaneWidth: (pane: keyof PaneWidths, width: number) => void;
}

const DEFAULT_PANES: PaneWidths = { sidebar: 220, inspector: 320 };

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeLibraryId: null,
      selectedFileId: null,
      sortKey: "name",
      sortDirection: "asc",
      search: "",
      gridSize: "md",
      paneWidths: DEFAULT_PANES,

      setActiveLibrary: (id) =>
        set({ activeLibraryId: id, selectedFileId: null }),
      setSelectedFile: (id) => set({ selectedFileId: id }),
      setSort: (key, direction) =>
        set((s) => ({
          sortKey: key,
          sortDirection: direction ?? s.sortDirection,
        })),
      toggleSortDirection: () =>
        set((s) => ({
          sortDirection: s.sortDirection === "asc" ? "desc" : "asc",
        })),
      setSearch: (q) => set({ search: q, selectedFileId: null }),
      setGridSize: (size) => set({ gridSize: size }),
      setPaneWidth: (pane, width) =>
        set((s) => ({ paneWidths: { ...s.paneWidths, [pane]: width } })),
    }),
    {
      name: "stl-browser:view",
      partialize: (s) => ({
        sortKey: s.sortKey,
        sortDirection: s.sortDirection,
        gridSize: s.gridSize,
        paneWidths: s.paneWidths,
        activeLibraryId: s.activeLibraryId,
      }),
    },
  ),
);
