import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useTranslation } from "react-i18next";
import { deriveGroundHex } from "../../lib/color";
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_LIGHTS,
  DEFAULT_MODEL_COLOR,
  MAX_LIGHTS,
  type LightConfig,
} from "../../state/store";
import { useViewerAppearance } from "../../hooks/useViewerAppearance";
import { AzimuthDial } from "./AzimuthDial";

type PresetId = "dawn" | "noon" | "goldenHour" | "night";

interface Preset {
  id: PresetId;
  color: string;
  intensityNorm: number;
}

const PRESETS: Preset[] = [
  { id: "dawn", color: "#ffb07a", intensityNorm: 0.65 },
  { id: "noon", color: "#fffaf0", intensityNorm: 1.0 },
  { id: "goldenHour", color: "#ffa361", intensityNorm: 0.8 },
  { id: "night", color: "#3b5078", intensityNorm: 0.45 },
];

export function AppearanceControls() {
  const { t } = useTranslation();
  const {
    modelColor,
    lights,
    backgroundColor,
    setModelColor,
    setLights,
    setBackgroundColor,
  } = useViewerAppearance();

  return (
    <>
      <ColorControl
        value={modelColor}
        onChange={setModelColor}
        defaultValue={DEFAULT_MODEL_COLOR}
        label={t("viewer.modelColor")}
        resetLabel={t("viewer.reset")}
      />
      <LightsControl lights={lights} setLights={setLights} />
      <BackgroundControl
        value={backgroundColor}
        onChange={setBackgroundColor}
        defaultValue={DEFAULT_BACKGROUND_COLOR}
      />
    </>
  );
}

const POPOVER_CLASS =
  "z-[60] rounded-md border border-neutral-200 bg-white px-4 py-3 shadow-lg outline-none dark:border-neutral-800 dark:bg-neutral-900";

