import { useEffect } from "react";
import { getThemeMode } from "../ipc/commands";
import { onThemeChanged } from "../ipc/events";
import { useAppStore } from "../state/store";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function applyResolved(dark: boolean) {
  const root = document.documentElement;
  if (dark) root.classList.add("dark");
  else root.classList.remove("dark");
}

// Toggles the `.dark` class on <html>. The inline bootstrap in index.html
// has already done a best-effort pre-paint apply from localStorage; this hook
// reconciles against SQLite (source of truth) and reacts to menu choices.
export function useTheme(): void {
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);

  useEffect(() => {
    let cancelled = false;
    getThemeMode()
      .then((mode) => {
        if (!cancelled) setThemeMode(mode);
      })
      .catch((err) => console.error("get_theme_mode failed", err));
    return () => {
      cancelled = true;
    };
  }, [setThemeMode]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onThemeChanged((e) => setThemeMode(e.mode)).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [setThemeMode]);

  // Single owner of the DOM apply. Re-runs when themeMode changes; also tracks
  // prefers-color-scheme when in System mode.
  useEffect(() => {
    if (themeMode !== "system") {
      applyResolved(themeMode === "dark");
      return;
    }
    const mql = window.matchMedia(DARK_QUERY);
    const apply = () => applyResolved(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, [themeMode]);
}
