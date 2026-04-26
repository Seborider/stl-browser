import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../state/store";

const DEBOUNCE_MS = 150;

export function SearchBox() {
  const { t } = useTranslation();
  const search = useAppStore((s) => s.search);
  const setSearch = useAppStore((s) => s.setSearch);
  const [value, setValue] = useState(search);

  useEffect(() => {
    if (value === search) return;
    const id = window.setTimeout(() => setSearch(value), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [value, search, setSearch]);

  useEffect(() => {
    if (search !== value) setValue(search);
    // Only sync external changes (e.g. Escape clears selection but not search).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="relative">
      <input
        type="search"
        placeholder={t("toolbar.search")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-7 w-64 rounded-md border border-neutral-200 bg-white pl-7 pr-2 text-xs text-neutral-800 outline-none placeholder:text-neutral-400 transition-colors hover:border-neutral-300 focus:border-indigo-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:hover:border-neutral-700 dark:focus:border-indigo-500"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-neutral-400 dark:text-neutral-500"
      >
        ⌕
      </span>
    </div>
  );
}
