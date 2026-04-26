import { memo } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { FileEntry } from "../generated";
import { useAppStore } from "../state/store";
import { formatBytes, formatDate, formatLabel } from "../lib/format";
import { Thumbnail } from "./Thumbnail";

interface Props {
  files: FileEntry[];
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  onRangeChanged: (range: { startIndex: number; endIndex: number }) => void;
  onActivate: (fileId: number) => void;
}

const ROW_HEIGHT_PX = 36;

export function List({ files, virtuosoRef, onRangeChanged, onActivate }: Props) {
  const selectedFileId = useAppStore((s) => s.selectedFileId);
  const setSelectedFile = useAppStore((s) => s.setSelectedFile);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <ListHeader />
      <Virtuoso
        ref={virtuosoRef}
        style={{ flex: 1, minHeight: 0 }}
        data={files}
        overscan={400}
        increaseViewportBy={300}
        rangeChanged={onRangeChanged}
        computeItemKey={(_, file) => file.id}
        components={{ EmptyPlaceholder: EmptyState }}
        itemContent={(_, file) => (
          <ListRow
            file={file}
            selected={file.id === selectedFileId}
            onSelect={setSelectedFile}
            onActivate={onActivate}
          />
        )}
      />
    </div>
  );
}

function ListHeader() {
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-b border-neutral-200/70 bg-neutral-50/80 px-3 text-[10.5px] font-medium uppercase tracking-wider text-neutral-500 dark:border-neutral-800/70 dark:bg-neutral-900/40">
      <div className="w-6 shrink-0" />
      <div className="min-w-0 flex-1">Name</div>
      <div className="w-12 shrink-0 text-right">Type</div>
      <div className="w-16 shrink-0 text-right">Size</div>
      <div className="w-24 shrink-0 text-right">Modified</div>
    </div>
  );
}

interface RowProps {
  file: FileEntry;
  selected: boolean;
  onSelect: (fileId: number) => void;
  onActivate: (fileId: number) => void;
}

function ListRowInner({ file, selected, onSelect, onActivate }: RowProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(file.id)}
      onDoubleClick={() => onActivate(file.id)}
      aria-selected={selected}
      style={{ height: ROW_HEIGHT_PX }}
      className={
        "flex w-full items-center gap-3 overflow-hidden px-3 text-left transition-colors " +
        (selected
          ? "bg-indigo-500/20 text-indigo-900 dark:text-indigo-100"
          : "text-neutral-700 hover:bg-neutral-200/50 dark:text-neutral-300 dark:hover:bg-neutral-800/50")
      }
    >
      <Thumbnail
        file={file}
        compact
        className="h-6 w-6 shrink-0 rounded ring-1 ring-inset ring-neutral-300 dark:ring-neutral-800"
      />
      <div className="min-w-0 flex-1 truncate text-[12.5px]" title={file.name}>
        {file.name}
      </div>
      <div className="w-12 shrink-0 text-right text-[11px] font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
        {formatLabel(file.extension)}
      </div>
      <div className="w-16 shrink-0 text-right text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
        {formatBytes(file.sizeBytes)}
      </div>
      <div className="w-24 shrink-0 text-right text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
        {formatDate(file.mtimeMs)}
      </div>
    </button>
  );
}

const ListRow = memo(ListRowInner);

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
      No files yet. Add a library folder to get started — scanning lands in Phase 3.
    </div>
  );
}
