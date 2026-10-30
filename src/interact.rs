//! The methods of the hands-on parts of the window (design.md 8.2 to 8.4 and 8.12): dragging files out, Quick Look,
//! the native context menu, and text on the clipboard. Dropping files in comes through wry's drag-and-drop handler,
//! set up with each window in main.rs (`drop_handler`).

use crate::{
    App, UserEvent, browse, clipboard, contextmenu,
    contextmenu::MenuNode,
    ipc::{Dispatcher, args, event},
    native::{self, drag, menu, quicklook, workspace},
    tr,
};
use dispatch2::{DispatchQueue, MainThreadBound};
use objc2::MainThreadMarker;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    cell::Cell,
    path::PathBuf,
    time::{Duration, Instant},
};
use tao::window::WindowId;
use wry::DragDropEvent;

fn main_thread() -> Result<MainThreadMarker, String> {
    MainThreadMarker::new().ok_or_else(|| "not on the main thread".to_owned())
}

pub fn register(d: &mut Dispatcher) {
    d.on("drag.arm", |app, window, a| {
        let paths = local(browse::targets(app, window, &a)?)?;
        let surface = app.surfaces.get(&window).ok_or_else(|| tr("Cửa sổ đã đóng", "The window is closed").to_owned())?;
        drag::arm(main_thread()?, native::web_view(&surface.webview), paths);
        Ok(Value::Null)
    });
    d.on("drag.disarm", |_, _, _| {
        drag::disarm();
        Ok(Value::Null)
    });
    d.on("native.quicklook", |app, window, a| {
        #[derive(Deserialize)]
        struct Look {
            #[serde(default)]
            index: usize,
        }
        let index = args::<Look>(a.clone())?.index;
        let paths: Vec<PathBuf> = browse::targets(app, window, &a).unwrap_or_default().iter().filter_map(|u| crate::vfs::materialize(u).ok()).collect();
        let surface = app.surfaces.get(&window).ok_or_else(|| tr("Cửa sổ đã đóng", "The window is closed").to_owned())?;
        let ns_window = native::ns_window(&surface.window).ok_or_else(|| "no window".to_owned())?;
        quicklook::toggle(main_thread()?, ns_window, &paths, index);
        Ok(Value::Null)
    });
    d.on("menu.show", |app, window, a| {
        #[derive(Deserialize)]
        struct Show {
            items: Vec<MenuNode>,
            x: f64,
            y: f64,
            #[serde(default)]
            uris: Vec<String>,
        }
        let a: Show = args(a)?;
        contextmenu::check(&a.items)?;
        let nodes = contextmenu::apply_layout(a.items, &contextmenu::layout());
        let paths: Vec<PathBuf> = a.uris.iter().filter_map(|u| crate::vfs::Uri::parse(u).ok()?.local_path()).collect();
        let apps = has_open_with(&nodes).then(|| paths.first().map(|p| workspace::apps_for(p)).unwrap_or_default());
        let surface = app.surfaces.get(&window).ok_or_else(|| tr("Cửa sổ đã đóng", "The window is closed").to_owned())?;
        let mtm = main_thread()?;
        let view = MainThreadBound::new(native::web_view(&surface.webview), mtm);
        let proxy = app.proxy.clone();
        // The menu runs AppKit's own loop until it closes; it starts from the main queue, after this event.
        DispatchQueue::main().exec_async(move || {
            let Some(mtm) = MainThreadMarker::new() else { return };
            let view = view.into_inner(mtm);
            let chosen = menu::popup(mtm, &view, &nodes, a.x, a.y, apps.as_deref());
            let message = match chosen {
                Some(id) if id.starts_with(menu::OPEN_WITH) => {
                    if let Err(error) = workspace::open_with(&paths, std::path::Path::new(&id[menu::OPEN_WITH.len()..])) {
                        proxy.send(UserEvent::Post { window: Some(window), message: event("toast", json!(error)) });
                    }
                    event("menu.closed", Value::Null)
                }
                Some(id) => event("menu.chosen", json!({ "id": id })),
                None => event("menu.closed", Value::Null),
            };
            proxy.send(UserEvent::Post { window: Some(window), message });
        });
        Ok(Value::Null)
    });
    d.on("clipboard.text", |_, _, a| {
        #[derive(Deserialize)]
        struct Text {
            text: String,
        }
        clipboard::write_text(&args::<Text>(a)?.text);
        Ok(Value::Null)
    });
}

fn has_open_with(nodes: &[MenuNode]) -> bool {
    nodes.iter().any(|n| n.id == "openWith" || has_open_with(&n.submenu))
}

fn local(uris: Vec<crate::vfs::Uri>) -> Result<Vec<PathBuf>, String> {
    uris.iter().map(|u| u.local_path().ok_or_else(|| tr("Chỉ với tệp trên máy", "Only for files on this Mac").to_owned())).collect()
}

/// The handler of files dragged onto a window: it takes the drag only when it carries files, tells the page where the
/// pointer is (to light up the folder under it) and what was dropped where; anything else (text, a link, a picture
/// from a browser) goes on to WebKit as an HTML5 drop.
pub fn drop_handler(proxy: crate::Proxy, window: WindowId) -> impl Fn(DragDropEvent) -> bool + 'static {
    let files = Cell::new(false);
    let last = Cell::new(Instant::now());
    move |e: DragDropEvent| {
        let post = |message: Value| {
            proxy.send(UserEvent::Post { window: Some(window), message });
        };
        match e {
            DragDropEvent::Enter { paths, position } => {
                files.set(!paths.is_empty());
                if files.get() {
                    post(event("drop.over", json!({ "x": position.0, "y": position.1 })));
                }
                files.get()
            }
            DragDropEvent::Over { position } => {
                if files.get() && last.get().elapsed() >= Duration::from_millis(30) {
                    last.set(Instant::now());
                    post(event("drop.over", json!({ "x": position.0, "y": position.1 })));
                }
                files.get()
            }
            DragDropEvent::Drop { paths, position } => {
                let had = files.replace(false);
                if paths.is_empty() {
                    return had;
                }
                let flags = objc2_app_kit::NSEvent::modifierFlags_class();
                let mode = if flags.contains(objc2_app_kit::NSEventModifierFlags::Option) {
                    "copy"
                } else if flags.contains(objc2_app_kit::NSEventModifierFlags::Command) {
                    "move"
                } else {
                    "auto"
                };
                let paths: Vec<String> = paths.iter().map(|p| crate::vfs::Uri::file(p).to_string()).collect();
                post(event("drop", json!({ "x": position.0, "y": position.1, "uris": paths, "mode": mode })));
                true
            }
            DragDropEvent::Leave => {
                if files.replace(false) {
                    post(event("drop.leave", Value::Null));
                    return true;
                }
                false
            }
            _ => false,
        }
    }
}

/// Every window's drags end when it closes.
pub fn window_closed(app: &App, window: WindowId) {
    drag::disarm();
    if let Some(ns_window) = app.surfaces.get(&window).and_then(|s| native::ns_window(&s.window)) {
        quicklook::forget(ns_window);
    }
}
