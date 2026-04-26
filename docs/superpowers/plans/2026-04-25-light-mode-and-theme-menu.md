# Light-Mode Fix + macOS Theme Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the light-mode regression in the search input and sort controls, and add a native macOS menu-bar "Theme" submenu (System / Light / Dark) whose choice persists across restarts and applies before first paint.

**Architecture:**
- **Bug fix:** add light-mode Tailwind classes to `SearchBox` and `SortDropdown` matching the toolbar pattern (`bg-neutral-50 ... dark:bg-neutral-900/40` etc.).
- **Theme menu:** Build a `Theme` submenu in Rust via `tauri::menu::{SubmenuBuilder, CheckMenuItemBuilder}`, append it to `Menu::default(app)`, and wire `on_menu_event` to (a) persist the choice in a new SQLite `settings` table (migration v4) and (b) emit a `theme:changed` event. Frontend listens, stores the override in Zustand, and toggles `<html class="dark">`. Tailwind v4 dark variant is switched from media-query default to a class strategy via `@custom-variant dark (&:where(.dark, .dark *))`. An inline bootstrap script in `index.html` mirrors the persisted choice in `localStorage` and sets the class before React mounts to avoid a flash. Window native background color is set programmatically from Rust during setup based on the resolved theme.

**Tech Stack:** Rust + Tauri 2 (`tauri::menu`), rusqlite (bundled), ts-rs, React 19 + TypeScript, Tailwind v4 (via `@tailwindcss/vite`), Zustand 5.

---

## File Structure

### Rust (`src-tauri/src/`)
- **Modify** `db/migrations.rs` — append migration v4 creating the `settings` table.
- **Modify** `db/mod.rs` — register new `settings` submodule.
- **Create** `db/settings.rs` — `get_theme_mode(&Connection) -> ThemeMode` and `set_theme_mode(&Connection, ThemeMode) -> Result<(), IpcError>` plus `#[cfg(test)] mod tests`.
- **Modify** `types.rs` — add `ThemeMode` enum (`#[ts(export)]`) + `ThemeChangedEvent { mode: ThemeMode }`.
- **Modify** `events.rs` — add `THEME_CHANGED` const + `theme_changed(app, mode)` emitter helper.
- **Modify** `state.rs` — add `theme_menu: Mutex<Option<ThemeMenuHandles>>` field; define `ThemeMenuHandles { system, light, dark }` holding `tauri::menu::CheckMenuItem`.
- **Modify** `ipc/system.rs` — add `#[tauri::command] get_theme_mode` that reads from settings.
- **Modify** `lib.rs` — read persisted theme during `setup`, build `Theme` submenu with three `CheckMenuItem`s, append to `Menu::default(app)`, set on the app, store the handles in `AppState`, wire `.on_menu_event(...)` on the builder, and call `window.set_background_color(...)` based on the resolved theme. Register `get_theme_mode` in `invoke_handler`.
- **Modify** `tauri.conf.json` — remove the static `backgroundColor: "#0a0a0a"` so the programmatic setter is authoritative.

### Frontend (`src/`)
- **Modify** `components/SearchBox.tsx` — replace dark-only classes with `bg-white border-neutral-200 ... text-neutral-800 placeholder:text-neutral-400 dark:bg-neutral-900 dark:border-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500` (and matching hover/focus pairs).
- **Modify** `components/SortDropdown.tsx` — same pattern for the `<label>`, `<select>`, and `<button>`.
- **Modify** `App.css` — add `@custom-variant dark (&:where(.dark, .dark *));` directly after `@import "tailwindcss";` and switch the scrollbar dark rule from `@media (prefers-color-scheme: dark)` to `:where(html.dark)`.
- **Modify** `index.html` — replace the body-bg `<style>` with class-based selectors, and add an inline bootstrap `<script>` in `<head>` that reads `localStorage['stl-browser:theme']` (default `"system"`), resolves via `matchMedia('(prefers-color-scheme: dark)')` if `system`, and sets `document.documentElement.classList.add('dark')` accordingly. Inline so it runs synchronously before React mounts.
- **Modify** `state/store.ts` — add `themeMode: ThemeMode` (default `"system"`) and `setThemeMode(mode)` to the store; the setter writes the value to `localStorage['stl-browser:theme']` (matching the bootstrap script) AND updates state. Do NOT add `themeMode` to the existing `partialize` — it's persisted separately under its own key for the early-bootstrap script to read.
- **Create** `hooks/useTheme.ts` — single hook called once in `App.tsx`. On mount: `getThemeMode()` IPC call to load persisted value, apply it, subscribe to `theme:changed`, and (when mode is `system`) subscribe to `prefers-color-scheme` `change` events. Toggles `<html class="dark">` and updates the Zustand store.
- **Modify** `ipc/commands.ts` — add `getThemeMode(): Promise<ThemeMode>`.
- **Modify** `ipc/events.ts` — export `THEME_CHANGED = "theme:changed"` and `onThemeChanged(cb)`.
- **Modify** `App.tsx` — call `useTheme()` at the top of the component (alongside `useLiveEvents()`).
- **Auto-regenerate** `generated/ThemeMode.ts`, `generated/ThemeChangedEvent.ts`, `generated/index.ts` via `pnpm bindings`.

