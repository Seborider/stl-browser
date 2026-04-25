import { memo } from "react";
import type { FileEntry } from "../generated";
import { Thumbnail } from "./Thumbnail";

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
        (selected
          ? "bg-indigo-500/20"
          : "hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60")
      }
    >
      <Thumbnail
        file={file}
        className={
          "aspect-square rounded-md ring-1 ring-inset " +
          (selected ? "ring-indigo-400" : "ring-neutral-300 dark:ring-neutral-800")
        }
      />
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
