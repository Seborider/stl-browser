import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { bootstrapI18n } from "./i18n";
import { getPreferences } from "./ipc/commands";
import { useAppStore } from "./state/store";

// Block React mount on the prefs round-trip so the first paint already
// matches the persisted theme + language. SQLite is the source of truth;
// i18next's resources are imported synchronously, so the only async work
// here is the IPC and the resulting `changeLanguage`.
async function bootstrap() {
  try {
    const prefs = await getPreferences();
    const store = useAppStore.getState();
    store.setThemeMode(prefs.theme);
    store.setModelColor(prefs.modelColor);
    store.setLights(prefs.lights);
    store.setBackgroundColor(prefs.backgroundColor);
    await bootstrapI18n(prefs.language);
  } catch (err) {
    // Falling back to defaults still mounts a working UI; the setup hook
    // persists language on first launch, so a failure here is unusual.
    console.error("preferences bootstrap failed", err);
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
