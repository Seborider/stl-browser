import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import de from "./locales/de.json";
import type { Language } from "../generated";

// Same primary-tag classification as the Rust side (`src-tauri/src/i18n.rs`).
// Used when the persisted preference is `system` so the renderer follows the
// OS locale instead of falling back to English.
function classifyLocale(): "en" | "de" {
  const navAny = navigator as Navigator & { languages?: readonly string[] };
  const tag = navAny.languages?.[0] ?? navigator.language ?? "en";
  const primary = tag.split(/[-_]/)[0]?.toLowerCase();
  return primary === "de" ? "de" : "en";
}

export function resolveLanguage(stored: Language): "en" | "de" {
  if (stored === "de" || stored === "en") return stored;
  return classifyLocale();
}

// Initialize once. The actual `lng` is set by `bootstrapI18n` before React
// mounts, so the first paint renders in the correct language and we avoid
// the t('foo') → 'foo' flash. `react-i18next` reads the same instance.
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export async function bootstrapI18n(stored: Language): Promise<void> {
  const resolved = resolveLanguage(stored);
  if (i18n.language !== resolved) {
    await i18n.changeLanguage(resolved);
  }
}

export default i18n;
