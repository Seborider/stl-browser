import { useMemo, useRef, useState } from "react";
import type { VirtuosoGridHandle } from "react-virtuoso";
import { Sidebar } from "./components/Sidebar";
import { Grid } from "./components/Grid";
import { Inspector } from "./components/Inspector";
import { ResizeHandle } from "./components/ResizeHandle";
import { SortDropdown } from "./components/SortDropdown";
import { GridSizeSlider } from "./components/GridSizeSlider";
import { SearchBox } from "./components/SearchBox";
import { useAppStore } from "./state/store";
import { useVisibleFiles } from "./hooks/useVisibleFiles";
import { DetailViewer } from "./components/viewer/DetailViewer";
import { useLibraries } from "./hooks/useLibraries";
import { useKeyboardNav } from "./hooks/useKeyboardNav";
import { useLiveEvents } from "./hooks/useLiveEvents";
import { useThumbnailBackfill } from "./hooks/useThumbnailBackfill";
import { clamp } from "./hooks/useResizablePanes";
import "./App.css";

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 400;
const INSPECTOR_MIN = 220;
const INSPECTOR_MAX = 520;

function App() {
  const paneWidths = useAppStore((s) => s.paneWidths);
  const setPaneWidth = useAppStore((s) => s.setPaneWidth);
  const selectedFileId = useAppStore((s) => s.selectedFileId);
  const viewerFileId = useAppStore((s) => s.viewerFileId);
  const setViewerFileId = useAppStore((s) => s.setViewerFileId);

  useLiveEvents();

  const files = useVisibleFiles();
  const { libraries } = useLibraries();
  useThumbnailBackfill(libraries);
  const selectedFile = useMemo(
    () =>
      selectedFileId !== null
        ? files.find((f) => f.id === selectedFileId) ?? null
        : null,
    [files, selectedFileId],
  );
  const viewerFile = useMemo(
    () =>
      viewerFileId !== null
        ? files.find((f) => f.id === viewerFileId) ?? null
        : null,
    [files, viewerFileId],
  );

  const virtuosoRef = useRef<VirtuosoGridHandle | null>(null);
  const inspectorRef = useRef<HTMLDivElement | null>(null);
  const visibleRangeRef = useRef<{ startIndex: number; endIndex: number }>({
    startIndex: 0,
    endIndex: 0,
  });
  const [columns, setColumns] = useState(4);

  useKeyboardNav({
    files,
    columns,
    focusInspector: () => inspectorRef.current?.focus(),
    scrollToIndex: (index) => {
      const { startIndex, endIndex } = visibleRangeRef.current;
      if (index < startIndex || index > endIndex) {
        virtuosoRef.current?.scrollToIndex({
          index,
          align: index < startIndex ? "start" : "end",
          behavior: "auto",
        });
      }
    },
  });

  return (
    <div className="flex h-screen w-screen flex-row overflow-hidden bg-white font-sans text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div
        className="shrink-0"
        style={{ width: paneWidths.sidebar }}
      >
        <Sidebar />
      </div>

      <ResizeHandle
        onDelta={(d) =>
          setPaneWidth(
            "sidebar",
            clamp(paneWidths.sidebar + d, SIDEBAR_MIN, SIDEBAR_MAX),
          )
        }
      />

      <section className="flex min-w-0 flex-1 flex-col bg-neutral-50 dark:bg-neutral-950">
        <Toolbar count={files.length} />
        <div className="min-h-0 flex-1">
          <Grid
            files={files}
            virtuosoRef={virtuosoRef}
            onColumnsChange={setColumns}
            onRangeChanged={(r) => (visibleRangeRef.current = r)}
            onActivate={setViewerFileId}
          />
        </div>
      </section>

      <ResizeHandle
        onDelta={(d) =>
          setPaneWidth(
            "inspector",
            clamp(paneWidths.inspector - d, INSPECTOR_MIN, INSPECTOR_MAX),
          )
        }
      />

      <div
        className="shrink-0"
        style={{ width: paneWidths.inspector }}
      >
        <Inspector ref={inspectorRef} file={selectedFile} libraries={libraries} />
      </div>

      {viewerFile ? (
        <DetailViewer file={viewerFile} onClose={() => setViewerFileId(null)} />
      ) : null}
    </div>
  );
}

function Toolbar({ count }: { count: number }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-200/70 bg-neutral-50/80 px-3 dark:border-neutral-800/70 dark:bg-neutral-900/40">
      <SearchBox />
      <div className="h-5 w-px bg-neutral-200 dark:bg-neutral-800" />
      <SortDropdown />
      <div className="h-5 w-px bg-neutral-200 dark:bg-neutral-800" />
      <GridSizeSlider />
      <div className="ml-auto text-[11px] tabular-nums text-neutral-500">
        {count.toLocaleString()} {count === 1 ? "file" : "files"}
      </div>
    </header>
  );
}

export default App;
