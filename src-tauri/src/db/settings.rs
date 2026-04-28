use rusqlite::{params, Connection, OptionalExtension};

use crate::error::IpcError;
use crate::types::{
    default_lights, Language, LightConfig, ThemeMode, DEFAULT_BACKGROUND_COLOR,
    DEFAULT_LIGHT_AZIMUTH_DEG, DEFAULT_LIGHT_COLOR, DEFAULT_LIGHT_INTENSITY_NORM,
    DEFAULT_MODEL_COLOR, MAX_LIGHTS,
};

const KEY_THEME_MODE: &str = "theme_mode";
const KEY_LANGUAGE: &str = "language";
const KEY_MODEL_COLOR: &str = "model_color";
const KEY_LIGHT_COLOR: &str = "light_color";
const KEY_LIGHT_AZIMUTH_DEG: &str = "light_azimuth_deg";
const KEY_LIGHTS: &str = "lights";
const KEY_BACKGROUND_COLOR: &str = "background_color";

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

pub fn get_background_color(conn: &Connection) -> Result<String, IpcError> {
    Ok(read_text(conn, KEY_BACKGROUND_COLOR)?
        .as_deref()
        .and_then(parse_hex_color)
        .unwrap_or_else(|| DEFAULT_BACKGROUND_COLOR.to_string()))
}

pub fn set_background_color(conn: &Connection, hex: &str) -> Result<(), IpcError> {
    let normalized = parse_hex_color(hex)
        .ok_or_else(|| IpcError::Invalid(format!("invalid hex color: {hex}")))?;
    upsert(conn, KEY_BACKGROUND_COLOR, &normalized)
}

// `lights` is JSON-serialized into a single k/v row to avoid a schema change.
// On unparseable payload, fall back to the pre-`lights` single-light rows
// (`light_color` + `light_azimuth_deg`); if those are missing too, return the
// default single-light array. `set_lights` deletes the legacy rows after the
// first successful write so the migration runs at most once.
pub fn get_lights(conn: &Connection) -> Result<Vec<LightConfig>, IpcError> {
    if let Some(raw) = read_text(conn, KEY_LIGHTS)? {
        if let Ok(parsed) = serde_json::from_str::<Vec<LightConfig>>(&raw) {
            let validated = validate_lights(parsed);
            if !validated.is_empty() {
                return Ok(validated);
            }
        }
    }

    let legacy_color = read_text(conn, KEY_LIGHT_COLOR)?
        .as_deref()
        .and_then(parse_hex_color);
    let legacy_az = read_text(conn, KEY_LIGHT_AZIMUTH_DEG)?
        .as_deref()
        .and_then(parse_azimuth);
    if legacy_color.is_some() || legacy_az.is_some() {
        return Ok(vec![LightConfig {
            color: legacy_color.unwrap_or_else(|| DEFAULT_LIGHT_COLOR.to_string()),
            intensity_norm: DEFAULT_LIGHT_INTENSITY_NORM,
            azimuth_deg: legacy_az.unwrap_or(DEFAULT_LIGHT_AZIMUTH_DEG),
            enabled: true,
        }]);
    }

    Ok(default_lights())
}

pub fn set_lights(conn: &Connection, lights: &[LightConfig]) -> Result<(), IpcError> {
    let validated = validate_lights(lights.to_vec());
    if validated.is_empty() {
        return Err(IpcError::Invalid("lights array must contain 1..=4 valid entries".into()));
    }
    let json = serde_json::to_string(&validated)
        .map_err(|e| IpcError::Invalid(format!("failed to serialize lights: {e}")))?;
    upsert(conn, KEY_LIGHTS, &json)?;
    // Drop the legacy single-light rows so future reads don't second-guess
    // the new payload.
    conn.execute(
        "DELETE FROM settings WHERE key IN (?1, ?2)",
        params![KEY_LIGHT_COLOR, KEY_LIGHT_AZIMUTH_DEG],
    )?;
    Ok(())
}

