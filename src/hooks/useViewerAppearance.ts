import { useCallback, useEffect, useRef } from "react";
import {
  setLightAzimuth as ipcSetLightAzimuth,
  setLightColor as ipcSetLightColor,
  setModelColor as ipcSetModelColor,
} from "../ipc/commands";
import { useAppStore } from "../state/store";

const DEBOUNCE_MS = 250;

// Live setters that update the Zustand store synchronously and persist to
// SQLite on a 250ms trailing-edge debounce per field. Drag interactions stay
// at 60fps; the DB sees one write after the user stops moving the control.
export function useViewerAppearance() {
  const modelColor = useAppStore((s) => s.modelColor);
  const lightColor = useAppStore((s) => s.lightColor);
  const lightAzimuthDeg = useAppStore((s) => s.lightAzimuthDeg);

  const storeSetModelColor = useAppStore((s) => s.setModelColor);
  const storeSetLightColor = useAppStore((s) => s.setLightColor);
  const storeSetLightAzimuthDeg = useAppStore((s) => s.setLightAzimuthDeg);

  const setModelColor = useDebouncedPersister(
    storeSetModelColor,
    ipcSetModelColor,
    "set_model_color",
  );
  const setLightColor = useDebouncedPersister(
    storeSetLightColor,
    ipcSetLightColor,
    "set_light_color",
  );
  const setLightAzimuthDeg = useDebouncedPersister(
    storeSetLightAzimuthDeg,
    ipcSetLightAzimuth,
    "set_light_azimuth",
  );

  return {
    modelColor,
    lightColor,
    lightAzimuthDeg,
    setModelColor,
    setLightColor,
    setLightAzimuthDeg,
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
