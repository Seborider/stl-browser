import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Library } from "../generated";
import { useAppStore } from "../state/store";
import { useLibraries } from "../hooks/useLibraries";
import { addLibrary, removeLibrary } from "../ipc/commands";

export function Sidebar() {
  const activeLibraryId = useAppStore((s) => s.activeLibraryId);
  const setActiveLibrary = useAppStore((s) => s.setActiveLibrary);
  const { libraries, loading, error, refresh } = useLibraries();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleAdd = async () => {
    if (busy) return;
    setMessage(null);
    try {
      const picked = await open({ directory: true, multiple: false });
      if (!picked || typeof picked !== "string") return;
      setBusy(true);
      const lib = await addLibrary(picked);
      await refresh();
      setActiveLibrary(lib.id);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (lib: Library) => {
    if (busy) return;
    const confirmed = window.confirm(
      `Remove "${lib.name}" from STL Browser?\n\nFiles on disk are not touched.`,
    );
    if (!confirmed) return;
    setMessage(null);
    setBusy(true);
    try {
      await removeLibrary(lib.id);
      if (activeLibraryId === lib.id) setActiveLibrary(null);
      await refresh();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="flex h-full flex-col overflow-hidden bg-neutral-900/60 text-sm">
      <div className="flex items-center justify-between px-4 pt-5 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Libraries
        </span>
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy}
          className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          title="Add a library folder">
          + Add
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 overflow-y-auto px-2">
        <SidebarItem
          label="All Files"
          active={activeLibraryId === null}
          onClick={() => setActiveLibrary(null)}
        />
        {libraries.map((lib) => (
          <SidebarItem
            key={lib.id}
            label={lib.name}
            active={activeLibraryId === lib.id}
            onClick={() => setActiveLibrary(lib.id)}
            onRemove={() => handleRemove(lib)}
          />
        ))}
        {!loading && libraries.length === 0 && (
          <p className="px-3 py-2 text-[11px] text-neutral-500">
            No libraries yet. Click{" "}
            <span className="text-neutral-300">+ Add</span> to pick a folder.
          </p>
        )}
        {error && <p className="px-3 py-2 text-[11px] text-red-400">{error}</p>}
        {message && (
          <p className="px-3 py-2 text-[11px] text-amber-400">{message}</p>
        )}
      </nav>

      <div className="mt-auto border-t border-neutral-800/70 px-4 py-3 text-[11px] text-neutral-500">
        Phase 5 · Thumbnail pipeline
      </div>
    </aside>
  );
}

interface ItemProps {
  label: string;
  active: boolean;
  onClick: () => void;
  onRemove?: () => void;
}

function SidebarItem({ label, active, onClick, onRemove }: ItemProps) {
  return (
    <div
      className={
        "group flex items-center rounded-md transition-colors " +
        (active ? "bg-indigo-500/15" : "hover:bg-neutral-800/70")
      }>
      <button
        type="button"
        onClick={onClick}
        className={
          "min-w-0 flex-1 truncate px-3 py-1.5 text-left " +
          (active ? "text-indigo-200" : "text-neutral-300")
        }>
        {label}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${label}`}
          title={`Remove ${label}`}
          className="mr-1 rounded px-1.5 text-[13px] leading-none text-neutral-500 opacity-0 transition hover:text-red-400 group-hover:opacity-100">
          ×
        </button>
      )}
    </div>
  );
}
