import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FileEntry } from "../generated";
import { useAppStore, type GridSize } from "../state/store";
import { GridTile } from "./GridTile";

const TILE_MIN_PX: Record<GridSize, number> = {
  sm: 96,
  md: 140,
  lg: 200,
  xl: 280,
  xxl: Number.POSITIVE_INFINITY,
};

// Approximate name-row + padding height added on top of the square tile.
// GridTile is `flex flex-col p-1.5 gap-1.5` containing an aspect-square
// thumbnail and a single-line name; ~23px on top of the thumb's edge length.
const TILE_LABEL_PX = 23;
const GRID_GAP_PX = 8;
const GRID_PAD_PX = 12;
// Lower overscan = fewer GridTiles alive at once = fewer concurrent image
// decodes during fast scroll. Correlated with WebContent renderer death
// under sustained scroll across grid sizes.
const OVERSCAN_ROWS = 2;
const OVERSCAN_ROWS_XXL = 1;

export interface GridHandle {
  scrollToIndex: (opts: { index: number; align?: "start" | "end" }) => void;
}

interface Props {
  files: FileEntry[];
  virtuosoRef: Ref<GridHandle | null>;
  onColumnsChange: (columns: number) => void;
  onRangeChanged: (range: { startIndex: number; endIndex: number }) => void;
  onActivate: (fileId: number) => void;
}

// Replaced VirtuosoGrid with @tanstack/react-virtual to escape a recurring
// main-thread RangeError inside react-virtuoso's reactive (urx) graph that
// freezes the WebView. Tanstack's virtualizer is a plain function over scroll
// position + measurements, no pub/sub graph, so it cannot exhibit this class
// of bug. We only virtualize rows; each row CSS-grids its visible items.
export function Grid({
  files,
  virtuosoRef,
  onColumnsChange,
  onRangeChanged,
  onActivate,
}: Props) {
  const gridSize = useAppStore((s) => s.gridSize);
  const selectedFileId = useAppStore((s) => s.selectedFileId);
  const setSelectedFile = useAppStore((s) => s.setSelectedFile);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    setContainerHeight(el.clientHeight);
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const tileMin = TILE_MIN_PX[gridSize];
  const columns = useMemo(() => {
    const inner = Math.max(0, containerWidth - GRID_PAD_PX * 2);
    const approx = Math.floor((inner + GRID_GAP_PX) / (tileMin + GRID_GAP_PX));
    return Math.max(1, approx);
  }, [containerWidth, tileMin]);

  useEffect(() => {
    onColumnsChange(columns);
  }, [columns, onColumnsChange]);

  // Tile width derives from container width, columns, gap. Height = width
  // (aspect-square thumb) + label row.
  const tileWidth = useMemo(() => {
    const inner = Math.max(0, containerWidth - GRID_PAD_PX * 2);
    const totalGap = GRID_GAP_PX * Math.max(0, columns - 1);
    return Math.max(0, (inner - totalGap) / columns);
  }, [containerWidth, columns]);

  const rowHeight = gridSize === "xxl"
    ? Math.max(1, containerHeight - GRID_PAD_PX * 2)
    : Math.max(1, Math.round(tileWidth + TILE_LABEL_PX));
  const rowCount = Math.ceil(files.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight + GRID_GAP_PX,
    overscan: gridSize === "xxl" ? OVERSCAN_ROWS_XXL : OVERSCAN_ROWS,
  });

  // Re-measure when row height or column count changes.
  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, columns, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  // Notify parent of visible item-index range. Used by keyboard nav to skip
  // scrolling when a target is already on screen.
  useEffect(() => {
    if (virtualItems.length === 0) {
      onRangeChanged({ startIndex: 0, endIndex: 0 });
      return;
    }
    const first = virtualItems[0];
    const last = virtualItems[virtualItems.length - 1];
    onRangeChanged({
      startIndex: first.index * columns,
      endIndex: Math.min(files.length - 1, (last.index + 1) * columns - 1),
    });
  }, [virtualItems, columns, files.length, onRangeChanged]);

  useImperativeHandle(
    virtuosoRef,
    () => ({
      scrollToIndex: ({ index, align }) => {
        const row = Math.floor(index / Math.max(1, columns));
        virtualizer.scrollToIndex(row, { align: align === "end" ? "end" : "start" });
      },
    }),
    [columns, virtualizer],
  );

  const totalSize = virtualizer.getTotalSize();

  if (files.length === 0) {
    return (
      <div ref={scrollRef} className="h-full w-full overflow-auto">
        <EmptyState />
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="h-full w-full overflow-auto"
      style={{ contain: "strict" }}
    >
      <div
        style={{
          height: totalSize + GRID_PAD_PX * 2,
          position: "relative",
        }}
      >
        {virtualItems.map((vRow) => {
          const rowStart = vRow.index * columns;
          const rowFiles = files.slice(rowStart, rowStart + columns);
          return (
            <div
              key={vRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: GRID_PAD_PX,
                right: GRID_PAD_PX,
                transform: `translateY(${vRow.start + GRID_PAD_PX}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: `${GRID_GAP_PX}px`,
                // Let WebKit fully skip painting + image decode for
                // off-screen rows. Caps GPU/decode pressure during long
                // scroll, which has been correlated with WebContent renderer
                // death.
                contentVisibility: "auto",
                containIntrinsicSize: `0 ${rowHeight}px`,
                ...(gridSize === "xxl" ? { height: rowHeight } : {}),
              }}
            >
              {rowFiles.map((file) => (
                <GridTile
                  key={file.id}
                  file={file}
                  gridSize={gridSize}
                  selected={file.id === selectedFileId}
                  onSelect={() => setSelectedFile(file.id)}
                  onActivate={() => onActivate(file.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
      {t("grid.empty")}
    </div>
  );
}
