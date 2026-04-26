import { useEffect } from "react";
import i18n, { resolveLanguage } from "../i18n";
import { onLanguageChanged } from "../ipc/events";

// Listens for `language:changed` (emitted on every menu pick) and routes the
// new value into i18next. SQLite is the source of truth; `bootstrapI18n`
// already ran in `main.tsx` before React mounted, so the first paint is in
// the correct language and this hook only handles runtime changes.
export function useLanguage(): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onLanguageChanged((e) => {
      const resolved = resolveLanguage(e.language);
      if (i18n.language !== resolved) void i18n.changeLanguage(resolved);
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
