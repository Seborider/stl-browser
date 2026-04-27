use rusqlite::{params, Connection, OptionalExtension};

use crate::error::IpcError;
use crate::types::{
    Language, ThemeMode, DEFAULT_LIGHT_AZIMUTH_DEG, DEFAULT_LIGHT_COLOR, DEFAULT_MODEL_COLOR,
};

const KEY_THEME_MODE: &str = "theme_mode";
const KEY_LANGUAGE: &str = "language";
const KEY_MODEL_COLOR: &str = "model_color";
const KEY_LIGHT_COLOR: &str = "light_color";
const KEY_LIGHT_AZIMUTH_DEG: &str = "light_azimuth_deg";

// Returns the persisted theme override, defaulting to System when no row
// exists (fresh install) or the value can't be parsed (forward-compat or
// hand-edited DB).
pub fn get_theme_mode(conn: &Connection) -> Result<ThemeMode, IpcError> {
    Ok(read_text(conn, KEY_THEME_MODE)?
        .as_deref()
        .and_then(parse_theme)
        .unwrap_or(ThemeMode::System))
}

pub fn set_theme_mode(conn: &Connection, mode: ThemeMode) -> Result<(), IpcError> {
    upsert(conn, KEY_THEME_MODE, theme_to_str(mode))
}

// Returns `Some(lang)` if the user (or first-launch detection) has stored a
// preference, `None` for a fresh DB. The caller distinguishes these cases:
// `None` triggers OS-locale detection in setup; once a value is written we
// trust it on every subsequent boot.
pub fn get_language(conn: &Connection) -> Result<Option<Language>, IpcError> {
    Ok(read_text(conn, KEY_LANGUAGE)?
        .as_deref()
        .and_then(parse_language))
}

pub fn set_language(conn: &Connection, lang: Language) -> Result<(), IpcError> {
    upsert(conn, KEY_LANGUAGE, language_to_str(lang))
}

fn theme_to_str(mode: ThemeMode) -> &'static str {
    match mode {
        ThemeMode::System => "system",
        ThemeMode::Light => "light",
        ThemeMode::Dark => "dark",
    }
}

fn parse_theme(s: &str) -> Option<ThemeMode> {
    match s {
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

// Defaults are returned when the row is missing or the stored value fails
// validation, matching the theme-mode forward-compat policy.
pub fn get_model_color(conn: &Connection) -> Result<String, IpcError> {
    Ok(read_text(conn, KEY_MODEL_COLOR)?
        .as_deref()
        .and_then(parse_hex_color)
        .unwrap_or_else(|| DEFAULT_MODEL_COLOR.to_string()))
}

pub fn set_model_color(conn: &Connection, hex: &str) -> Result<(), IpcError> {
    let normalized = parse_hex_color(hex)
        .ok_or_else(|| IpcError::Invalid(format!("invalid hex color: {hex}")))?;
    upsert(conn, KEY_MODEL_COLOR, &normalized)
}

pub fn get_light_color(conn: &Connection) -> Result<String, IpcError> {
    Ok(read_text(conn, KEY_LIGHT_COLOR)?
        .as_deref()
        .and_then(parse_hex_color)
        .unwrap_or_else(|| DEFAULT_LIGHT_COLOR.to_string()))
}

pub fn set_light_color(conn: &Connection, hex: &str) -> Result<(), IpcError> {
    let normalized = parse_hex_color(hex)
        .ok_or_else(|| IpcError::Invalid(format!("invalid hex color: {hex}")))?;
    upsert(conn, KEY_LIGHT_COLOR, &normalized)
}

pub fn get_light_azimuth_deg(conn: &Connection) -> Result<f32, IpcError> {
    Ok(read_text(conn, KEY_LIGHT_AZIMUTH_DEG)?
        .as_deref()
        .and_then(parse_azimuth)
        .unwrap_or(DEFAULT_LIGHT_AZIMUTH_DEG))
}

pub fn set_light_azimuth_deg(conn: &Connection, deg: f32) -> Result<(), IpcError> {
    let wrapped = wrap_azimuth(deg);
    upsert(conn, KEY_LIGHT_AZIMUTH_DEG, &format!("{wrapped}"))
}

fn read_text(conn: &Connection, key: &str) -> Result<Option<String>, IpcError> {
    Ok(conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()?)
}

fn upsert(conn: &Connection, key: &str, value: &str) -> Result<(), IpcError> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)\n\
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

fn parse_hex_color(s: &str) -> Option<String> {
    let trimmed = s.trim();
    if trimmed.len() != 7 || !trimmed.starts_with('#') {
        return None;
    }
    let body = &trimmed[1..];
    if !body.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("#{}", body.to_ascii_lowercase()))
}

fn parse_azimuth(s: &str) -> Option<f32> {
    let v: f32 = s.trim().parse().ok()?;
    if !v.is_finite() {
        return None;
    }
    Some(wrap_azimuth(v))
}

fn wrap_azimuth(deg: f32) -> f32 {
    let r = deg.rem_euclid(360.0);
    if r == 360.0 {
        0.0
    } else {
        r
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

    #[test]
    fn fresh_db_returns_default_appearance() {
        let conn = open_memory();
        assert_eq!(get_model_color(&conn).unwrap(), DEFAULT_MODEL_COLOR);
        assert_eq!(get_light_color(&conn).unwrap(), DEFAULT_LIGHT_COLOR);
        assert_eq!(
            get_light_azimuth_deg(&conn).unwrap(),
            DEFAULT_LIGHT_AZIMUTH_DEG
        );
    }

    #[test]
    fn round_trip_colors_normalize_to_lowercase() {
        let conn = open_memory();
        set_model_color(&conn, "#ABCDEF").unwrap();
        assert_eq!(get_model_color(&conn).unwrap(), "#abcdef");
        set_light_color(&conn, "#FF00aa").unwrap();
        assert_eq!(get_light_color(&conn).unwrap(), "#ff00aa");
    }

    #[test]
    fn invalid_color_input_rejected_by_setter() {
        let conn = open_memory();
        assert!(set_model_color(&conn, "red").is_err());
        assert!(set_model_color(&conn, "#ZZZZZZ").is_err());
        assert!(set_model_color(&conn, "#abc").is_err());
    }

    #[test]
    fn round_trip_azimuth_wraps() {
        let conn = open_memory();
        set_light_azimuth_deg(&conn, 90.5).unwrap();
        assert!((get_light_azimuth_deg(&conn).unwrap() - 90.5).abs() < 1e-3);
        set_light_azimuth_deg(&conn, 720.0).unwrap();
        assert_eq!(get_light_azimuth_deg(&conn).unwrap(), 0.0);
        set_light_azimuth_deg(&conn, -10.0).unwrap();
        assert!((get_light_azimuth_deg(&conn).unwrap() - 350.0).abs() < 1e-3);
    }

    #[test]
    fn unknown_appearance_values_fall_back_to_defaults() {
        let conn = open_memory();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('model_color', 'lava')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('light_azimuth_deg', 'NaN-ish')",
            [],
        )
        .unwrap();
        assert_eq!(get_model_color(&conn).unwrap(), DEFAULT_MODEL_COLOR);
        assert_eq!(
            get_light_azimuth_deg(&conn).unwrap(),
            DEFAULT_LIGHT_AZIMUTH_DEG
        );
    }
}
