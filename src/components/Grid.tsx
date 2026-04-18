import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { VirtuosoGrid, type VirtuosoGridHandle } from "react-virtuoso";
import type { FileEntry } from "../generated";
import { useAppStore, type GridSize } from "../state/store";
import { GridTile } from "./GridTile";

const TILE_MIN_PX: Record<GridSize, number> = {
  sm: 96,
  md: 140,
  lg: 200,
  xl: 280,
};

const GRID_GAP_PX = 8;
const GRID_PAD_PX = 12;

interface Props {
  files: FileEntry[];
  virtuosoRef: React.RefObject<VirtuosoGridHandle | null>;
  onColumnsChange: (columns: number) => void;
  onRangeChanged: (range: { startIndex: number; endIndex: number }) => void;
  onActivate: () => void;
}

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

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
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

  const components = useMemo(
    () => ({
      List: forwardRef<HTMLDivElement, { style?: React.CSSProperties; children?: React.ReactNode }>(
        function List({ style, children }, ref) {
          return (
            <div
              ref={ref}
              style={{
                ...style,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: `${GRID_GAP_PX}px`,
                padding: `${GRID_PAD_PX}px`,
              }}
            >
              {children}
            </div>
          );
        },
      ),
      Item: function Item({
        children,
        ...props
      }: React.HTMLAttributes<HTMLDivElement>) {
        return (
          <div {...props} style={{ width: "100%" }}>
            {children}
          </div>
        );
      },
      EmptyPlaceholder: EmptyState,
    }),
    [columns],
  );

  return (
    <div ref={containerRef} className="h-full w-full">
      <VirtuosoGrid
        ref={virtuosoRef}
        style={{ height: "100%" }}
        data={files}
        overscan={800}
        increaseViewportBy={400}
        components={components}
        rangeChanged={onRangeChanged}
        computeItemKey={(_, file) => file.id}
        itemContent={(_, file) => (
          <GridTile
            file={file}
            selected={file.id === selectedFileId}
            onSelect={() => setSelectedFile(file.id)}
            onActivate={onActivate}
          />
        )}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500">
      No files yet. Add a library folder to get started — scanning lands in Phase 3.
    </div>
  );
}
