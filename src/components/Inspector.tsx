import { forwardRef, useEffect, useState } from "react";
import type { FileEntry, Library, MeshMetadata } from "../generated";
import { formatBytes, formatColor, formatDate, formatLabel } from "../lib/format";
import { getFileDetails, revealInFinder } from "../ipc/commands";
import { useFilesStore } from "../state/files";

interface Props {
  file: FileEntry | null;
  libraries: Library[];
}

export const Inspector = forwardRef<HTMLDivElement, Props>(function Inspector(
  { file, libraries },
  ref,
) {
  return (
    <aside
      ref={ref}
      tabIndex={-1}
      className="flex h-full flex-col overflow-hidden bg-neutral-100 outline-none ring-inset focus-visible:ring-1 focus-visible:ring-indigo-500/40 dark:bg-neutral-900"
    >
      <div className="border-b border-neutral-200/70 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800/70">
        Inspector
      </div>
      {file ? <Details file={file} libraries={libraries} /> : <EmptyState />}
    </aside>
  );
});

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="h-20 w-20 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700" />
      <p className="text-sm text-neutral-500 dark:text-neutral-400">No file selected</p>
      <p className="text-xs text-neutral-500">
        Pick a tile in the grid to inspect its metadata.
      </p>
    </div>
  );
}

function Details({ file, libraries }: { file: FileEntry; libraries: Library[] }) {
  const library = libraries.find((l) => l.id === file.libraryId);

  const metadataFromStore = useFilesStore((s) => s.metadataByFileId[file.id]);
  const [fetched, setFetched] = useState<MeshMetadata | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  const handleReveal = async () => {
    if (!library) return;
    setRevealError(null);
    try {
      await revealInFinder(`${library.path}/${file.relPath}`);
    } catch (e) {
      setRevealError(String(e));
    }
  };

  useEffect(() => {
    let cancelled = false;
    getFileDetails(file.id)
      .then((details) => {
        if (!cancelled) setFetched(details.metadata ?? null);
      })
      .catch(() => {
        if (!cancelled) setFetched(null);
      });
    return () => {
      cancelled = true;
    };
  }, [file.id]);

  const metadata: MeshMetadata | null = metadataFromStore ?? fetched ?? null;

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <div
        className="flex h-32 w-full items-center justify-center rounded-lg ring-1 ring-inset ring-neutral-300 dark:ring-neutral-800"
        style={{ backgroundColor: formatColor(file.extension) }}
      >
        <span className="rounded bg-black/40 px-2 py-0.5 text-[11px] font-semibold tracking-wider text-white/90">
          {formatLabel(file.extension)}
        </span>
      </div>

      <div>
        <div
          className="break-words text-sm font-medium text-neutral-900 dark:text-neutral-100"
          title={file.name}
        >
          {file.name}
        </div>
        <div
          className="mt-0.5 break-all text-[11px] text-neutral-500"
          title={file.relPath}
        >
          {file.relPath}
        </div>
      </div>

      <dl className="flex flex-col gap-2 text-xs">
        <Row label="Library" value={library?.name ?? "—"} />
        <Row label="Format" value={formatLabel(file.extension)} />
        <Row label="Size" value={formatBytes(file.sizeBytes)} />
        <Row label="Modified" value={formatDate(file.mtimeMs)} />
      </dl>

      <div>
        <button
          type="button"
          onClick={handleReveal}
          disabled={!library}
          className="w-full rounded-md border border-neutral-300 bg-white/70 px-3 py-1.5 text-xs text-neutral-700 transition-colors hover:border-neutral-400 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:text-white"
          title="Reveal in Finder"
        >
          Reveal in Finder
        </button>
        {revealError && (
          <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{revealError}</p>
        )}
      </div>

      {metadata && !metadata.parseError && metadata.bboxMin && metadata.bboxMax && (
        <section className="space-y-1 border-t border-neutral-200 pt-3 text-[12px] text-neutral-700 dark:border-neutral-800 dark:text-neutral-300">
          <div>
            <span className="text-neutral-500">Triangles:</span>{" "}
            {metadata.triangleCount?.toLocaleString() ?? "—"}
          </div>
          <div>
            <span className="text-neutral-500">Size (mm):</span>{" "}
            {(metadata.bboxMax[0] - metadata.bboxMin[0]).toFixed(1)} ×{" "}
            {(metadata.bboxMax[1] - metadata.bboxMin[1]).toFixed(1)} ×{" "}
            {(metadata.bboxMax[2] - metadata.bboxMin[2]).toFixed(1)}
          </div>
          <div>
            <span className="text-neutral-500">Surface area:</span>{" "}
            {metadata.surfaceAreaMm2?.toFixed(1) ?? "—"} mm²
          </div>
          <div>
            <span className="text-neutral-500">Volume:</span>{" "}
            {metadata.volumeMm3 != null
              ? `${metadata.volumeMm3.toFixed(1)} mm³`
              : "— (not watertight)"}
          </div>
        </section>
      )}
      {metadata?.parseError && (
        <section className="border-t border-neutral-200 pt-3 text-[12px] text-red-600 dark:border-neutral-800 dark:text-red-400">
          Parse failed: {metadata.parseError}
        </section>
      )}
      {!metadata && (
        <section className="border-t border-neutral-200 pt-3 text-[12px] text-neutral-500 dark:border-neutral-800">
          Parsing mesh…
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-neutral-200/70 pb-2 last:border-b-0 last:pb-0 dark:border-neutral-800/60">
      <dt className="text-[11px] uppercase tracking-wider text-neutral-500">
        {label}
      </dt>
      <dd className="text-right text-neutral-800 dark:text-neutral-200">{value}</dd>
    </div>
  );
}