fn validate_lights(input: Vec<LightConfig>) -> Vec<LightConfig> {
    input
        .into_iter()
        .filter_map(|l| {
            let color = parse_hex_color(&l.color)?;
            if !l.intensity_norm.is_finite() {
                return None;
            }
            let intensity_norm = l.intensity_norm.clamp(0.0, 1.0);
            if !l.azimuth_deg.is_finite() {
                return None;
            }
            let azimuth_deg = wrap_azimuth(l.azimuth_deg);
            Some(LightConfig {
                color,
                intensity_norm,
                azimuth_deg,
                enabled: l.enabled,
            })
        })
        .take(MAX_LIGHTS)
        .collect()
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
        let lights = get_lights(&conn).unwrap();
        assert_eq!(lights.len(), 1);
        assert_eq!(lights[0].color, DEFAULT_LIGHT_COLOR);
        assert_eq!(lights[0].azimuth_deg, DEFAULT_LIGHT_AZIMUTH_DEG);
        assert!(lights[0].enabled);
        assert_eq!(get_background_color(&conn).unwrap(), DEFAULT_BACKGROUND_COLOR);
    }

    #[test]
    fn round_trip_colors_normalize_to_lowercase() {
        let conn = open_memory();
        set_model_color(&conn, "#ABCDEF").unwrap();
        assert_eq!(get_model_color(&conn).unwrap(), "#abcdef");
        set_background_color(&conn, "#FF00aa").unwrap();
        assert_eq!(get_background_color(&conn).unwrap(), "#ff00aa");
    }

    #[test]
    fn invalid_color_input_rejected_by_setter() {
        let conn = open_memory();
        assert!(set_model_color(&conn, "red").is_err());
        assert!(set_model_color(&conn, "#ZZZZZZ").is_err());
        assert!(set_model_color(&conn, "#abc").is_err());
        assert!(set_background_color(&conn, "rgb(0,0,0)").is_err());
    }

    fn make_light(color: &str, intensity: f32, azimuth: f32, enabled: bool) -> LightConfig {
        LightConfig {
            color: color.into(),
            intensity_norm: intensity,
            azimuth_deg: azimuth,
            enabled,
        }
    }

    #[test]
    fn round_trip_lights_normalizes_color_and_wraps_azimuth() {
        let conn = open_memory();
        set_lights(
            &conn,
            &[make_light("#FFAA00", 0.7, 720.0, true)],
        )
        .unwrap();
        let lights = get_lights(&conn).unwrap();
        assert_eq!(lights.len(), 1);
        assert_eq!(lights[0].color, "#ffaa00");
        assert_eq!(lights[0].azimuth_deg, 0.0);
        assert!((lights[0].intensity_norm - 0.7).abs() < 1e-6);
    }

    #[test]
    fn lights_clamped_to_max_four() {
        let conn = open_memory();
        let many = vec![
            make_light("#111111", 1.0, 0.0, true),
            make_light("#222222", 1.0, 60.0, true),
            make_light("#333333", 1.0, 120.0, true),
            make_light("#444444", 1.0, 180.0, true),
            make_light("#555555", 1.0, 240.0, true),
            make_light("#666666", 1.0, 300.0, true),
        ];
        set_lights(&conn, &many).unwrap();
        let lights = get_lights(&conn).unwrap();
        assert_eq!(lights.len(), 4);
        assert_eq!(lights[0].color, "#111111");
        assert_eq!(lights[3].color, "#444444");
    }

    #[test]
    fn lights_intensity_clamped_to_unit_range() {
        let conn = open_memory();
        set_lights(
            &conn,
            &[
                make_light("#ffffff", -0.5, 0.0, true),
                make_light("#ffffff", 5.0, 90.0, true),
            ],
        )
        .unwrap();
        let lights = get_lights(&conn).unwrap();
        assert_eq!(lights[0].intensity_norm, 0.0);
        assert_eq!(lights[1].intensity_norm, 1.0);
    }

    #[test]
    fn empty_lights_array_rejected() {
        let conn = open_memory();
        assert!(set_lights(&conn, &[]).is_err());
    }

    #[test]
    fn invalid_hex_in_lights_skipped() {
        let conn = open_memory();
        let mixed = vec![
            make_light("not-a-color", 0.5, 0.0, true),
            make_light("#abcdef", 0.5, 90.0, true),
        ];
        set_lights(&conn, &mixed).unwrap();
        let lights = get_lights(&conn).unwrap();
        assert_eq!(lights.len(), 1);
        assert_eq!(lights[0].color, "#abcdef");
    }

    #[test]
    fn migrates_legacy_single_light_rows() {
        let conn = open_memory();
        // Phase 7.6 schema: separate rows. No `lights` row yet.
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('light_color', '#aabbcc')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('light_azimuth_deg', '215')",
            [],
        )
        .unwrap();
        let lights = get_lights(&conn).unwrap();
        assert_eq!(lights.len(), 1);
        assert_eq!(lights[0].color, "#aabbcc");
        assert!((lights[0].azimuth_deg - 215.0).abs() < 1e-3);
        assert!(lights[0].enabled);
        assert_eq!(lights[0].intensity_norm, DEFAULT_LIGHT_INTENSITY_NORM);
    }

    #[test]
    fn set_lights_deletes_legacy_rows() {
        let conn = open_memory();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('light_color', '#aabbcc')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('light_azimuth_deg', '215')",
            [],
        )
        .unwrap();
        set_lights(&conn, &[make_light("#000000", 1.0, 0.0, true)]).unwrap();
        assert!(read_text(&conn, "light_color").unwrap().is_none());
        assert!(read_text(&conn, "light_azimuth_deg").unwrap().is_none());
    }

    #[test]
    fn unparseable_lights_payload_falls_back() {
        let conn = open_memory();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('lights', 'not-json')",
            [],
        )
        .unwrap();
        let lights = get_lights(&conn).unwrap();
        assert_eq!(lights.len(), 1);
        assert_eq!(lights[0].color, DEFAULT_LIGHT_COLOR);
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
            "INSERT INTO settings (key, value) VALUES ('background_color', '~teal~')",
            [],
        )
        .unwrap();
        assert_eq!(get_model_color(&conn).unwrap(), DEFAULT_MODEL_COLOR);
        assert_eq!(get_background_color(&conn).unwrap(), DEFAULT_BACKGROUND_COLOR);
    }
}
