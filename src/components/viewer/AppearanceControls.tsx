import * as Popover from "@radix-ui/react-popover";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_LIGHT_AZIMUTH_DEG,
  DEFAULT_LIGHT_COLOR,
  DEFAULT_MODEL_COLOR,
} from "../../state/store";
import { useViewerAppearance } from "../../hooks/useViewerAppearance";
import { AzimuthDial } from "./AzimuthDial";

export function AppearanceControls() {
  const { t } = useTranslation();
  const {
    modelColor,
    lightColor,
    lightAzimuthDeg,
    setModelColor,
    setLightColor,
    setLightAzimuthDeg,
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
      <ColorControl
        value={lightColor}
        onChange={setLightColor}
        defaultValue={DEFAULT_LIGHT_COLOR}
        label={t("viewer.lightColor")}
        resetLabel={t("viewer.reset")}
      />
      <DirectionControl
        value={lightAzimuthDeg}
        onChange={setLightAzimuthDeg}
        defaultValue={DEFAULT_LIGHT_AZIMUTH_DEG}
        label={t("viewer.lightDirection")}
        azimuthLabel={t("viewer.azimuth")}
        resetLabel={t("viewer.reset")}
      />
    </>
  );
}

const POPOVER_CLASS =
  "z-[60] w-56 rounded-md border border-neutral-200 bg-white p-3 shadow-lg outline-none dark:border-neutral-800 dark:bg-neutral-900";

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
        <Popover.Content className={POPOVER_CLASS} sideOffset={6} align="end">
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

function DirectionControl({
  value,
  onChange,
  defaultValue,
  label,
  azimuthLabel,
  resetLabel,
}: {
  value: number;
  onChange: (deg: number) => void;
  defaultValue: number;
  label: string;
  azimuthLabel: string;
  resetLabel: string;
}) {
  const display = Math.round(value);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="flex size-6 items-center justify-center rounded text-neutral-700 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <SunIcon />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={POPOVER_CLASS} sideOffset={6} align="end">
          <div className="text-xs font-medium text-neutral-700 dark:text-neutral-200">
            {label}
          </div>
          <div className="mt-2 flex items-center justify-center">
            <AzimuthDial azimuthDeg={value} onChange={onChange} size={140} />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
            <span>
              {azimuthLabel}: <span className="font-mono">{display}°</span>
            </span>
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

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}
