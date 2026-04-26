// Rust-side menu strings, separate from React's i18next catalogs because the
// menu is built before the renderer is alive — no JSON resources to share.

use crate::types::Language;

pub fn resolve(stored: Language) -> Language {
    match stored {
        Language::En => Language::En,
        Language::De => Language::De,
        Language::System => detect_os_language(),
    }
}

pub fn detect_os_language() -> Language {
    sys_locale::get_locale()
        .as_deref()
        .map(classify_locale)
        .unwrap_or(Language::En)
}

fn classify_locale(s: &str) -> Language {
    let primary = s
        .split(|c: char| c == '-' || c == '_')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if primary == "de" {
        Language::De
    } else {
        Language::En
    }
}

// `key` is `&'static str` because all call sites pass literals; on an
// unknown key we return the key itself so a typo shows up in the menu UI.
pub fn t(key: &'static str, lang: Language) -> &'static str {
    let lang = resolve(lang);
    match (key, lang) {
        ("menu.settings", Language::En) => "Settings",
        ("menu.settings", Language::De) => "Einstellungen",
        ("menu.theme", Language::En) => "Theme",
        ("menu.theme", Language::De) => "Erscheinungsbild",
        ("menu.language", Language::En) => "Language",
        ("menu.language", Language::De) => "Sprache",

        ("menu.theme.system", Language::En) => "System",
        ("menu.theme.system", Language::De) => "System",
        ("menu.theme.light", Language::En) => "Light",
        ("menu.theme.light", Language::De) => "Hell",
        ("menu.theme.dark", Language::En) => "Dark",
        ("menu.theme.dark", Language::De) => "Dunkel",

        // English/Deutsch are the languages' own names by convention — users
        // searching for their language recognize the native form regardless
        // of current display language.
        ("menu.language.system", Language::En) => "System",
        ("menu.language.system", Language::De) => "System",
        ("menu.language.en", _) => "English",
        ("menu.language.de", _) => "Deutsch",

        _ => key,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_examples() {
        assert_eq!(classify_locale("de"), Language::De);
        assert_eq!(classify_locale("de-DE"), Language::De);
        assert_eq!(classify_locale("de_AT"), Language::De);
        assert_eq!(classify_locale("en-US"), Language::En);
        assert_eq!(classify_locale("fr-FR"), Language::En);
        assert_eq!(classify_locale(""), Language::En);
    }

    #[test]
    fn translates_menu_keys() {
        assert_eq!(t("menu.settings", Language::En), "Settings");
        assert_eq!(t("menu.settings", Language::De), "Einstellungen");
        assert_eq!(t("menu.theme.dark", Language::De), "Dunkel");
        assert_eq!(t("menu.language.de", Language::En), "Deutsch");
        assert_eq!(t("menu.language.en", Language::De), "English");
    }

    #[test]
    fn resolve_passes_through_concrete() {
        assert_eq!(resolve(Language::En), Language::En);
        assert_eq!(resolve(Language::De), Language::De);
    }
}
