//! LazySpace as the desktop (W9): a window under all others at the level of the desktop's icons, showing ~/Desktop as
//! icons on the wallpaper with everything the browser does with them. Icons stay where they are put: their cells are
//! kept by name in desktop.json, and a new item takes the first free cell down the columns from the top right, where
//! Finder puts them. Finder's own icons can be hidden while it is on, and come back when it is turned off.

use crate::{
    App, Role, SurfaceOptions, UserEvent,
    features::data_file,
    ipc::{Dispatcher, args, defer, event},
    native, tr,
    vfs::Uri,
};
use objc2_foundation::{NSNumber, NSString, NSUserDefaults};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path, process::Command};

/// A cell of the icon grid: the column counted from the right edge, and the row from the top.
pub type Cell = (u32, u32);

fn layout_path() -> std::path::PathBuf {
    data_file("desktop.json")
}

fn load(path: &Path) -> BTreeMap<String, Cell> {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(path: &Path, cells: &BTreeMap<String, Cell>) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_string(cells).map_err(|e| e.to_string())?).and_then(|()| std::fs::rename(&temp, path)).map_err(|e| e.to_string())
}

/// The cells down the columns from the top right of a grid `rows` high, then on to the left past its width.
fn free_cells(rows: u32) -> impl Iterator<Item = Cell> {
    let rows = rows.max(1);
    (0..).map(move |i: u32| (i / rows, i % rows))
}

/// The cells of `names` on a grid of `cols` by `rows`: a name keeps its cell while the cell is on the grid and not
/// taken, and the others take the first free cells. Only the names given are kept.
pub fn place(names: &[String], kept: &BTreeMap<String, Cell>, cols: u32, rows: u32) -> BTreeMap<String, Cell> {
    let mut out = BTreeMap::new();
    let mut taken = std::collections::HashSet::new();
    for name in names {
        if let Some(&cell) = kept.get(name) {
            if cell.0 < cols && cell.1 < rows && taken.insert(cell) {
                out.insert(name.clone(), cell);
            }
        }
    }
    let mut free = free_cells(rows).filter(|c| !taken.contains(c));
    for name in names {
        if !out.contains_key(name) {
            if let Some(cell) = free.next() {
                out.insert(name.clone(), cell);
            }
        }
    }
    out
}

/// Moves `names` to the cell `at` and the free cells after it, down its column and on to the left; the other icons
/// stay where they are.
pub fn move_to(names: &[String], at: Cell, cells: &mut BTreeMap<String, Cell>, rows: u32) {
    for name in names {
        cells.remove(name);
    }
    let taken: std::collections::HashSet<Cell> = cells.values().copied().collect();
    let rows = rows.max(1);
    let start = at.0 * rows + at.1.min(rows - 1);
    let mut free = (start..).map(|i| (i / rows, i % rows)).filter(|c| !taken.contains(c));
    for name in names {
        if let Some(cell) = free.next() {
            cells.insert(name.clone(), cell);
        }
    }
}

/// Whether Finder draws the icons of the desktop, which it does unless told not to.
pub fn finder_icons_shown() -> bool {
    NSUserDefaults::standardUserDefaults()
        .persistentDomainForName(&NSString::from_str("com.apple.finder"))
        .and_then(|d| d.objectForKey(&NSString::from_str("CreateDesktop")))
        .and_then(|v| v.downcast::<NSNumber>().ok())
        .is_none_or(|shown| shown.boolValue())
}

/// Shows or hides Finder's icons on the desktop: the setting Finder reads when it starts, then Finder started again
/// (the system restarts it at once; its windows come back). Only ever at the user's word, from the Settings switch.
fn show_finder_icons(on: bool) -> Result<(), String> {
    let written = Command::new("/usr/bin/defaults").args(["write", "com.apple.finder", "CreateDesktop", "-bool", if on { "true" } else { "false" }]).status().map_err(|e| e.to_string())?;
    if !written.success() {
        return Err(tr("Không đổi được cài đặt của Finder", "Finder's setting could not be changed").into());
    }
    Command::new("/usr/bin/killall").arg("Finder").status().map(drop).map_err(|e| e.to_string())
}

/// Opens the desktop window, or closes it.
fn show(app: &mut App, on: bool) {
    let open: Vec<_> = app.surfaces.values().filter(|s| s.role == Role::Desktop).map(|s| s.id).collect();
    if !on {
        for id in open {
            app.close_surface(id);
        }
    } else if open.is_empty() {
        let desktop = dirs::desktop_dir().map(|d| Uri::file(&d).to_string());
        app.open_surface(Role::Desktop, SurfaceOptions { uri: desktop, frame: None, transparent: true, always_on_top: false, decorations: false });
    }
}

/// The names of the items the desktop shows, in its order.
fn names_of(app: &App, view: &str) -> Result<Vec<String>, String> {
    app.views.shown_names(view).ok_or_else(|| tr("Tab đã đóng", "The tab is closed").to_owned())
}

