import { mockLibraries, mockFiles } from "../mocks/fixtures";
import { useAppStore } from "../state/store";

const LIBRARY_COUNTS = mockLibraries.map((lib) => ({
  ...lib,
  count: mockFiles.filter((f) => f.libraryId === lib.id).length,
}));

const TOTAL_COUNT = mockFiles.length;

export function Sidebar() {
  const activeLibraryId = useAppStore((s) => s.activeLibraryId);
  const setActiveLibrary = useAppStore((s) => s.setActiveLibrary);

  return (
    <aside className="flex h-full flex-col overflow-hidden bg-neutral-900/60 text-sm">
      <div className="px-4 pt-5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        Libraries
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        <SidebarItem
          label="All Files"
          count={TOTAL_COUNT}
          active={activeLibraryId === null}
          onClick={() => setActiveLibrary(null)}
        />
        {LIBRARY_COUNTS.map((lib) => (
          <SidebarItem
            key={lib.id}
            label={lib.name}
            count={lib.count}
            active={activeLibraryId === lib.id}
            onClick={() => setActiveLibrary(lib.id)}
          />
        ))}
      </nav>
      <div className="mt-auto border-t border-neutral-800/70 px-4 py-3 text-[11px] text-neutral-500">
        Phase 1 · mock data
      </div>
    </aside>
  );
}

interface ItemProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function SidebarItem({ label, count, active, onClick }: ItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "group flex items-center justify-between rounded-md px-3 py-1.5 text-left transition-colors " +
        (active
          ? "bg-indigo-500/15 text-indigo-200"
          : "text-neutral-300 hover:bg-neutral-800/70")
      }
    >
      <span className="truncate">{label}</span>
      <span
        className={
          "ml-3 text-[11px] tabular-nums " +
          (active ? "text-indigo-300/80" : "text-neutral-500")
        }
      >
        {count.toLocaleString()}
      </span>
    </button>
  );
}
