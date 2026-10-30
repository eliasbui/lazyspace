//! What the user can change, kept in a small file in the data folder, and the layout of the last window beside it.
//! Both are JSON written through a temporary file, so a crash never leaves half of one.

use crate::tr;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

/// A file that replaces `settings.json`, with `layout.json` beside it: how a smoke test or a screenshot run keeps away
/// from the user's own.
pub const SETTINGS_ENV: &str = "LAZYSPACE_SETTINGS";

pub fn data_dir() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).or_else(dirs::home_dir).unwrap_or_else(|| ".".into());
    home.join("Library/Application Support/LazySpace")
}

/// Where `settings.json` is: the data folder's, or the file `LAZYSPACE_SETTINGS` names.
pub fn settings_path() -> PathBuf {
    std::env::var_os(SETTINGS_ENV).filter(|p| !p.is_empty()).map(PathBuf::from).unwrap_or_else(|| data_dir().join("settings.json"))
}

/// Where `layout.json` is: beside `settings.json`, so the override moves both.
pub fn layout_path() -> PathBuf {
    settings_path().with_file_name("layout.json")
}

/// How a tab's listing is sorted (the page's `Sort`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Sort {
    /// "name", "size", "mtime", "kind" or "ext".
    pub by: String,
    pub desc: bool,
    #[serde(rename = "foldersFirst")]
    pub folders_first: bool,
}

impl Default for Sort {
    fn default() -> Self {
        Sort { by: "name".into(), desc: false, folders_first: true }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Preview {
    /// "right" or "bottom".
    pub side: String,
    pub on: bool,
}

impl Default for Preview {
    fn default() -> Self {
        Preview { side: "right".into(), on: false }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Desktop {
    pub on: bool,
    pub hide_finder_icons: bool,
}

/// A field missing from an older file takes its default, so an update keeps the rest; a key this version does not know
/// is kept and written back, so a file from a newer version is not cut when this one saves.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// "vi" or "en".
    pub language: String,
    /// "system", "light" or "dark".
    pub theme: String,
    /// The window drawn in Liquid Glass (beta): native glass behind a page that lets it through.
    pub glass: bool,
    /// "mac" or "windows".
    pub keymap: String,
    pub show_hidden: bool,
    pub folder_sizes: bool,
    /// "list", "icons" or "columns".
    pub view_mode: String,
    pub sort: Sort,
    pub confirm_delete: bool,
    pub preview: Preview,
    pub desktop: Desktop,
    pub check_updates: bool,
    pub favourites: Vec<String>,
    pub sidebar_sections: Value,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            language: "vi".into(),
            theme: "system".into(),
            glass: false,
            keymap: "mac".into(),
            show_hidden: false,
            folder_sizes: false,
            view_mode: "list".into(),
            sort: Sort::default(),
            confirm_delete: true,
            preview: Preview::default(),
            desktop: Desktop::default(),
            check_updates: true,
            favourites: Vec::new(),
            sidebar_sections: Value::Null,
            extra: Map::new(),
        }
    }
}

impl Settings {
    /// The settings in `path`, or the defaults when there is no file or it is not JSON.
    pub fn load(path: &Path) -> Settings {
        std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        write_json(path, &serde_json::to_value(self).map_err(|e| e.to_string())?)
    }

    /// The settings with `patch` merged in key by key, nested objects too. Only keys this version knows are taken, and
    /// the result must keep every field's type and every choice among its values.
    pub fn patched(&self, patch: &Value) -> Result<Settings, String> {
        let patch = patch.as_object().ok_or_else(|| tr("Thay đổi cài đặt phải là một đối tượng", "The settings change must be an object").to_owned())?;
        let known = serde_json::to_value(Settings::default()).map_err(|e| e.to_string())?;
        if let Some(key) = patch.keys().find(|k| known.get(k.as_str()).is_none()) {
            return Err(format!("{} {key}", tr("Cài đặt không có khóa", "Settings has no key")));
        }
        let mut merged = serde_json::to_value(self).map_err(|e| e.to_string())?;
        merge(&mut merged, &Value::Object(patch.clone()));
        let settings: Settings = serde_json::from_value(merged).map_err(|e| format!("{}: {e}", tr("Giá trị cài đặt không hợp lệ", "A settings value is not valid")))?;
        settings.check()?;
        Ok(settings)
    }

