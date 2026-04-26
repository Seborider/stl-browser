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
      <label className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-neutral-500">
        Sort
      </label>
      <select
        value={sortKey}
        onChange={(e) => setSort(e.target.value as SortKey)}
        className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-800 outline-none transition-colors hover:border-neutral-300 focus:border-indigo-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-700"
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
        className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 transition-colors hover:border-neutral-300 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:text-white"
      >
        {sortDirection === "asc" ? "▲" : "▼"}
      </button>
    </div>
  );
}
