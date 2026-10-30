//! Workspaces (W1): the state of a window (its layout, panes, tabs, places and views, the sidebar) saved under a name
//! and brought back with a click, kept in workspaces.json.

use crate::{
    features::data_file,
    ipc::{Dispatcher, args},
    tr,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// The most workspaces kept.
const MAX: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub created: i64,
    /// The window as the page reports it with `panes.state`.
    pub state: Value,
}

fn path() -> PathBuf {
    data_file("workspaces.json")
}

pub fn load(path: &Path) -> Vec<Workspace> {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn save(path: &Path, all: &[Workspace]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(all).map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text).and_then(|()| std::fs::rename(&temp, path)).map_err(|e| e.to_string())
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// Saves `state` as a workspace named `name`; a workspace of that name already there is replaced, as saving over it.
pub fn put(all: &mut Vec<Workspace>, name: &str, state: Value) -> Result<Workspace, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(tr("Tên workspace phải có từ 1 đến 80 ký tự", "A workspace name has 1 to 80 characters").into());
    }
    if !state.get("panes").is_some_and(Value::is_array) {
        return Err(tr("Trạng thái cửa sổ không hợp lệ", "The window state is not valid").into());
    }
    let id = match all.iter().find(|w| w.name == name) {
        Some(existing) => existing.id.clone(),
        None => format!("ws{}{}", now(), all.len()),
    };
    all.retain(|w| w.id != id);
    if all.len() >= MAX {
        return Err(tr("Đã có quá nhiều workspace", "There are too many workspaces").into());
    }
    let workspace = Workspace { id, name: name.to_owned(), created: now(), state };
    all.push(workspace.clone());
    Ok(workspace)
}

pub fn register(d: &mut Dispatcher) {
    d.on("workspaces.list", |_, _, _| serde_json::to_value(load(&path())).map_err(|e| e.to_string()));
    d.on("workspaces.save", |_, _, a| {
        #[derive(Deserialize)]
        struct Save {
            name: String,
            state: Value,
        }
        let a: Save = args(a)?;
        let mut all = load(&path());
        let workspace = put(&mut all, &a.name, a.state)?;
        save(&path(), &all)?;
        serde_json::to_value(workspace).map_err(|e| e.to_string())
    });
    d.on("workspaces.rename", |_, _, a| {
        #[derive(Deserialize)]
        struct Rename {
            id: String,
            name: String,
        }
        let a: Rename = args(a)?;
        let mut all = load(&path());
        let state = all.iter().find(|w| w.id == a.id).map(|w| w.state.clone()).ok_or_else(|| tr("Không có workspace này", "There is no such workspace").to_owned())?;
        all.retain(|w| w.id != a.id);
        put(&mut all, &a.name, state)?;
        save(&path(), &all)?;
        Ok(Value::Null)
    });
    d.on("workspaces.delete", |_, _, a| {
        #[derive(Deserialize)]
        struct Delete {
            id: String,
        }
        let id = args::<Delete>(a)?.id;
        let mut all = load(&path());
        all.retain(|w| w.id != id);
        save(&path(), &all)?;
        Ok(Value::Null)
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;
    use serde_json::json;

    #[test]
    fn save_then_load_roundtrips_layout() {
        let t = Temp::new("workspaces");
        let file = t.0.join("workspaces.json");
        let mut all = load(&file);
        let state = json!({ "layout": "h2", "panes": [{ "tabs": [{ "uri": "file:///a" }] }, { "tabs": [{ "uri": "file:///b" }] }] });
        put(&mut all, "Project", state.clone()).unwrap();
        put(&mut all, "Photos", json!({ "panes": [] })).unwrap();
        save(&file, &all).unwrap();
        let back = load(&file);
        assert_eq!(back.len(), 2);
        assert_eq!(back.iter().find(|w| w.name == "Project").unwrap().state, state);
    }

    #[test]
    fn a_name_saved_again_replaces_and_a_bad_state_is_refused() {
        let mut all = Vec::new();
        let first = put(&mut all, "Work", json!({ "panes": [1] })).unwrap();
        let again = put(&mut all, "Work", json!({ "panes": [2] })).unwrap();
        assert_eq!((all.len(), first.id, again.state["panes"][0].as_i64()), (1, again.id.clone(), Some(2)));
        assert!(put(&mut all, "  ", json!({ "panes": [] })).is_err());
        assert!(put(&mut all, "x", json!({ "layout": "h2" })).is_err());
    }
}
