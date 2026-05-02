import { memo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { FileEntry } from "../generated";
import { formatColor, formatLabel } from "../lib/format";
import { useThumbsStore } from "../state/thumbnails";

interface Props {
  file: FileEntry;
  className?: string;
  compact?: boolean;
}

function ThumbnailInner({ file, className, compact = false }: Props) {
  const hasThumb = useThumbsStore((s) => Boolean(s.availableKeys[file.cacheKey]));
  const cacheDir = useThumbsStore((s) => s.cacheDir);
  const src = hasThumb && cacheDir
    ? convertFileSrc(`${cacheDir}/${file.cacheKey}.png`)
    : null;

  return (
    <div
      className={
        (compact ? "relative overflow-hidden " : "relative w-full overflow-hidden ") +
        (className ?? "")
      }
      style={{ backgroundColor: src ? "transparent" : formatColor(file.extension) }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          decoding="sync"
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : null}
      {!compact && (
        <span className="absolute left-1.5 top-1.5 rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-white/90">
          {formatLabel(file.extension)}
        </span>
      )}
    </div>
  );
}

export const Thumbnail = memo(ThumbnailInner);