### Documentation
- **Modify** `PLAN.md` — update Phase 7 status note to mention the new theme override + class-based dark variant; bump §12 question 3 (settings storage) from "deferred" to "shipped (settings table, migration v4)".

---

## Constraints from Spec (re-stated for the implementer)

- Apple Silicon macOS only — no cross-platform fallbacks.
- Do NOT add new Cargo or pnpm dependencies. Tauri 2's menu API is in-tree; rusqlite is already used; no `tauri-plugin-store`.
- All IPC commands return `Result<T, IpcError>`; events are colon-namespaced.
- Do NOT introduce a settings panel or any UI beyond the menu.
- Do NOT do a global find/replace on color classes — only the two affected components.
- Regenerate ts-rs bindings via `pnpm bindings` whenever Rust types change.
- "System" mode = no `.dark` class override; `prefers-color-scheme` drives via the `:where(.dark, .dark *)` selector being absent. (Detail below in Task 9.)

---

## Task 1: Fix light-mode regression in SearchBox

**Files:**
- Modify: `src/components/SearchBox.tsx`

- [ ] **Step 1: Update the input className**

In `src/components/SearchBox.tsx`, replace the `<input>` `className` (line 30) with:

```tsx
className="h-7 w-64 rounded-md border border-neutral-200 bg-white pl-7 pr-2 text-xs text-neutral-800 outline-none placeholder:text-neutral-400 transition-colors hover:border-neutral-300 focus:border-indigo-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:hover:border-neutral-700 dark:focus:border-indigo-500"
```

- [ ] **Step 2: Update the search-icon span color to follow theme**

Replace line 34's `className` for the `<span>`:

```tsx
className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-neutral-400 dark:text-neutral-500"
```

- [ ] **Step 3: Verify build compiles**

Run: `pnpm tsc --noEmit`
Expected: exit code 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/SearchBox.tsx
git commit -m "fix: add light-mode classes to SearchBox so it follows toolbar theme"
```

---

## Task 2: Fix light-mode regression in SortDropdown

**Files:**
- Modify: `src/components/SortDropdown.tsx`

- [ ] **Step 1: Update the label className**

Replace line 18's `<label>` `className` with:

```tsx
className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-neutral-500"
```

(Same value in both modes — `text-neutral-500` already reads acceptably on both backgrounds. Including the explicit `dark:` variant keeps the pattern consistent for future tweaks.)

- [ ] **Step 2: Update the `<select>` className**

Replace line 24's `<select>` `className` with:

```tsx
className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-800 outline-none transition-colors hover:border-neutral-300 focus:border-indigo-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-700"
```

- [ ] **Step 3: Update the toggle `<button>` className**

Replace line 39's `<button>` `className` with:

```tsx
className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 transition-colors hover:border-neutral-300 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:text-white"
```

- [ ] **Step 4: Verify build compiles**

Run: `pnpm tsc --noEmit`
Expected: exit code 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/SortDropdown.tsx
git commit -m "fix: add light-mode classes to SortDropdown so it follows toolbar theme"
```

> **Note:** Tasks 1 and 2 are sufficient on their own to fix the visual bug while the OS still drives `prefers-color-scheme`. The remaining tasks switch to a class-based dark variant so an explicit override becomes possible — Tasks 1 and 2 will continue to work because Tailwind v4 supports both strategies and we'll be redirecting the `dark:` prefix to the `.dark` class.

---

## Task 3: Add settings table migration (v4)

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`

- [ ] **Step 1: Append the v4 migration**

In `src-tauri/src/db/migrations.rs`, add this entry at the end of the `MIGRATIONS` array (after the existing v3 thumbnails migration):

```rust
    // v4 — key/value settings table per PLAN.md §4. Stores theme override
    // (System | Light | Dark) and any future user preferences that need to
    // survive restarts on the Rust side. JSON value column for forward
    // compatibility.
    r#"
    CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    "#,
