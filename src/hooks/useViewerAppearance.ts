import { useCallback, useEffect, useRef } from "react";
import {
  setBackgroundColor as ipcSetBackgroundColor,
  setLights as ipcSetLights,
  setModelColor as ipcSetModelColor,
} from "../ipc/commands";
import { useAppStore } from "../state/store";
import type { LightConfig } from "../generated";

const DEBOUNCE_MS = 250;

// Live setters that update the Zustand store synchronously and persist to
// SQLite on a 250ms trailing-edge debounce per field. Drag interactions stay
// at 60fps; the DB sees one write after the user stops moving the control.
export function useViewerAppearance() {
  const modelColor = useAppStore((s) => s.modelColor);
  const lights = useAppStore((s) => s.lights);
  const backgroundColor = useAppStore((s) => s.backgroundColor);

  const storeSetModelColor = useAppStore((s) => s.setModelColor);
  const storeSetLights = useAppStore((s) => s.setLights);
  const storeSetBackgroundColor = useAppStore((s) => s.setBackgroundColor);

  const setModelColor = useDebouncedPersister<string>(
    storeSetModelColor,
    ipcSetModelColor,
    "set_model_color",
  );
  const setLights = useDebouncedPersister<LightConfig[]>(
    storeSetLights,
    ipcSetLights,
    "set_lights",
  );
  const setBackgroundColor = useDebouncedPersister<string>(
    storeSetBackgroundColor,
    ipcSetBackgroundColor,
    "set_background_color",
  );

  return {
    modelColor,
    lights,
    backgroundColor,
    setModelColor,
    setLights,
    setBackgroundColor,
  };
}

function useDebouncedPersister<T>(
  storeSet: (value: T) => void,
  ipcSet: (value: T) => Promise<void>,
  errLabel: string,
): (value: T) => void {
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return useCallback(
    (value: T) => {
      storeSet(value);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void ipcSet(value).catch((err) => console.error(`${errLabel} failed`, err));
      }, DEBOUNCE_MS);
    },
    [storeSet, ipcSet, errLabel],
  );
}
