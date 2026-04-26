use rusqlite::{params, Connection, OptionalExtension};

use crate::error::IpcError;
use crate::types::{Language, ThemeMode};

const KEY_THEME_MODE: &str = "theme_mode";
const KEY_LANGUAGE: &str = "language";

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

// Returns `Some(lang)` if the user (or first-launch detection) has stored a
// preference, `None` for a fresh DB. The caller distinguishes these cases:
// `None` triggers OS-locale detection in setup; once a value is written we
// trust it on every subsequent boot.
pub fn get_language(conn: &Connection) -> Result<Option<Language>, IpcError> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![KEY_LANGUAGE],
            |row| row.get(0),
        )
        .optional()?;
    Ok(raw.as_deref().and_then(parse_language))
}

pub fn set_language(conn: &Connection, lang: Language) -> Result<(), IpcError> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)\n\
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![KEY_LANGUAGE, language_to_str(lang)],
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

fn language_to_str(lang: Language) -> &'static str {
    match lang {
        Language::System => "system",
        Language::En => "en",
        Language::De => "de",
    }
}

fn parse_language(s: &str) -> Option<Language> {
    match s {
        "system" => Some(Language::System),
        "en" => Some(Language::En),
        "de" => Some(Language::De),
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

    #[test]
    fn fresh_db_returns_no_language() {
        let conn = open_memory();
        assert!(get_language(&conn).unwrap().is_none());
    }

    #[test]
    fn round_trip_languages() {
        let conn = open_memory();
        set_language(&conn, Language::De).unwrap();
        assert_eq!(get_language(&conn).unwrap(), Some(Language::De));
        set_language(&conn, Language::En).unwrap();
        assert_eq!(get_language(&conn).unwrap(), Some(Language::En));
        set_language(&conn, Language::System).unwrap();
        assert_eq!(get_language(&conn).unwrap(), Some(Language::System));
    }

    #[test]
    fn unknown_language_returns_none() {
        let conn = open_memory();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('language', 'fr')",
            [],
        )
        .unwrap();
        assert_eq!(get_language(&conn).unwrap(), None);
    }
}