```

- [ ] **Step 2: Update the existing `fresh_db_ends_at_latest_version` test**

In the `#[cfg(test)] mod tests` block, change:

```rust
        assert_eq!(versions, vec![1, 2, 3]);
```

to:

```rust
        assert_eq!(versions, vec![1, 2, 3, 4]);
```

And add this assertion just below the existing `assert!(has("thumbnails"));`:

```rust
        assert!(has("settings"));
```

- [ ] **Step 3: Update the `upgrade_from_v1_only_db` test**

Change the final assertion in that test from:

```rust
        assert_eq!(max, 3);
```

to:

```rust
        assert_eq!(max, 4);
```

- [ ] **Step 4: Run the migration tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --quiet --lib db::migrations`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/migrations.rs
git commit -m "feat(db): add v4 settings table migration"
```

---

## Task 4: Add ThemeMode type + ThemeChangedEvent

**Files:**
- Modify: `src-tauri/src/types.rs`

- [ ] **Step 1: Add the ThemeMode enum**

Append to `src-tauri/src/types.rs`:

```rust
// ---- theme override ----

// Lowercase serde rename so JSON values match the strings the renderer stores
// in localStorage and reads from the bootstrap inline script in index.html.
// Don't change the wire format without updating index.html and state/store.ts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct ThemeChangedEvent {
    pub mode: ThemeMode,
}
```

- [ ] **Step 2: Regenerate ts-rs bindings**

Run: `pnpm bindings`
Expected: exit code 0; `src/generated/ThemeMode.ts` and `src/generated/ThemeChangedEvent.ts` appear and `src/generated/index.ts` re-exports them.

- [ ] **Step 3: Verify generated files exist**

Run: `ls src/generated/ThemeMode.ts src/generated/ThemeChangedEvent.ts`
Expected: both paths print without error.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/types.rs src/generated/
git commit -m "feat(ipc): add ThemeMode + ThemeChangedEvent ts-rs bindings"
```

---

## Task 5: Implement settings get/set in Rust

**Files:**
- Create: `src-tauri/src/db/settings.rs`
- Modify: `src-tauri/src/db/mod.rs`

- [ ] **Step 1: Create `src-tauri/src/db/settings.rs`**

```rust
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::IpcError;
use crate::types::ThemeMode;

const KEY_THEME_MODE: &str = "theme_mode";

// Returns the persisted theme override, defaulting to System when no row
// exists (fresh install) or the value can't be parsed (forward-compat or
// hand-edited DB).
pub fn get_theme_mode(conn: &Connection) -> Result<ThemeMode, IpcError> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![KEY_THEME_MODE],
            |row| row.get(0),
        )
        .optional()?;
    Ok(parse_theme(raw.as_deref()).unwrap_or(ThemeMode::System))
}

pub fn set_theme_mode(conn: &Connection, mode: ThemeMode) -> Result<(), IpcError> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)\n\
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![KEY_THEME_MODE, theme_to_str(mode)],
    )?;
    Ok(())
}

fn theme_to_str(mode: ThemeMode) -> &'static str {
    match mode {
        ThemeMode::System => "system",
        ThemeMode::Light => "light",
        ThemeMode::Dark => "dark",
    }
}

