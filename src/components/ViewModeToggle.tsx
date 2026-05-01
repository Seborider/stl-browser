import { useTranslation } from "react-i18next";
import { useAppStore, type ViewMode } from "../state/store";

const MODES: ViewMode[] = ["list", "grid"];
const LABEL_KEYS: Record<ViewMode, "toolbar.viewGrid" | "toolbar.viewList"> = {
  grid: "toolbar.viewGrid",
  list: "toolbar.viewList",
};

export function ViewModeToggle() {
  const { t } = useTranslation();
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-wider text-neutral-500">
        {t("toolbar.view")}
      </span>
      <div
        role="group"
        aria-label={t("toolbar.viewMode")}
        className="flex items-center rounded-md border border-neutral-200 bg-white p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            aria-pressed={viewMode === mode}
            title={t(LABEL_KEYS[mode])}
            className={
              "flex h-6 items-center justify-center rounded-[5px] px-2 text-[11px] font-medium transition-colors " +
              (viewMode === mode
                ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700/70 dark:text-white"
                : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200")
            }>
            {mode === "grid" ? <GridIcon /> : <ListIcon />}
          </button>
        ))}
      </div>
    </div>
  );
}

function GridIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true">
      <rect x="1" y="1" width="4" height="4" rx="0.5" fill="currentColor" />
      <rect x="7" y="1" width="4" height="4" rx="0.5" fill="currentColor" />
      <rect x="1" y="7" width="4" height="4" rx="0.5" fill="currentColor" />
      <rect x="7" y="7" width="4" height="4" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true">
      <rect x="1" y="2" width="10" height="1.5" rx="0.5" fill="currentColor" />
      <rect
        x="1"
        y="5.25"
        width="10"
        height="1.5"
        rx="0.5"
        fill="currentColor"
      />
      <rect
        x="1"
        y="8.5"
        width="10"
        height="1.5"
        rx="0.5"
        fill="currentColor"
      />
    </svg>
  );
}
