import { useAppStore, type SortKey } from "../state/store";

const OPTIONS: { value: SortKey; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "size", label: "Size" },
  { value: "mtime", label: "Modified" },
  { value: "format", label: "Format" },
];

export function SortDropdown() {
  const sortKey = useAppStore((s) => s.sortKey);
  const sortDirection = useAppStore((s) => s.sortDirection);
  const setSort = useAppStore((s) => s.setSort);
  const toggleSortDirection = useAppStore((s) => s.toggleSortDirection);

  return (
    <div className="flex items-center gap-1">
      <label className="text-[11px] uppercase tracking-wider text-neutral-500">
        Sort
      </label>
      <select
        value={sortKey}
        onChange={(e) => setSort(e.target.value as SortKey)}
        className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 outline-none transition-colors hover:border-neutral-700 focus:border-indigo-500"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={toggleSortDirection}
        aria-label={
          sortDirection === "asc" ? "Sort ascending" : "Sort descending"
        }
        title={sortDirection === "asc" ? "Ascending" : "Descending"}
        className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white"
      >
        {sortDirection === "asc" ? "▲" : "▼"}
      </button>
    </div>
  );
}