fn parse_theme(s: Option<&str>) -> Option<ThemeMode> {
    match s? {
        "system" => Some(ThemeMode::System),
        "light" => Some(ThemeMode::Light),
        "dark" => Some(ThemeMode::Dark),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn open_memory() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA journal_mode = MEMORY; PRAGMA foreign_keys = ON;")
            .unwrap();
        migrations::run(&mut conn).unwrap();
        conn
    }

    #[test]
    fn fresh_db_returns_system() {
        let conn = open_memory();
        assert_eq!(get_theme_mode(&conn).unwrap(), ThemeMode::System);
    }

    #[test]
    fn round_trip_light_and_dark() {
        let conn = open_memory();
        set_theme_mode(&conn, ThemeMode::Light).unwrap();
        assert_eq!(get_theme_mode(&conn).unwrap(), ThemeMode::Light);
        set_theme_mode(&conn, ThemeMode::Dark).unwrap();
        assert_eq!(get_theme_mode(&conn).unwrap(), ThemeMode::Dark);
        set_theme_mode(&conn, ThemeMode::System).unwrap();
        assert_eq!(get_theme_mode(&conn).unwrap(), ThemeMode::System);
    }

    #[test]
    fn unknown_value_falls_back_to_system() {
        let conn = open_memory();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('theme_mode', 'mauve')",
            [],
        )
        .unwrap();
        assert_eq!(get_theme_mode(&conn).unwrap(), ThemeMode::System);
    }
}
```

- [ ] **Step 2: Register the new module**

In `src-tauri/src/db/mod.rs`, add `pub mod settings;` to the existing `pub mod` list. The block should now read:

```rust
pub mod files;
pub mod libraries;
pub mod mesh;
pub mod migrations;
pub mod settings;
pub mod thumbnails;
```

- [ ] **Step 3: Run the new tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --quiet --lib db::settings`
Expected: all 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/settings.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): get/set theme_mode in settings table"
```

---

## Task 6: Add theme_changed event helper

**Files:**
- Modify: `src-tauri/src/events.rs`

- [ ] **Step 1: Add the constant**

After the existing `pub const THUMBNAILS_READY: &str = "thumbnails:ready";` line, add:

```rust
pub const THEME_CHANGED: &str = "theme:changed";
```

- [ ] **Step 2: Add the emit helper**

At the bottom of `events.rs`, append:

```rust
pub fn theme_changed(app: &AppHandle, mode: crate::types::ThemeMode) {
    let _ = app.emit(THEME_CHANGED, crate::types::ThemeChangedEvent { mode });
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml --quiet`
Expected: exit code 0, no warnings about unused functions yet (it's wired in Task 8).

> If `cargo check` complains the function is unused, ignore — it'll be called in Task 8. Don't add `#[allow(dead_code)]`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/events.rs
git commit -m "feat(events): add theme:changed emit helper"
```

---

## Task 7: Extend AppState with theme menu handles

**Files:**
- Modify: `src-tauri/src/state.rs`

- [ ] **Step 1: Add the handles struct + field**

Replace the contents of `src-tauri/src/state.rs` with:

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tauri::menu::CheckMenuItem;
use tauri::Wry;

use crate::scan::watcher::WatcherHandle;

// `Arc<Mutex<_>>` is the standard "shared mutable state" pattern:
//   - `Arc` ("atomic reference count") lets multiple owners hold the same value;
//     Tauri hands copies of `State<'_, Arc<AppState>>` to command handlers, and
//     scanner tasks clone the Arc to keep their own reference.
//   - `Mutex` serializes access — `rusqlite::Connection` isn't thread-safe on
//     its own so this is the cheapest correct choice until contention shows up.
pub struct AppState {
    pub db: Mutex<Connection>,
    // Per-library watcher handles. Dropping a handle (via `remove`) stops the
    // underlying notify watch; we keep them alive here for the app's lifetime.
    pub watchers: Mutex<HashMap<i64, WatcherHandle>>,
    // Handles to the three CheckMenuItems in the Theme submenu, set during
    // setup. Stored so on_menu_event can flip the checkmarks atomically when
    // the user picks an option. `Wry` is Tauri's default webview runtime.
    pub theme_menu: Mutex<Option<ThemeMenuHandles>>,
}

pub struct ThemeMenuHandles {
    pub system: CheckMenuItem<Wry>,
    pub light: CheckMenuItem<Wry>,
    pub dark: CheckMenuItem<Wry>,
}

impl AppState {
    pub fn new(conn: Connection) -> Arc<Self> {
        Arc::new(Self {
            db: Mutex::new(conn),
            watchers: Mutex::new(HashMap::new()),
            theme_menu: Mutex::new(None),
        })
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml --quiet`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat(state): hold Theme submenu CheckMenuItem handles"
```

---

## Task 8: Build the menu, wire on_menu_event, register get_theme_mode command

**Files:**
- Modify: `src-tauri/src/ipc/system.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the `get_theme_mode` command**

Append to `src-tauri/src/ipc/system.rs`:

```rust
use crate::db;
use crate::state::AppState;
use crate::types::ThemeMode;

#[tauri::command]
pub async fn get_theme_mode(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
) -> Result<ThemeMode, IpcError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| IpcError::Database(format!("db mutex poisoned: {e}")))?;
    db::settings::get_theme_mode(&conn)
}
```

> Note: this re-uses the existing `IpcError` import at the top of the file.

- [ ] **Step 2: Build the menu in `lib.rs` setup**

In `src-tauri/src/lib.rs`, **inside the `setup` closure**, after the existing libraries-loading block (just before `Ok(())`), add:

```rust
            // ---- theme menu ----
            let initial_mode = {
                let conn = state
                    .db
                    .lock()
                    .map_err(|e| format!("db mutex poisoned: {e}"))?;
                crate::db::settings::get_theme_mode(&conn)
                    .map_err(|e| e.to_string())?
            };

            use tauri::menu::{CheckMenuItemBuilder, Menu, SubmenuBuilder};
            let item_system = CheckMenuItemBuilder::with_id("theme:system", "System")
                .checked(initial_mode == crate::types::ThemeMode::System)
                .build(app)?;
            let item_light = CheckMenuItemBuilder::with_id("theme:light", "Light")
                .checked(initial_mode == crate::types::ThemeMode::Light)
                .build(app)?;
            let item_dark = CheckMenuItemBuilder::with_id("theme:dark", "Dark")
                .checked(initial_mode == crate::types::ThemeMode::Dark)
                .build(app)?;

            let theme_submenu = SubmenuBuilder::new(app, "Theme")
                .item(&item_system)
                .item(&item_light)
                .item(&item_dark)
                .build()?;

            let menu = Menu::default(app.handle())?;
            menu.append(&theme_submenu)?;
            app.set_menu(menu)?;

            *state.theme_menu.lock().unwrap() =
                Some(crate::state::ThemeMenuHandles {
                    system: item_system,
                    light: item_light,
                    dark: item_dark,
                });

            // ---- apply theme to the native window background ----
            // Avoids the dark-flash when the user is in light mode and Tauri
            // would otherwise paint the WKWebView container dark before the
            // first frame.
            if let Some(window) = app.get_webview_window("main") {
                let resolved_dark = match initial_mode {
                    crate::types::ThemeMode::Dark => true,
                    crate::types::ThemeMode::Light => false,
                    // System: we can't read prefers-color-scheme from Rust;
                    // pick the OS theme via Tauri's Window API.
                    crate::types::ThemeMode::System => window
                        .theme()
                        .map(|t| t == tauri::Theme::Dark)
                        .unwrap_or(true),
                };
                let bg = if resolved_dark {
                    tauri::window::Color(10, 10, 10, 255)
                } else {
                    tauri::window::Color(255, 255, 255, 255)
                };
                let _ = window.set_background_color(Some(bg));
            }
```

- [ ] **Step 3: Wire the menu event handler on the Builder**

In `src-tauri/src/lib.rs`, on the `tauri::Builder::default()` chain, **before `.setup(...)`** add:

```rust
        .on_menu_event(|app, event| {
            use crate::types::ThemeMode;
            let mode = match event.id().0.as_str() {
                "theme:system" => ThemeMode::System,
                "theme:light" => ThemeMode::Light,
                "theme:dark" => ThemeMode::Dark,
                _ => return,
            };
            let state: tauri::State<std::sync::Arc<crate::state::AppState>> =
                app.state();
            // Persist
            if let Ok(conn) = state.db.lock() {
                let _ = crate::db::settings::set_theme_mode(&conn, mode);
            }
            // Update checkmarks
            if let Ok(handles) = state.theme_menu.lock() {
                if let Some(h) = handles.as_ref() {
                    let _ = h.system.set_checked(mode == ThemeMode::System);
                    let _ = h.light.set_checked(mode == ThemeMode::Light);
                    let _ = h.dark.set_checked(mode == ThemeMode::Dark);
                }
            }
            // Notify the renderer
            crate::events::theme_changed(app, mode);
        })
```

- [ ] **Step 4: Register the new IPC command**

In the `tauri::generate_handler![...]` block in `lib.rs`, append `, ipc::system::get_theme_mode` to the existing list (right after `ipc::system::reveal_in_finder`).

- [ ] **Step 5: Verify the Rust side compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml --quiet`
Expected: exit code 0, no warnings.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/ipc/system.rs
git commit -m "feat(menu): macOS Theme submenu with persistence + theme:changed event"
```

---

## Task 9: Switch Tailwind v4 dark variant to class-based + update scrollbar

**Files:**
- Modify: `src/App.css`

- [ ] **Step 1: Add the @custom-variant directive and switch the scrollbar rule**

Replace the entire contents of `src/App.css` with:

```css
@import "tailwindcss";

/* Override Tailwind v4's default `dark:` variant (which keys off
   prefers-color-scheme) so it instead matches when `.dark` is on the html
   element or any ancestor. This lets the user override the OS theme via the
   menu-bar Theme menu. When the override is "system" we add/remove the class
   to track prefers-color-scheme from the renderer. */
@custom-variant dark (&:where(.dark, .dark *));

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track,
::-webkit-scrollbar-corner {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.18);
  border: 2px solid transparent;
  border-radius: 8px;
  background-clip: padding-box;
}