function ColorControl({
  value,
  onChange,
  defaultValue,
  label,
  resetLabel,
}: {
  value: string;
  onChange: (hex: string) => void;
  defaultValue: string;
  label: string;
  resetLabel: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="size-6 rounded border border-neutral-300 dark:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ backgroundColor: value }}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={`${POPOVER_CLASS} w-56`} sideOffset={6} align="end">
          <div className="text-xs font-medium text-neutral-700 dark:text-neutral-200">
            {label}
          </div>
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="mt-2 h-9 w-full cursor-pointer rounded border border-neutral-200 dark:border-neutral-700"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
            <span className="font-mono">{value.toLowerCase()}</span>
            <button
              type="button"
              onClick={() => onChange(defaultValue)}
              className="rounded px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {resetLabel}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function LightsControl({
  lights,
  setLights,
}: {
  lights: LightConfig[];
  setLights: (next: LightConfig[]) => void;
}) {
  const { t } = useTranslation();
  const [linkColors, setLinkColors] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<PresetId | null>(null);

  const onPickPreset = (preset: Preset) => {
    setSelectedPreset(preset.id);
    setLights(
      lights.map((l) =>
        l.enabled
          ? { ...l, color: preset.color, intensityNorm: preset.intensityNorm }
          : l,
      ),
    );
  };

  const onEditLight = (index: number, patch: Partial<LightConfig>) => {
    setSelectedPreset(null);
    setLights(
      lights.map((l, i) => {
        if (i !== index) {
          // Link-colors fan-out only applies to color edits, only to enabled lights.
          if (linkColors && patch.color !== undefined && l.enabled) {
            return { ...l, color: patch.color };
          }
          return l;
        }
        return { ...l, ...patch };
      }),
    );
  };

  const onAddLight = () => {
    if (lights.length >= MAX_LIGHTS) return;
    setSelectedPreset(null);
    const seed = lights[0] ?? DEFAULT_LIGHTS[0];
    setLights([
      ...lights,
      {
        color: seed.color,
        intensityNorm: seed.intensityNorm,
        azimuthDeg: nextAzimuth(lights),
        enabled: true,
      },
    ]);
  };

  const onRemoveLight = (index: number) => {
    if (lights.length <= 1) return;
    setSelectedPreset(null);
    setLights(lights.filter((_, i) => i !== index));
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t("viewer.lights")}
          title={t("viewer.lights")}
          className="flex size-6 items-center justify-center rounded text-neutral-700 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <SunIcon />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={`${POPOVER_CLASS} w-96`} sideOffset={6} align="end">
          <div className="text-xs font-medium text-neutral-700 dark:text-neutral-200">
            {t("viewer.presets")}
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPickPreset(p)}
                aria-pressed={selectedPreset === p.id}
                className={
                  "rounded px-1 py-1 text-[10px] transition-colors " +
                  (selectedPreset === p.id
                    ? "bg-indigo-500/30 text-indigo-900 dark:text-indigo-100"
                    : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800")
                }
              >
                <span
                  className="mb-1 block h-3 w-full rounded border border-neutral-200 dark:border-neutral-700"
                  style={{ backgroundColor: p.color }}
                />
                {t(`viewer.preset_${p.id}`)}
              </button>
            ))}
          </div>
          {selectedPreset === null && (
            <div className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
              {t("viewer.preset_custom")}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-700 dark:text-neutral-200">
              {t("viewer.lights")}
            </span>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={linkColors}
                onChange={(e) => setLinkColors(e.target.checked)}
                className="size-3 cursor-pointer"
              />
              {t("viewer.linkColors")}
            </label>
          </div>

          <ul className="mt-2 space-y-2">
            {lights.map((l, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded border border-neutral-200 p-1.5 dark:border-neutral-800"
              >
                <input
                  type="checkbox"
                  checked={l.enabled}
                  onChange={(e) => onEditLight(i, { enabled: e.target.checked })}
                  aria-label={t("viewer.enabled")}
                  title={t("viewer.enabled")}
                  className="size-3 cursor-pointer"
                />
                <input
                  type="color"
                  value={l.color}
                  onChange={(e) => onEditLight(i, { color: e.target.value })}
                  aria-label={t("viewer.lightColor")}
                  title={t("viewer.lightColor")}
                  className="h-6 w-7 cursor-pointer rounded border border-neutral-200 dark:border-neutral-700"
                />
                <div className="flex flex-1 flex-col">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={l.intensityNorm}
                    onChange={(e) =>
                      onEditLight(i, { intensityNorm: parseFloat(e.target.value) })
                    }
                    aria-label={t("viewer.intensity")}
                    title={`${t("viewer.intensity")}: ${l.intensityNorm.toFixed(2)}`}
                    className="w-full cursor-pointer"
                  />
                  <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
                    {t("viewer.intensity")}: {l.intensityNorm.toFixed(2)} ·{" "}
                    {t("viewer.azimuth")}: {Math.round(l.azimuthDeg)}°
                  </span>
                </div>
                <AzimuthDial
                  azimuthDeg={l.azimuthDeg}
                  onChange={(deg) => onEditLight(i, { azimuthDeg: deg })}
                  size={56}
                />
                <button
                  type="button"
                  onClick={() => onRemoveLight(i)}
                  disabled={lights.length <= 1}
                  aria-label={t("viewer.removeLight")}
                  title={t("viewer.removeLight")}
                  className="flex size-5 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={onAddLight}
            disabled={lights.length >= MAX_LIGHTS}
            className="mt-2 w-full rounded border border-dashed border-neutral-300 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            + {t("viewer.addLight")}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function BackgroundControl({
  value,
  onChange,
  defaultValue,
}: {
  value: string;
  onChange: (hex: string) => void;
  defaultValue: string;
}) {
  const { t } = useTranslation();
  const groundHex = useMemo(() => deriveGroundHex(value), [value]);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t("viewer.background")}
          title={t("viewer.background")}
          className="flex size-6 items-center justify-center rounded border border-neutral-300 dark:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ backgroundColor: value }}
        >
          <span
            className="size-3 rounded-sm border border-white/40 dark:border-black/40"
            style={{ backgroundColor: groundHex }}
            aria-hidden
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={`${POPOVER_CLASS} w-56`} sideOffset={6} align="end">
          <div className="text-xs font-medium text-neutral-700 dark:text-neutral-200">
            {t("viewer.background")}
          </div>
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="mt-2 h-9 w-full cursor-pointer rounded border border-neutral-200 dark:border-neutral-700"
          />
          <div className="mt-2 flex items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            <span
              className="size-4 rounded border border-neutral-200 dark:border-neutral-700"
              style={{ backgroundColor: groundHex }}
              aria-hidden
            />
            <span>{t("viewer.groundDerived")}</span>
            <span className="ml-auto font-mono">{groundHex}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
            <span className="font-mono">{value.toLowerCase()}</span>
            <button
              type="button"
              onClick={() => onChange(defaultValue)}
              className="rounded px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {t("viewer.reset")}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Picks the azimuth furthest from existing lights — the midpoint of the
// largest empty arc on the unit circle.
function nextAzimuth(lights: LightConfig[]): number {
  if (lights.length === 0) return 45;
  const sorted = lights
    .map((l) => ((l.azimuthDeg % 360) + 360) % 360)
    .sort((a, b) => a - b);
  let bestSpan = -1;
  let bestMid = (sorted[0] + 180) % 360;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[(i + 1) % sorted.length];
    const raw = i < sorted.length - 1 ? b - a : 360 - a + b;
    const span = raw === 0 ? 360 : raw;
    if (span > bestSpan) {
      bestSpan = span;
      bestMid = (a + span / 2) % 360;
    }
  }
  return bestMid;
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}