    fn check(&self) -> Result<(), String> {
        let choices: [(&str, &str, &[&str]); 6] = [
            ("language", &self.language, &["vi", "en"]),
            ("theme", &self.theme, &["system", "light", "dark"]),
            ("keymap", &self.keymap, &["mac", "windows"]),
            ("view_mode", &self.view_mode, &["list", "icons", "columns"]),
            ("sort.by", &self.sort.by, &["name", "size", "mtime", "kind", "ext"]),
            ("preview.side", &self.preview.side, &["right", "bottom"]),
        ];
        for (key, value, allowed) in choices {
            if !allowed.contains(&value) {
                return Err(format!("{} {key}: {value}", tr("Giá trị không hợp lệ cho", "Not a valid value for")));
            }
        }
        Ok(())
    }
}

fn merge(into: &mut Value, patch: &Value) {
    match (into, patch) {
        (Value::Object(into), Value::Object(patch)) => {
            for (key, value) in patch {
                merge(into.entry(key.clone()).or_insert(Value::Null), value);
            }
        }
        (into, patch) => *into = patch.clone(),
    }
}

/// The layout of the last window (`layout.json`), or null when there is none.
pub fn load_layout(path: &Path) -> Value {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)
}

pub fn save_layout(path: &Path, layout: &Value) -> Result<(), String> {
    write_json(path, layout)
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let folder = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    std::fs::create_dir_all(folder).map_err(|e| format!("{}: {e}", folder.display()))?;
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text).and_then(|()| std::fs::rename(&temp, path)).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lazyspace-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A settings file from before a field existed keeps what it has, and the new fields take their defaults.
    #[test]
    fn older_settings_keep_defaults() {
        let settings: Settings = serde_json::from_str(r#"{"language": "en", "sort": {"by": "size"}}"#).unwrap();
        assert_eq!((settings.language.as_str(), settings.sort.by.as_str(), settings.sort.folders_first), ("en", "size", true));
        assert_eq!((settings.theme.as_str(), settings.glass, settings.confirm_delete, settings.check_updates), ("system", false, true, true));
        assert_eq!((settings.keymap.as_str(), settings.view_mode.as_str(), settings.preview.side.as_str()), ("mac", "list", "right"));
    }

    #[test]
    fn keys_of_a_newer_version_survive_a_save() {
        let dir = temp_dir("extra");
        let path = dir.join("settings.json");
        std::fs::write(&path, r#"{"language": "en", "from_the_future": {"a": 1}}"#).unwrap();
        Settings::load(&path).save(&path).unwrap();
        let saved: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved["from_the_future"], json!({"a": 1}));
        assert_eq!(saved["language"], "en");
        assert!(!path.with_extension("json.tmp").exists(), "the temporary file is renamed away");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_patch_merges_known_keys_and_refuses_the_rest() {
        let settings = Settings::default();
        let patched = settings.patched(&json!({"glass": true, "sort": {"desc": true}})).unwrap();
        assert!(patched.glass && patched.sort.desc);
        assert_eq!((patched.sort.by.as_str(), patched.sort.folders_first), ("name", true), "the rest of sort stays");
        assert!(settings.patched(&json!({"colour": "red"})).is_err(), "a key nobody knows");
        assert!(settings.patched(&json!({"glass": "yes"})).is_err(), "a wrong type");
        assert!(settings.patched(&json!({"theme": "sepia"})).is_err(), "a choice that does not exist");
        assert!(settings.patched(&json!(["glass"])).is_err(), "not an object");
    }

    #[test]
    fn the_override_moves_the_settings_and_the_layout_together() {
        // The variable is process-wide, so this is the only test that touches it.
        unsafe { std::env::set_var(SETTINGS_ENV, "/tmp/lazyspace-x/s.json") };
        assert_eq!((settings_path(), layout_path()), ("/tmp/lazyspace-x/s.json".into(), "/tmp/lazyspace-x/layout.json".into()));
        unsafe { std::env::remove_var(SETTINGS_ENV) };
        assert!(settings_path().ends_with("Library/Application Support/LazySpace/settings.json"));
        assert!(layout_path().ends_with("Library/Application Support/LazySpace/layout.json"));
    }

    #[test]
    fn a_layout_is_saved_whole_and_read_back() {
        let dir = temp_dir("layout");
        let path = dir.join("nested/layout.json");
        assert_eq!(load_layout(&path), Value::Null);
        save_layout(&path, &json!({"layout": "h2", "panes": []})).unwrap();
        assert_eq!(load_layout(&path)["layout"], "h2");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