::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.28);
}

:where(html.dark) ::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.12);
}

:where(html.dark) ::-webkit-scrollbar-thumb:hover {
  background-color: rgba(255, 255, 255, 0.22);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.css
git commit -m "feat(theme): switch Tailwind v4 dark variant to class-based"
```

---

## Task 10: Update index.html (bootstrap script + class-based body bg)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace the existing `<style>` block and add the bootstrap script**

Replace the entire `<head>` content of `index.html` (currently lines 3–20) with:

```html
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>STL Browser</title>
    <script>
      // Runs synchronously in <head> before React mounts to set the dark
      // class on <html> so the first paint matches the persisted override.
      // Mirrors what Rust will write on every theme change. localStorage is a
      // write-through cache; SQLite is the source of truth read once on
      // startup via get_theme_mode + reconciled by useTheme if it differs.
      (function () {
        var stored = null;
        try {
          stored = localStorage.getItem("stl-browser:theme");
        } catch (e) {}
        var mode =
          stored === "light" || stored === "dark" || stored === "system"
            ? stored
            : "system";
        var dark =
          mode === "dark" ||
          (mode === "system" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches);
        if (dark) document.documentElement.classList.add("dark");
      })();
    </script>
    <style>
      html,
      body {
        background-color: #ffffff;
      }
      html.dark,
      html.dark body {
        background-color: #0a0a0a;
      }
    </style>
  </head>
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat(theme): inline theme-bootstrap script + class-based body bg"
```

---

## Task 11: Remove static window backgroundColor from tauri.conf.json

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Remove the `backgroundColor` line**

In `src-tauri/tauri.conf.json`, remove the `"backgroundColor": "#0a0a0a"` line from the `windows[0]` object (and the trailing comma on the previous `theme` line). The window object should now read:

```json
      {
        "title": "STL Browser",
        "width": 1280,
        "height": 820,
        "theme": null
      }
```

> The runtime `window.set_background_color(...)` call we added in Task 8 is now authoritative.

- [ ] **Step 2: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "chore(tauri): drop static backgroundColor; set programmatically by theme"
```

---

## Task 12: Add themeMode to Zustand store

**Files:**
- Modify: `src/state/store.ts`

- [ ] **Step 1: Import ThemeMode**

In the existing import block at the top of `src/state/store.ts`, change:

```ts
import type { SortKey, SortDirection } from "../generated";
```

to:

```ts
import type { SortKey, SortDirection, ThemeMode } from "../generated";
```

And add `ThemeMode` to the re-export line:

```ts
export type { SortKey, SortDirection, ThemeMode };
```

- [ ] **Step 2: Add `themeMode` to the AppState interface**

Inside the `interface AppState { ... }` block, add:

```ts
  themeMode: ThemeMode;
```

(near the other view fields like `gridSize`)

and:

```ts
  setThemeMode: (mode: ThemeMode) => void;
```

(near `setGridSize`)

- [ ] **Step 3: Add the default and setter**

Inside the `create<AppState>()(persist((set) => ({ ... })))` body, add `themeMode: "system",` to the defaults block (next to `gridSize: "md",`).

Add the setter alongside the other setters:

```ts
      setThemeMode: (mode) => {
        try {
          // Mirror to localStorage so the inline bootstrap in index.html can
          // pick it up on the next launch before React mounts. Rust SQLite
          // is the durable source of truth — this is a render-timing cache.
          localStorage.setItem("stl-browser:theme", mode);
        } catch {}
        set({ themeMode: mode });
      },
```

- [ ] **Step 4: Confirm `themeMode` is NOT in `partialize`**

The existing `partialize` block intentionally writes only view state under `stl-browser:view:v2`. Do not add `themeMode` to it — the bootstrap script reads from a separate `stl-browser:theme` key.

- [ ] **Step 5: Verify TS compiles**

Run: `pnpm tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/state/store.ts
git commit -m "feat(state): add themeMode + setter mirrored to localStorage"
```

---

## Task 13: Add IPC wrappers for getThemeMode + onThemeChanged

**Files:**
- Modify: `src/ipc/commands.ts`
- Modify: `src/ipc/events.ts`

- [ ] **Step 1: Add `getThemeMode` to commands**

In `src/ipc/commands.ts`, extend the import:

```ts
import type {
  FileDetails,
  FileEntry,
  FileQuery,
  Library,
  ThemeMode,
} from "../generated";
```

And append at the end of the file:

```ts
export function getThemeMode(): Promise<ThemeMode> {
  return invoke<ThemeMode>("get_theme_mode");
}
```

- [ ] **Step 2: Add the event constant + listener**

In `src/ipc/events.ts`, extend the import:

```ts
import type {
  FilesAddedEvent,
  MetadataReadyEvent,
  ScanCompletedEvent,
  ScanErrorEvent,
  ScanProgressEvent,
  ScanStartedEvent,
  ThemeChangedEvent,
  ThumbnailsNeededEvent,
  ThumbnailsReadyEvent,
} from "../generated";
```

After the existing event constants, add:

```ts
export const THEME_CHANGED = "theme:changed";
```

And after the existing `onThumbnailsReady` definition, append:

```ts
export function onThemeChanged(cb: (e: ThemeChangedEvent) => void): Promise<UnlistenFn> {
  return listen<ThemeChangedEvent>(THEME_CHANGED, (ev) => cb(ev.payload));
}
```

- [ ] **Step 3: Verify TS compiles**

Run: `pnpm tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/ipc/commands.ts src/ipc/events.ts
git commit -m "feat(ipc): typed wrappers for get_theme_mode and theme:changed"
```

---

## Task 14: Create `useTheme` hook

**Files:**
- Create: `src/hooks/useTheme.ts`

- [ ] **Step 1: Create the hook**

```ts
import { useEffect } from "react";
import { getThemeMode } from "../ipc/commands";
import { onThemeChanged } from "../ipc/events";
import { useAppStore } from "../state/store";
import type { ThemeMode } from "../generated";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function applyResolved(dark: boolean) {
  const root = document.documentElement;
  if (dark) root.classList.add("dark");
  else root.classList.remove("dark");
}

function resolveAndApply(mode: ThemeMode) {
  if (mode === "system") {
    applyResolved(window.matchMedia(DARK_QUERY).matches);
  } else {
    applyResolved(mode === "dark");
  }
}

// Mount once at the top of the tree. Owns:
//   - the initial fetch of the persisted theme mode from Rust
//   - subscription to theme:changed (fired by the Rust menu handler)
//   - the prefers-color-scheme listener (only active in System mode)
// Toggles the `.dark` class on <html>; the inline bootstrap in index.html
// has already done a best-effort pre-paint apply from localStorage.
export function useTheme(): void {
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);

  // Bootstrap from Rust on mount. Reconciles localStorage (set by the inline
  // script) with SQLite (source of truth). Normally they match; if they
  // don't, SQLite wins and we re-apply.
  useEffect(() => {
    let cancelled = false;
    getThemeMode()
      .then((mode) => {
        if (cancelled) return;
        setThemeMode(mode);
        resolveAndApply(mode);
      })
      .catch((err) => console.error("get_theme_mode failed", err));
    return () => {
      cancelled = true;
    };
  }, [setThemeMode]);

  // React to menu choices.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onThemeChanged((e) => {
      setThemeMode(e.mode);
      resolveAndApply(e.mode);
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [setThemeMode]);

  // Track prefers-color-scheme only in System mode.
  useEffect(() => {
    if (themeMode !== "system") return;
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = (ev: MediaQueryListEvent) => applyResolved(ev.matches);
    mql.addEventListener("change", onChange);
    // Also re-apply now in case it changed between mount and entering System.
    applyResolved(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [themeMode]);
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `pnpm tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useTheme.ts
git commit -m "feat(theme): useTheme hook reconciles SQLite + menu + prefers-color-scheme"
```

---

## Task 15: Mount `useTheme` in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import the hook**

Add this import alongside the others at the top of `src/App.tsx`:

```ts
import { useTheme } from "./hooks/useTheme";
```

- [ ] **Step 2: Call it in the App body**

Inside the `App()` function body, on the line directly above `useLiveEvents();`, add:

```ts
  useTheme();
```

- [ ] **Step 3: Verify TS compiles**

Run: `pnpm tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(theme): mount useTheme at the app root"
```

---

## Task 16: Update PLAN.md

**Files:**
- Modify: `PLAN.md`

- [ ] **Step 1: Update the Phase 7 status note**

Find the long "Current phase" sentence in the Phase 7 section of `PLAN.md` (the one starting "Phase 7 ... complete"). Append this clause inside the parenthetical, before "complete":

```
; OS theme can be overridden via a native macOS menu-bar Theme submenu (System / Light / Dark) persisted in a SQLite `settings` table (migration v4) and applied via Tailwind v4's class-based dark variant (`@custom-variant dark (&:where(.dark, .dark *))`) with an inline bootstrap script in `index.html` to avoid first-paint flash
```

- [ ] **Step 2: Update §12 Q3 (settings storage)**

In §12, change the bullet:

```
3. **Settings storage** — SQLite `settings` table (plan) vs a JSON file. Plan uses SQLite.
```

to:

```
3. **Settings storage** — SQLite `settings` table (added in migration v4 alongside the theme override). JSON value column for forward compatibility.
```

- [ ] **Step 3: Commit**

```bash
git add PLAN.md
git commit -m "docs(plan): note theme override + class-based dark in Phase 7"
```

---

## Task 17: End-to-end verification

**Files:** none modified

- [ ] **Step 1: Full build sanity**

Run: `cargo check --manifest-path src-tauri/Cargo.toml --quiet && pnpm tsc --noEmit`
Expected: both exit 0 with no warnings.

- [ ] **Step 2: Run all Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --quiet`
Expected: all pass (migration tests assert v4, settings tests pass).

- [ ] **Step 3: Start the dev app**

Run: `pnpm tauri dev`
Expected: Vite server listens on 1420, Rust compiles, window opens.

- [ ] **Step 4: Ask the user to verify visually**

Per `CLAUDE.md`'s verification rule, the agent cannot observe Tauri UI. Stop and ask the user to confirm:

  1. **Light mode bug fix:** With macOS in Light Appearance, the search input and sort controls visually match the rest of the toolbar (light background, dark text, no leftover dark patches).
  2. **Menu present:** The menu bar shows a "Theme" menu next to the standard ones (Edit, View, Window, Help).
  3. **Switching works:** Picking "Light" / "Dark" / "System" instantly switches the UI; the active item is checkmarked.
  4. **System restores OS-driven behavior:** With "System" selected, toggling macOS Appearance in System Settings instantly re-themes the app.
  5. **Persistence:** Pick "Dark", quit the app, relaunch — the app comes up dark from the very first painted frame (no light flash). Same for "Light".

- [ ] **Step 5: If user confirms, the work is done. Otherwise, debug and re-verify.**

Do not claim completion before the user signs off on step 4.

---

## Self-Review

**Spec coverage check:**
- ✅ Light-mode regression in SearchBox + SortDropdown — Tasks 1, 2.
- ✅ Native macOS menu via `tauri::menu` — Task 8.
- ✅ Three options (System / Light / Dark) with active checkmarked — Task 8.
- ✅ Selection emits `theme:changed` namespaced event — Task 8 (via `events::theme_changed`).
- ✅ Persistence in SQLite (no new dep) — Tasks 3, 5.
- ✅ Switch to class-based Tailwind dark variant — Task 9.
- ✅ Apply before first paint — Task 10 (inline bootstrap script).
- ✅ "System" restores OS-driven behavior, listens to OS only when in System — Task 14.
- ✅ Bindings regenerated via `pnpm bindings` — Task 4 step 2.
- ✅ `PLAN.md` updated for the architectural shift — Task 16.

**Placeholder scan:** No "TBD"/"add appropriate"/"similar to Task N" placeholders. All Tailwind class strings, Rust code blocks, and SQL fragments are complete.

**Type/name consistency:**
- Rust `ThemeMode` ↔ TS `ThemeMode` (lowercase serde): used identically in Tasks 4, 5, 8, 12, 13, 14.
- Event name `"theme:changed"`: matches between `events.rs` const, `events::theme_changed`, `events.ts` const, `useTheme`.
- localStorage key `"stl-browser:theme"`: matches between bootstrap script (Task 10), Zustand setter (Task 12), and the hook contract.
- IDs `"theme:system"`/`"theme:light"`/`"theme:dark"`: built in Task 8 step 2 and matched in Task 8 step 3 menu-event handler.
- Settings key `"theme_mode"` lives only in `db/settings.rs` — no callers reach into the raw key string.

---

## Stop-and-Ask Items (per spec) — RESOLVED IN PLAN

The following items the spec said to confirm are answered below; the user should sanity-check before execution:

1. **SQLite migration approach** — existing pattern is to append to the `MIGRATIONS: &[&str]` array in `migrations.rs` (one transaction per entry, schema_version table tracks high-water mark). Plan follows that pattern (Task 3).
2. **Tailwind dark strategy change touches `App.css` (= the project's index.css equivalent) and `index.html` (the root layout).** This is at the boundary of the spec's "more than `src/index.css` and the root layout" caveat — both files are required because the bootstrap-before-paint inline script must live in `index.html`. No third file is touched for the strategy switch.
3. **No new Cargo or pnpm dependency** is added.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-25-light-mode-and-theme-menu.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
