import { memo } from "react";
import type { FileEntry } from "../generated";
import { formatColor, formatLabel } from "../lib/format";

interface Props {
  file: FileEntry;
  selected: boolean;
  onSelect: () => void;
  onActivate: () => void;
}

function GridTileInner({ file, selected, onSelect, onActivate }: Props) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onActivate}
      aria-selected={selected}
      className={
        "group flex w-full flex-col items-stretch gap-1.5 rounded-lg p-1.5 text-left transition-colors " +
        (selected ? "bg-indigo-500/20" : "hover:bg-neutral-800/60")
      }
    >
      <div
        className={
          "relative aspect-square w-full overflow-hidden rounded-md ring-1 ring-inset " +
          (selected ? "ring-indigo-400" : "ring-neutral-800")
        }
        style={{ backgroundColor: formatColor(file.extension) }}
      >
        <span className="absolute left-1.5 top-1.5 rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-white/90">
          {formatLabel(file.extension)}
        </span>
      </div>
      <div
        className={
          "truncate px-0.5 text-[11.5px] " +
          (selected ? "text-indigo-100" : "text-neutral-300")
        }
        title={file.name}
      >
        {file.name}
      </div>
    </button>
  );
}

export const GridTile = memo(GridTileInner);
