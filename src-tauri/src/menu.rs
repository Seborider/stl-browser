// Built fresh on every language change because Tauri menus are static after
// construction; the tree is small enough that rebuild is imperceptible.

use std::sync::Arc;

use tauri::menu::{CheckMenuItemBuilder, Menu, SubmenuBuilder};
use tauri::AppHandle;

use crate::error::IpcError;
use crate::i18n::t;
use crate::state::{AppState, ThemeMenuHandles};
use crate::types::{Language, ThemeMode};

pub fn build(
    app: &AppHandle,
    theme: ThemeMode,
    language: Language,
) -> Result<ThemeMenuHandles, IpcError> {
    let theme_handles = build_theme_items(app, theme, language)?;
    let lang_items = build_language_items(app, language)?;

    let theme_submenu = SubmenuBuilder::new(app, t("menu.theme", language))
        .item(&theme_handles.system)
        .item(&theme_handles.light)
        .item(&theme_handles.dark)
        .build()
        .map_err(menu_err)?;

    let language_submenu = SubmenuBuilder::new(app, t("menu.language", language))
        .item(&lang_items[0])
        .item(&lang_items[1])
        .item(&lang_items[2])
        .build()
        .map_err(menu_err)?;

    let settings_submenu = SubmenuBuilder::new(app, t("menu.settings", language))
        .item(&theme_submenu)
        .item(&language_submenu)
        .build()
        .map_err(menu_err)?;

    let menu = Menu::default(app).map_err(menu_err)?;
    menu.append(&settings_submenu).map_err(menu_err)?;
    app.set_menu(menu).map_err(menu_err)?;

    Ok(theme_handles)
}

pub fn rebuild(
    app: &AppHandle,
    state: &Arc<AppState>,
    theme: ThemeMode,
    language: Language,
) -> Result<(), IpcError> {
    let handles = build(app, theme, language)?;
    let mut slot = state
        .menu_handles
        .lock()
        .map_err(|e| IpcError::Database(format!("menu_handles mutex poisoned: {e}")))?;
    *slot = Some(handles);
    Ok(())
}

fn build_theme_items(
    app: &AppHandle,
    selected: ThemeMode,
    language: Language,
) -> Result<ThemeMenuHandles, IpcError> {
    Ok(ThemeMenuHandles {
        system: CheckMenuItemBuilder::with_id(ThemeMode::System.menu_id(), t("menu.theme.system", language))
            .checked(selected == ThemeMode::System)
            .build(app)
            .map_err(menu_err)?,
        light: CheckMenuItemBuilder::with_id(ThemeMode::Light.menu_id(), t("menu.theme.light", language))
            .checked(selected == ThemeMode::Light)
            .build(app)
            .map_err(menu_err)?,
        dark: CheckMenuItemBuilder::with_id(ThemeMode::Dark.menu_id(), t("menu.theme.dark", language))
            .checked(selected == ThemeMode::Dark)
            .build(app)
            .map_err(menu_err)?,
    })
}

fn build_language_items(
    app: &AppHandle,
    selected: Language,
) -> Result<[tauri::menu::CheckMenuItem<tauri::Wry>; 3], IpcError> {
    let make = |lang: Language, key: &'static str| -> Result<_, IpcError> {
        CheckMenuItemBuilder::with_id(lang.menu_id(), t(key, selected))
            .checked(selected == lang)
            .build(app)
            .map_err(menu_err)
    };
    Ok([
        make(Language::System, "menu.language.system")?,
        make(Language::En, "menu.language.en")?,
        make(Language::De, "menu.language.de")?,
    ])
}

fn menu_err<E: std::fmt::Display>(e: E) -> IpcError {
    IpcError::Internal(format!("menu: {e}"))
}
