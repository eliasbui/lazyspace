//! LazySpace in place of Finder. "Show in LazySpace" from a window that has no panes of its own (the shelf, the
//! desktop) is sent here and on to a main window. What macOS sends the app comes the same way: once the global
//! `NSFileViewer` names LazySpace, another app's "Show in Finder" arrives as a kAEOpenDocuments event of the file itself
//! (seen with a probe app, the same event `open -a` sends), which tao gives as `Event::Opened`; a folder the app is
//! asked to open arrives the same way. A folder opens in a new tab; anything else opens its folder with it selected.
//! The Settings switch writes those two system settings, and reads them back rather than trusting itself.

use crate::{
    App, Role, SurfaceOptions, UserEvent,
    ipc::{Dispatcher, args, defer, event},
    native::workspace, tr, update,
    vfs::{Uri, local},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};

/// The bundle identifier of LazySpace (scripts/bundle-macos.sh).
pub const BUNDLE_ID: &str = "com.eliasbui.lazyspace";

/// A folder to show in a new tab, with the names to select in it (none for a folder opened as itself).
#[derive(Debug, PartialEq)]
pub struct Reveal {
    pub folder: PathBuf,
    pub names: Vec<String>,
}

/// What to show for the items macOS or a page asks for: a folder opens as itself, anything else (a file, an app, a
/// link) opens the folder that holds it with it selected, and the items of one folder share a tab. An item that is
/// gone is left out.
pub fn reveals(paths: &[PathBuf]) -> Vec<Reveal> {
    let mut out: Vec<Reveal> = Vec::new();
    for path in paths {
        let uri = Uri::file(path);
        let Ok(meta) = fs::symlink_metadata(&uri.path) else { continue };
        let parent = uri.parent();
        // The entry says what the list would show: a folder to browse into, or an item such as an app.
        let into = parent.as_ref().is_none_or(|p| local::entry(p, &uri.name(), Path::new(&uri.path), &meta).is_dir);
        match parent.filter(|_| !into) {
            None => out.push(Reveal { folder: PathBuf::from(&uri.path), names: Vec::new() }),
            Some(parent) => {
                let folder = PathBuf::from(&parent.path);
                match out.iter_mut().find(|r| r.folder == folder && !r.names.is_empty()) {
                    Some(reveal) if !reveal.names.contains(&uri.name()) => reveal.names.push(uri.name()),
                    Some(_) => {}
                    None => out.push(Reveal { folder, names: vec![uri.name()] }),
                }
            }
        }
    }
    out
}

/// Shows the items in the main window in front, which comes forward, or in a new one when there is none.
pub fn show(app: &mut App, paths: &[PathBuf]) {
    let messages: Vec<Value> = reveals(paths).iter().map(|r| event("viewer.show", json!({ "uri": Uri::file(&r.folder).to_string(), "names": r.names }))).collect();
    if messages.is_empty() {
        return;
    }
    if let Some(window) = app.menu_target() {
        for message in messages {
            app.post(window, message);
        }
        if let Some(surface) = app.surfaces.get(&window) {
            surface.window.set_visible(true);
            surface.window.set_minimized(false);
            surface.window.set_focus();
        }
        return;
    }
    // No main window yet (macOS may open the app with a folder before it has made its first): one is asked for, and
    // the items follow it once the event loop has made it, after this event. The page holds them until its panes are up.
    let asked = app.opening.iter().find(|(_, role, _)| *role == Role::Main).map(|(id, _, _)| *id);
    let id = asked.unwrap_or_else(|| app.open_surface(Role::Main, SurfaceOptions::default()));
    app.proxy.send(UserEvent::Main(Box::new(move |app: &mut App| {
        let Some(window) = app.surfaces.iter().find(|(_, s)| s.id == id).map(|(window, _)| *window) else { return };
        for message in messages {
            app.post(window, message);
        }
    })));
}

/// The places macOS asked the app to open (`Event::Opened`): a file reveal from another app, or a folder.
pub fn opened(app: &mut App, paths: Vec<PathBuf>) {
    show(app, &paths);
}

/// Whether LazySpace holds each of the two roles now, as the system says, and whether this copy can take them.
fn state() -> Value {
    let ours = |id: Option<String>| id.is_some_and(|id| id.eq_ignore_ascii_case(BUNDLE_ID));
    json!({ "fileViewer": ours(workspace::file_viewer()), "folders": ours(workspace::folder_app()), "available": update::app_path().is_some() })
}

