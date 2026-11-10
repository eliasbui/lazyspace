//! The places the user went to, newest first, for the path bar: the paths typed into it and the folders opened, kept in
//! history.json beside the settings so that every window and the next launch share them. A place typed once stays
//! marked as typed, which the path bar offers first as it completes what is typed.

use crate::{
    features::data_file,
    ipc::{Dispatcher, args},
    vfs::Uri,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

/// The most places kept.
const MAX: usize = 60;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Place {
    pub uri: String,
    /// Typed into the path bar at least once, rather than only opened.
    #[serde(default)]
    pub typed: bool,
    /// When it was last opened, in seconds since 1970.
    #[serde(default)]
    pub at: i64,
}

fn path() -> PathBuf {
    data_file("history.json")
}

pub fn load(path: &Path) -> Vec<Place> {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn save(path: &Path, places: &[Place]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(places).map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text).and_then(|()| std::fs::rename(&temp, path)).map_err(|e| e.to_string())
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// `uri` moved to the front, typed if it is typed now or was before; the oldest go past `MAX`.
pub fn add(places: &mut Vec<Place>, uri: &str, typed: bool, at: i64) {
    let before = places.iter().position(|p| p.uri == uri).map(|i| places.remove(i));
    places.insert(0, Place { uri: uri.to_owned(), typed: typed || before.is_some_and(|p| p.typed), at });
    places.truncate(MAX);
}

pub fn register(d: &mut Dispatcher) {
    d.on("history.list", |_, _, _| Ok(json!(load(&path()))));
    d.on("history.add", |_, _, a| {
        #[derive(Deserialize)]
        struct Add {
            uri: String,
            #[serde(default)]
            typed: bool,
        }
        let a: Add = args(a)?;
        // Only a place the app can open is kept, as the app writes it.
        let uri = Uri::parse(&a.uri)?.to_string();
        let mut places = load(&path());
        add(&mut places, &uri, a.typed, now());
        save(&path(), &places)?;
        Ok(Value::Null)
    });
    d.on("history.remove", |_, _, a| {
        #[derive(Deserialize)]
        struct Remove {
            uri: String,
        }
        let uri = args::<Remove>(a)?.uri;
        let mut places = load(&path());
        places.retain(|p| p.uri != uri);
        save(&path(), &places)?;
        Ok(json!(places))
    });
    d.on("history.clear", |_, _, _| {
        save(&path(), &[])?;
        Ok(json!([]))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_place_goes_to_the_front_once_and_stays_typed() {
        let mut places = Vec::new();
        add(&mut places, "file:///a", true, 1);
        add(&mut places, "file:///b", false, 2);
        add(&mut places, "file:///a", false, 3);
        assert_eq!(places, [Place { uri: "file:///a".into(), typed: true, at: 3 }, Place { uri: "file:///b".into(), typed: false, at: 2 }]);
        for i in 0..100 {
            add(&mut places, &format!("file:///n{i}"), false, 10 + i);
        }
        assert_eq!(places.len(), MAX);
        assert_eq!(places[0].uri, "file:///n99", "the newest first, the oldest gone");
    }

    #[test]
    fn the_history_file_roundtrips_and_a_missing_one_is_empty() {
        let dir = std::env::temp_dir().join(format!("lazyspace-test-history-{}", std::process::id()));
        let file = dir.join("history.json");
        assert!(load(&file).is_empty());
        let places = vec![Place { uri: "file:///x".into(), typed: true, at: 5 }];
        save(&file, &places).unwrap();
        assert_eq!(load(&file), places);
        std::fs::write(&file, "not json").unwrap();
        assert!(load(&file).is_empty(), "a damaged file is read as no history rather than an error");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
