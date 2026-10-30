//! The context menu as data (design.md section 8.12). The page keeps the items of the core and of every feature and
//! sends those that fit the click as a tree of `MenuNode`; here the user's arrangement (`menu.json`: order, hidden
//! items, icons, separators) is applied before src/native/menu.rs shows it as a real NSMenu.

use crate::{settings, tr};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf};

/// How deep submenus may go, and how many items a menu may have.
const MAX_DEPTH: usize = 4;
const MAX_ITEMS: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MenuNode {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
    /// The name of an SF Symbol.
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub checked: bool,
    /// As the keymap writes it: "Cmd+Shift+N".
    #[serde(default)]
    pub shortcut: Option<String>,
    #[serde(default)]
    pub separator: bool,
    #[serde(default)]
    pub submenu: Vec<MenuNode>,
}

fn yes() -> bool {
    true
}

/// The user's arrangement of the menu, as the menu editor (W1) saves it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct MenuLayout {
    pub order: Vec<String>,
    pub hidden: Vec<String>,
    pub icons: HashMap<String, String>,
    pub separators: Vec<String>,
}

pub fn layout_path() -> PathBuf {
    settings::settings_path().with_file_name("menu.json")
}

/// The arrangement on disk, or none.
pub fn layout() -> MenuLayout {
    std::fs::read_to_string(layout_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// Refuses a tree too deep or too big to be a menu, so a page that went wrong cannot hang the app in AppKit.
pub fn check(nodes: &[MenuNode]) -> Result<(), String> {
    fn walk(nodes: &[MenuNode], depth: usize, count: &mut usize) -> Result<(), String> {
        if depth > MAX_DEPTH {
            return Err(tr("Menu lồng quá sâu", "The menu is nested too deep").into());
        }
        for node in nodes {
            *count += 1;
            if *count > MAX_ITEMS {
                return Err(tr("Menu có quá nhiều mục", "The menu has too many items").into());
            }
            walk(&node.submenu, depth + 1, count)?;
        }
        Ok(())
    }
    walk(nodes, 0, &mut 0)
}

/// The top level of the menu as the user arranged it: the ids in `order` first in that order, then the rest as they
/// came; hidden ids left out; icons replaced; a separator after each id in `separators`. Ids the arrangement does not
/// know (an item a newer feature added) stay, in their place among the rest.
pub fn apply_layout(nodes: Vec<MenuNode>, layout: &MenuLayout) -> Vec<MenuNode> {
    let mut nodes: Vec<MenuNode> = nodes.into_iter().filter(|n| n.separator || !layout.hidden.contains(&n.id)).collect();
    for node in &mut nodes {
        if let Some(icon) = layout.icons.get(&node.id) {
            node.icon = Some(icon.clone());
        }
    }
    if !layout.order.is_empty() {
        let rank = |n: &MenuNode| layout.order.iter().position(|id| *id == n.id).unwrap_or(usize::MAX);
        // Separators of the page go when the user has an order of their own; theirs come back from `separators`.
        nodes.retain(|n| !n.separator);
        nodes.sort_by_key(rank);
    }
    let mut out = Vec::with_capacity(nodes.len());
    for node in nodes {
        let id = node.id.clone();
        out.push(node);
        if layout.separators.contains(&id) {
            out.push(MenuNode { id: String::new(), label: String::new(), icon: None, enabled: true, checked: false, shortcut: None, separator: true, submenu: Vec::new() });
        }
    }
    tidy_separators(out)
}

/// No separator at either end and never two in a row.
fn tidy_separators(nodes: Vec<MenuNode>) -> Vec<MenuNode> {
    let mut out: Vec<MenuNode> = Vec::with_capacity(nodes.len());
    for node in nodes {
        if node.separator && out.last().is_none_or(|last| last.separator) {
            continue;
        }
        out.push(node);
    }
    while out.last().is_some_and(|n| n.separator) {
        out.pop();
    }
    out
}

/// A shortcut as AppKit shows it in a menu: the key equivalent and its modifiers (command, shift, option, control).
pub fn key_equivalent(shortcut: &str) -> Option<(String, [bool; 4])> {
    let mut mods = [false; 4];
    let mut key = None;
    for part in shortcut.split('+') {
        match part {
            "Cmd" => mods[0] = true,
            "Shift" => mods[1] = true,
            "Alt" => mods[2] = true,
            "Ctrl" => mods[3] = true,
            "Backspace" => key = Some("\u{8}".to_owned()),
            "Delete" => key = Some("\u{7f}".to_owned()),
            "Enter" => key = Some("\r".to_owned()),
            "Escape" => key = Some("\u{1b}".to_owned()),
            "Space" => key = Some(" ".to_owned()),
            "ArrowUp" => key = Some("\u{f700}".to_owned()),
            "ArrowDown" => key = Some("\u{f701}".to_owned()),
            "ArrowLeft" => key = Some("\u{f702}".to_owned()),
            "ArrowRight" => key = Some("\u{f703}".to_owned()),
            p if p.chars().count() == 1 => key = Some(p.to_lowercase()),
            p if p.len() > 1 && p.starts_with('F') && p[1..].parse::<u32>().is_ok_and(|n| (1..=12).contains(&n)) => {
                key = char::from_u32(0xf704 + p[1..].parse::<u32>().ok()? - 1).map(|c| c.to_string());
            }
            _ => return None,
        }
    }
    key.map(|k| (k, mods))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn node(id: &str) -> MenuNode {
        serde_json::from_value(json!({ "id": id, "label": id })).unwrap()
    }

    fn separator() -> MenuNode {
        serde_json::from_value(json!({ "separator": true })).unwrap()
    }

    fn ids(nodes: &[MenuNode]) -> Vec<String> {
        nodes.iter().map(|n| if n.separator { "-".into() } else { n.id.clone() }).collect()
    }

    #[test]
    fn layout_orders_hides_and_overrides_icons_but_keeps_unknown_ids() {
        let nodes = vec![node("open"), separator(), node("copy"), node("trash"), node("newer.feature"), node("info")];
        assert_eq!(ids(&apply_layout(nodes.clone(), &MenuLayout::default())), ["open", "-", "copy", "trash", "newer.feature", "info"]);
        let layout = MenuLayout {
            order: vec!["trash".into(), "open".into(), "info".into()],
            hidden: vec!["copy".into()],
            icons: HashMap::from([("open".into(), "folder".into())]),
            separators: vec!["trash".into(), "info".into()],
        };
        let out = apply_layout(nodes, &layout);
        assert_eq!(ids(&out), ["trash", "-", "open", "info", "-", "newer.feature"]);
        assert_eq!(out[2].icon.as_deref(), Some("folder"));
    }

    #[test]
    fn separators_never_double_or_end_a_menu() {
        let nodes = vec![separator(), node("a"), separator(), separator(), node("b"), separator()];
        assert_eq!(ids(&apply_layout(nodes, &MenuLayout::default())), ["a", "-", "b"]);
    }

    #[test]
    fn menu_nodes_reject_unknown_fields_and_too_deep_trees() {
        assert!(serde_json::from_value::<MenuNode>(json!({ "id": "a", "label": "A", "onclick": "x" })).is_err());
        let mut deep = node("leaf");
        for i in 0..6 {
            let mut parent = node(&format!("level{i}"));
            parent.submenu = vec![deep];
            deep = parent;
        }
        assert!(check(&[deep]).is_err());
        assert!(check(&vec![node("x"); MAX_ITEMS + 1]).is_err());
        assert!(check(&[node("ok")]).is_ok());
    }

    #[test]
    fn shortcuts_become_key_equivalents() {
        assert_eq!(key_equivalent("Cmd+Shift+N"), Some(("n".into(), [true, true, false, false])));
        assert_eq!(key_equivalent("Cmd+Backspace"), Some(("\u{8}".into(), [true, false, false, false])));
        assert_eq!(key_equivalent("F2").map(|k| k.0), Some("\u{f705}".into()));
        assert_eq!(key_equivalent("Cmd+Wobble"), None);
    }
}