/// Gives both roles to LazySpace at `app`, or back to Finder. Each is tried even when the other fails, so turning it
/// off gives back all it can.
fn set(on: bool, app: Option<&Path>) -> Result<(), String> {
    let viewer = workspace::set_file_viewer(on.then_some(BUNDLE_ID));
    let folders = workspace::set_folder_app(if on { app } else { None });
    viewer.and(folders)
}

pub fn register(d: &mut Dispatcher) {
    // "Open in LazySpace" in Finder's menus (src/native/services.rs).
    d.on_start(|app| crate::native::services::install(app.proxy.clone()));
    d.on("viewer.state", |_, _, _| Ok(state()));
    d.on("viewer.enable", |app, _, a| {
        #[derive(Deserialize)]
        struct Enable {
            on: bool,
        }
        let on = args::<Enable>(a)?.on;
        // macOS finds the app by its bundle, so a build run from the terminal cannot stand in for Finder.
        let bundle = update::app_path();
        if on && bundle.is_none() {
            return Err(tr("Chỉ bản LazySpace.app mới thay được Finder", "Only LazySpace.app can stand in for Finder").into());
        }
        let mut settings = app.settings.clone();
        settings.file_viewer = on;
        app.apply_settings(settings)?;
        defer(app, move || set(on, bundle.as_deref()).map(|()| state()))
    });
    d.on("viewer.reveal", |app, _, a| {
        #[derive(Deserialize)]
        struct Reveal {
            uris: Vec<String>,
        }
        let paths = args::<Reveal>(a)?
            .uris
            .iter()
            .map(|u| Uri::parse(u)?.local_path().ok_or_else(|| tr("Chỉ với tệp trên máy", "Only files on this Mac").to_owned()))
            .collect::<Result<Vec<_>, _>>()?;
        show(app, &paths);
        Ok(Value::Null)
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;

    #[test]
    fn a_folder_opens_as_itself_and_anything_else_opens_its_folder() {
        let t = Temp::new("viewer-reveals");
        let a = t.file("docs/a.txt", "a");
        let b = t.file("docs/b.txt", "b");
        let other = t.file("other/c.txt", "c");
        let app = t.0.join("docs/Tool.app");
        fs::create_dir_all(app.join("Contents")).unwrap();
        let docs = t.0.join("docs");
        let shown = reveals(&[a.clone(), docs.clone(), b, other, a, app, t.0.join("gone.txt")]);
        assert_eq!(
            shown,
            [
                Reveal { folder: docs.clone(), names: vec!["a.txt".into(), "b.txt".into(), "Tool.app".into()] },
                Reveal { folder: docs, names: vec![] },
                Reveal { folder: t.0.join("other"), names: vec!["c.txt".into()] },
            ],
            "the items of one folder share a tab, an app is selected rather than browsed into, a missing item is left out"
        );
        assert_eq!(reveals(&[PathBuf::from("/")]), [Reveal { folder: "/".into(), names: vec![] }], "the root has no folder above it");
    }

    #[test]
    fn the_bundle_declares_the_service_the_app_answers() {
        let script = include_str!("../../scripts/bundle-macos.sh");
        let source = include_str!("../native/services.rs");
        let message = source.split("#[unsafe(method(").nth(1).and_then(|m| m.split(':').next()).unwrap();
        assert!(script.contains(&format!("<key>NSMessage</key><string>{message}</string>")), "NSServices in scripts/bundle-macos.sh names another message than {message}");
        assert!(script.contains("<key>NSPortName</key><string>LazySpace</string>"));
    }

    #[test]
    fn the_state_reads_the_system_and_changes_nothing() {
        let said = std::process::Command::new("/usr/bin/defaults").args(["read", "-g", "NSFileViewer"]).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned());
        assert_eq!(workspace::file_viewer(), said.filter(|v| !v.is_empty()));
        let state = state();
        assert_eq!(state["fileViewer"], json!(workspace::file_viewer().is_some_and(|id| id.eq_ignore_ascii_case(BUNDLE_ID))));
        assert_eq!(state["available"], json!(false), "a test is not run from the app's bundle");
        assert!(workspace::folder_app().is_some(), "some app opens folders, Finder by default");
    }
}
