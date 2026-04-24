import { memo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { FileEntry } from "../generated";
import { formatColor, formatLabel } from "../lib/format";
import { useThumbsStore } from "../state/thumbnails";

interface Props {
  file: FileEntry;
  selected: boolean;
  onSelect: () => void;
  onActivate: () => void;
}

function GridTileInner({ file, selected, onSelect, onActivate }: Props) {
  // Subscribe to the minimum needed for this tile — per-key boolean + cacheDir.
  // At 10k tiles the store subscription cost adds up, so skip the full object.
  const hasThumb = useThumbsStore((s) => Boolean(s.availableKeys[file.cacheKey]));
  const cacheDir = useThumbsStore((s) => s.cacheDir);
  const src = hasThumb && cacheDir
    ? convertFileSrc(`${cacheDir}/${file.cacheKey}.png`)
    : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onActivate}
      aria-selected={selected}
      className={
        "group flex w-full flex-col items-stretch gap-1.5 rounded-lg p-1.5 text-left transition-colors " +
        (selected
          ? "bg-indigo-500/20"
          : "hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60")
      }
    >
      <div
        className={
          "relative aspect-square w-full overflow-hidden rounded-md ring-1 ring-inset " +
          (selected ? "ring-indigo-400" : "ring-neutral-300 dark:ring-neutral-800")
        }
        style={{ backgroundColor: src ? "transparent" : formatColor(file.extension) }}
      >
        {src ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : null}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-white/90">
          {formatLabel(file.extension)}
        </span>
      </div>
      <div
        className={
          "truncate px-0.5 text-[11.5px] " +
          (selected
            ? "text-indigo-900 dark:text-indigo-100"
            : "text-neutral-700 dark:text-neutral-300")
        }
        title={file.name}
      >
        {file.name}
      </div>
    </button>
  );
}

export const GridTile = memo(GridTileInner);