pub fn register(d: &mut Dispatcher) {
    d.on_start(|app| {
        if app.settings.desktop.on {
            show(app, true);
        }
        let proxy = app.proxy.clone();
        native::panel::on_screens_changed(move || {
            proxy.send(UserEvent::Main(Box::new(|app: &mut App| {
                for surface in app.surfaces.values().filter(|s| s.role == Role::Desktop) {
                    native::panel::pin_to_desktop(&surface.window);
                }
                app.post_all(event("desktop.screens", Value::Null));
            })));
        });
    });
    d.on("desktop.state", |app, _, _| Ok(json!({ "on": app.settings.desktop.on, "hideFinderIcons": app.settings.desktop.hide_finder_icons, "finderIcons": finder_icons_shown() })));
    d.on("desktop.enable", |app, _, a| {
        #[derive(Deserialize)]
        struct Enable {
            on: bool,
            #[serde(rename = "hideFinderIcons")]
            hide_finder_icons: bool,
        }
        let a: Enable = args(a)?;
        // Finder's icons are hidden only while the desktop is on; turning it off brings them back.
        let hide = a.on && a.hide_finder_icons;
        let was_hidden = app.settings.desktop.on && app.settings.desktop.hide_finder_icons;
        let mut settings = app.settings.clone();
        settings.desktop.on = a.on;
        settings.desktop.hide_finder_icons = a.hide_finder_icons;
        app.apply_settings(settings)?;
        show(app, a.on);
        if hide != was_hidden {
            return defer(app, move || show_finder_icons(!hide).map(|()| Value::Null));
        }
        Ok(Value::Null)
    });
    d.on("desktop.place", |app, _, a| {
        #[derive(Deserialize)]
        struct Place {
            view: String,
            cols: u32,
            rows: u32,
        }
        let a: Place = args(a)?;
        let cells = place(&names_of(app, &a.view)?, &load(&layout_path()), a.cols, a.rows);
        save(&layout_path(), &cells)?;
        Ok(json!({ "cells": cells }))
    });
    d.on("desktop.move", |app, _, a| {
        #[derive(Deserialize)]
        struct Move {
            view: String,
            names: Vec<String>,
            col: u32,
            row: u32,
            cols: u32,
            rows: u32,
        }
        let a: Move = args(a)?;
        if a.names.len() > 10_000 || a.names.iter().any(|n| crate::vfs::valid_name(n).is_err()) {
            return Err(tr("Tên không hợp lệ", "Not a valid name").into());
        }
        let mut cells = place(&names_of(app, &a.view)?, &load(&layout_path()), a.cols, a.rows);
        // Items just copied in may not be listed yet; their cells are kept for when they are.
        move_to(&a.names, (a.col.min(a.cols.saturating_sub(1)), a.row), &mut cells, a.rows);
        save(&layout_path(), &cells)?;
        Ok(json!({ "cells": cells }))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn icon_grid_snaps_and_keeps_positions_by_name() {
        let first = place(&names(&["a", "b", "c"]), &BTreeMap::new(), 4, 2);
        assert_eq!(first, BTreeMap::from([("a".into(), (0, 0)), ("b".into(), (0, 1)), ("c".into(), (1, 0))]), "down the right column first");
        let mut cells = first.clone();
        move_to(&names(&["a"]), (3, 1), &mut cells, 2);
        assert_eq!(cells["a"], (3, 1));
        // A new item takes the cell "a" left, and the others stay.
        let again = place(&names(&["a", "b", "c", "new"]), &cells, 4, 2);
        assert_eq!((again["a"], again["b"], again["c"], again["new"]), ((3, 1), (0, 1), (1, 0), (0, 0)));
        // Two items moved onto taken cells go to the next free ones.
        move_to(&names(&["b", "c"]), (3, 1), &mut cells, 2);
        assert_eq!((cells["b"], cells["c"]), ((4, 0), (4, 1)), "past the taken cell, on to the left");
        // A smaller screen gives the cells off its grid back.
        let small = place(&names(&["a", "b", "c"]), &cells, 2, 2);
        assert_eq!(small, BTreeMap::from([("a".into(), (0, 0)), ("b".into(), (0, 1)), ("c".into(), (1, 0))]));
        let t = Temp::new("desktop-layout");
        let file = t.0.join("desktop.json");
        save(&file, &small).unwrap();
        assert_eq!(load(&file), small);
    }

    #[test]
    fn finder_icons_reading_agrees_with_defaults_and_changes_nothing() {
        let said = Command::new("/usr/bin/defaults").args(["read", "com.apple.finder", "CreateDesktop"]).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned());
        assert_eq!(finder_icons_shown(), said.is_none_or(|v| !matches!(v.as_str(), "0" | "false" | "NO")));
    }
}
