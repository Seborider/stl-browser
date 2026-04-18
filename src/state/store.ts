import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SortKey, SortDirection } from "../generated";

export type { SortKey, SortDirection };
export type GridSize = "sm" | "md" | "lg" | "xl";

export interface PaneWidths {
  sidebar: number;
  inspector: number;
}

interface AppState {
  activeLibraryId: number | null;
  selectedFileId: number | null;
  sortKey: SortKey;
  sortDirection: SortDirection;
  search: string;
  gridSize: GridSize;
  paneWidths: PaneWidths;

  setActiveLibrary: (id: number | null) => void;
  setSelectedFile: (id: number | null) => void;
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
      // Bumped name suffix (`:v2`) so the pre-Phase-2 persisted state (which
      // used string ids) doesn't rehydrate into the new `number | null` schema.
      name: "stl-browser:view:v2",
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
