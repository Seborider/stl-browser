import { useTranslation } from "react-i18next";
import { useAppStore, type GridSize } from "../state/store";

const STEPS: GridSize[] = ["sm", "md", "lg", "xl"];
const LABEL_KEYS: Record<GridSize, "toolbar.gridSm" | "toolbar.gridMd" | "toolbar.gridLg" | "toolbar.gridXl"> = {
  sm: "toolbar.gridSm",
  md: "toolbar.gridMd",
  lg: "toolbar.gridLg",
  xl: "toolbar.gridXl",
};

export function GridSizeSlider() {
  const { t } = useTranslation();
  const gridSize = useAppStore((s) => s.gridSize);
  const setGridSize = useAppStore((s) => s.setGridSize);
  const index = STEPS.indexOf(gridSize);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-wider text-neutral-500">
        {t("toolbar.size")}
      </span>
      <div
        role="group"
        aria-label={t("toolbar.gridSize")}
        className="flex items-center rounded-md border border-neutral-200 bg-white p-0.5 dark:border-neutral-800 dark:bg-neutral-900"
      >
        {STEPS.map((step, i) => (
          <button
            key={step}
            type="button"
            onClick={() => setGridSize(step)}
            aria-pressed={gridSize === step}
            title={t(LABEL_KEYS[step])}
            className={
              "flex h-6 items-center justify-center rounded-[5px] px-2 text-[11px] font-medium transition-colors " +
              (gridSize === step
                ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700/70 dark:text-white"
                : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200")
            }
          >
            <span
              className="inline-block rounded-sm bg-current"
              style={{
                width: 6 + i * 2,
                height: 6 + i * 2,
                opacity: gridSize === step ? 1 : 0.6,
              }}
            />
          </button>
        ))}
      </div>
      <span className="w-14 text-[11px] tabular-nums text-neutral-500">
        {t(LABEL_KEYS[STEPS[index]])}
      </span>
    </div>
  );
}
