import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LightConfig, SortKey, SortDirection, ThemeMode } from "../generated";

export type { LightConfig, SortKey, SortDirection, ThemeMode };
export type GridSize = "sm" | "md" | "lg" | "xl";
export type ViewMode = "grid" | "list";

// Mirrored verbatim by the inline bootstrap in index.html — keep them in sync.
export const THEME_LS_KEY = "stl-browser:theme";

export interface PaneWidths {
  sidebar: number;
  inspector: number;
}

interface AppState {
  activeLibraryId: number | null;
  selectedFileId: number | null;
  viewerFileId: number | null;
  sortKey: SortKey;
  sortDirection: SortDirection;
  search: string;
  gridSize: GridSize;
  viewMode: ViewMode;
  themeMode: ThemeMode;
  paneWidths: PaneWidths;
  modelColor: string;
  lights: LightConfig[];
  backgroundColor: string;

  setActiveLibrary: (id: number | null) => void;
  setSelectedFile: (id: number | null) => void;
  setViewerFileId: (id: number | null) => void;
  setSort: (key: SortKey, direction?: SortDirection) => void;
  toggleSortDirection: () => void;
  setSearch: (q: string) => void;
  setGridSize: (size: GridSize) => void;
  setViewMode: (mode: ViewMode) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setPaneWidth: (pane: keyof PaneWidths, width: number) => void;
  setModelColor: (hex: string) => void;
  setLights: (lights: LightConfig[]) => void;
  setBackgroundColor: (hex: string) => void;
}

const DEFAULT_PANES: PaneWidths = { sidebar: 220, inspector: 320 };

// Mirrored in src-tauri/src/types.rs (DEFAULT_MODEL_COLOR etc.) — keep in sync.
export const DEFAULT_MODEL_COLOR = "#c0c0d0";
export const DEFAULT_LIGHT_COLOR = "#ffffff";
export const DEFAULT_LIGHT_AZIMUTH_DEG = 45;
export const DEFAULT_LIGHT_INTENSITY_NORM = 1;
export const DEFAULT_BACKGROUND_COLOR = "#1f1f24";
export const MAX_LIGHTS = 4;

export const DEFAULT_LIGHTS: LightConfig[] = [
  {
    color: DEFAULT_LIGHT_COLOR,
    intensityNorm: DEFAULT_LIGHT_INTENSITY_NORM,
    azimuthDeg: DEFAULT_LIGHT_AZIMUTH_DEG,
    enabled: true,
  },
];

function lightsEqual(a: LightConfig[], b: LightConfig[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.color !== y.color ||
      x.intensityNorm !== y.intensityNorm ||
      x.azimuthDeg !== y.azimuthDeg ||
      x.enabled !== y.enabled
    ) {
      return false;
    }
  }
  return true;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeLibraryId: null,
      selectedFileId: null,
      viewerFileId: null,
      sortKey: "name",
      sortDirection: "asc",
      search: "",
      gridSize: "md",
      viewMode: "grid",
      themeMode: "system",
      paneWidths: DEFAULT_PANES,
      modelColor: DEFAULT_MODEL_COLOR,
      lights: DEFAULT_LIGHTS,
      backgroundColor: DEFAULT_BACKGROUND_COLOR,

      setActiveLibrary: (id) =>
        set({ activeLibraryId: id, selectedFileId: null }),
      setSelectedFile: (id) => set({ selectedFileId: id }),
      setViewerFileId: (id) => set({ viewerFileId: id }),
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
      setViewMode: (mode) =>
        set((s) => (s.viewMode === mode ? s : { viewMode: mode })),
      setThemeMode: (mode) =>
        set((s) => {
          if (s.themeMode === mode) return s;
          try {
            localStorage.setItem(THEME_LS_KEY, mode);
          } catch {}
          return { themeMode: mode };
        }),
      setPaneWidth: (pane, width) =>
        set((s) => ({ paneWidths: { ...s.paneWidths, [pane]: width } })),
      setModelColor: (hex) =>
        set((s) => {
          const normalized = hex.toLowerCase();
          return s.modelColor === normalized ? s : { modelColor: normalized };
        }),
      setLights: (lights) =>
        set((s) => (lightsEqual(s.lights, lights) ? s : { lights })),
      setBackgroundColor: (hex) =>
        set((s) => {
          const normalized = hex.toLowerCase();
          return s.backgroundColor === normalized
            ? s
            : { backgroundColor: normalized };
        }),
    }),
    {
      // Bumped name suffix (`:v2`) so the pre-Phase-2 persisted state (which
      // used string ids) doesn't rehydrate into the new `number | null` schema.
      name: "stl-browser:view:v2",
      partialize: (s) => ({
        sortKey: s.sortKey,
        sortDirection: s.sortDirection,
        gridSize: s.gridSize,
        viewMode: s.viewMode,
        paneWidths: s.paneWidths,
        activeLibraryId: s.activeLibraryId,
      }),
    },
  ),
);
