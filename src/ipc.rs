//! The messages between the page and the app: the envelope, the dispatcher that routes a method to its handler, and
//! the handlers of the core methods (`app.*`, `settings.*`, `glass.*`, `panes.*`, `update.*`). A feature keeps its own
//! handlers in its own file and registers them with `Dispatcher::on`.

use crate::{App, Role, SurfaceOptions, native, tr, update};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::collections::{BTreeSet, HashMap};
use tao::window::WindowId;

pub type Handler = Box<dyn Fn(&mut App, WindowId, Value) -> Result<Value, String>>;

#[derive(Default)]
pub struct Dispatcher {
    exact: HashMap<&'static str, Handler>,
    starts: Vec<Box<dyn Fn(&mut App)>>,
}

impl Dispatcher {
    pub fn new() -> Dispatcher {
        Dispatcher::default()
    }

    /// Answers `method`, named `<area>.<verb>` in lower case, with `h`.
    pub fn on(&mut self, method: &'static str, h: impl Fn(&mut App, WindowId, Value) -> Result<Value, String> + 'static) {
        self.exact.insert(method, Box::new(h));
    }

    /// Runs `hook` once when the event loop starts, before the first window opens. The features that open a window of
    /// their own at launch use it.
    #[allow(dead_code)]
    pub fn on_start(&mut self, hook: impl Fn(&mut App) + 'static) {
        self.starts.push(Box::new(hook));
    }

    pub fn start(&self, app: &mut App) {
        for hook in &self.starts {
            hook(app);
        }
    }

    pub fn call(&self, app: &mut App, window: WindowId, method: &str, args: Value) -> Result<Value, String> {
        match self.exact.get(method) {
            Some(handler) => handler(app, window, args),
            None => Err(format!("{}: {method}", tr("Lệnh không rõ", "Unknown command"))),
        }
    }

    /// The areas that have a method, the part before the dot, in order; a test can tell that a feature registered.
    #[allow(dead_code)]
    pub fn areas(&self) -> Vec<&'static str> {
        let areas: BTreeSet<&str> = self.exact.keys().filter_map(|m| m.split_once('.').map(|(area, _)| area)).collect();
        areas.into_iter().collect()
    }

    /// Takes a message from a page, `{"id": 7, "method": "fs.list", "args": {..}}`, and answers it with
    /// `{"id": 7, "ok": true, "data": ..}` or `{"id": 7, "ok": false, "error": ".."}`. A message that is not JSON of that
    /// shape is dropped: there is no id to answer.
    pub fn handle(&self, app: &mut App, window: WindowId, body: &str) {
        #[derive(Deserialize)]
        struct Request {
            id: u64,
            method: String,
            #[serde(default)]
            args: Value,
        }
        let Ok(request) = serde_json::from_str::<Request>(body) else {
            eprintln!("ipc: dropped a message that is not a request");
            return;
        };
        let args = if request.args.is_null() { json!({}) } else { request.args };
        let reply = match self.call(app, window, &request.method, args) {
            Ok(data) => json!({ "id": request.id, "ok": true, "data": data }),
            Err(error) => json!({ "id": request.id, "ok": false, "error": error }),
        };
        app.post(window, reply);
    }
}

/// The arguments of a method as the type it expects; a missing field or one of the wrong type is an error to show.
pub fn args<T: DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|e| format!("{}: {e}", tr("Đối số không hợp lệ", "Invalid arguments")))
}

/// A page event, `{"event": name, "data": data}`.
pub fn event(name: &str, data: Value) -> Value {
    json!({ "event": name, "data": data })
}

pub fn register_core(d: &mut Dispatcher) {
    d.on("app.ready", |app, window, _| {
        app.page_ready(window);
        Ok(Value::Null)
    });
    // A script error of the page, written where the app's own errors go, since the page has no console in a release.
    d.on("app.log", |_, _, a| {
        #[derive(Deserialize)]
        struct Log {
            message: String,
        }
        eprintln!("page: {}", args::<Log>(a)?.message.chars().take(2000).collect::<String>());
        Ok(Value::Null)
    });
    d.on("app.drag", |app, window, _| {
        if let Some(surface) = app.surfaces.get(&window) {
            let _ = surface.window.drag_window();
        }
        Ok(Value::Null)
    });
    d.on("app.zoom", |app, window, _| {
        if let Some(surface) = app.surfaces.get(&window) {
            surface.window.set_maximized(!surface.window.is_maximized());
        }
        Ok(Value::Null)
    });
    d.on("app.new_window", |app, _, a| {
        #[derive(Deserialize)]
        struct NewWindow {
            uri: Option<String>,
        }
        let NewWindow { uri } = args(a)?;
        let id = app.open_surface(Role::Main, SurfaceOptions { uri, ..Default::default() });
        Ok(json!({ "window": id.0 }))
    });
    d.on("app.open_url", |_, _, a| {
        #[derive(Deserialize)]
        struct OpenUrl {
            url: String,
        }
        native::open_url(&args::<OpenUrl>(a)?.url)?;
        Ok(Value::Null)
    });
    d.on("settings.get", |app, _, _| serde_json::to_value(&app.settings).map_err(|e| e.to_string()));
    d.on("settings.set", |app, _, a| {
        #[derive(Deserialize)]
        struct SetSettings {
            patch: Value,
        }
        let patched = app.settings.patched(&args::<SetSettings>(a)?.patch)?;
        app.apply_settings(patched)?;
        serde_json::to_value(&app.settings).map_err(|e| e.to_string())
    });
    d.on("settings.choose_folder", |_, _, a| {
        #[derive(Deserialize)]
        struct ChooseFolder {
            #[serde(default)]
            prompt: String,
        }
        native::choose_folder(&args::<ChooseFolder>(a)?.prompt)
    });
    d.on("glass.panes", |app, window, a| {
        #[derive(Deserialize)]
        struct Panes {
            panes: Vec<[f64; 5]>,
        }
        let Panes { panes } = args(a)?;
        if let Some(surface) = app.surfaces.get(&window) {
            surface.glass.set_panes(&panes);
        }
        Ok(Value::Null)
    });
    d.on("panes.state", |app, window, a| {
        #[derive(Deserialize)]
        struct PanesState {
            state: Value,
        }
        app.save_layout(window, args::<PanesState>(a)?.state)?;
        Ok(Value::Null)
    });
    d.on("update.check", |app, _, a| {
        #[derive(Deserialize)]
        struct Check {
            #[serde(default)]
            manual: bool,
        }
        app.check_for_update(args::<Check>(a)?.manual);
        Ok(Value::Null)
    });
    d.on("update.install", |app, _, _| {
        app.install_update();
        Ok(Value::Null)
    });
    d.on("update.relaunch", |_, _, _| update::relaunch());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Proxy, settings::Settings};
    use std::{cell::Cell, rc::Rc};

    /// An app with no windows, whose files are in a folder of its own.
    fn app(name: &str) -> (App, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("lazyspace-test-ipc-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        (App::new(Settings::default(), dir.join("settings.json"), dir.join("layout.json"), Proxy::none()), dir)
    }

    fn window() -> WindowId {
        // SAFETY: the id is only used as a key that no window has.
        unsafe { WindowId::dummy() }
    }

    #[test]
    fn dispatcher_routes_by_exact_method_and_rejects_unknown() {
        let (mut app, dir) = app("route");
        let mut d = Dispatcher::new();
        d.on("test.echo", |_, _, a| Ok(a));
        d.on("test.fail", |_, _, _| Err("no".into()));
        d.on("other.one", |_, _, _| Ok(Value::Null));
        assert_eq!(d.call(&mut app, window(), "test.echo", json!({"x": 1})), Ok(json!({"x": 1})));
        assert_eq!(d.call(&mut app, window(), "test.fail", json!({})), Err("no".into()));
        assert!(d.call(&mut app, window(), "test", json!({})).is_err(), "a prefix is not a method");
        assert!(d.call(&mut app, window(), "test.echo.more", json!({})).is_err());
        assert!(d.call(&mut app, window(), "nothing.here", json!({})).unwrap_err().contains("nothing.here"));
        assert_eq!(d.areas(), ["other", "test"]);

        let started = Rc::new(Cell::new(0));
        let seen = started.clone();
        d.on_start(move |_| seen.set(seen.get() + 1));
        d.start(&mut app);
        assert_eq!(started.get(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn ipc_args_are_validated() {
        let (mut app, dir) = app("args");
        let mut d = Dispatcher::new();
        register_core(&mut d);
        let mut call = |method: &str, args: Value| d.call(&mut app, window(), method, args);
        assert!(call("app.open_url", json!({})).is_err(), "a missing field");
        assert!(call("app.open_url", json!({"url": 5})).is_err(), "the wrong type");
        assert!(call("app.open_url", json!({"url": "file:///etc/passwd"})).is_err(), "a scheme that is not the web's");
        assert!(call("glass.panes", json!({"panes": [[1, 2, 3]]})).is_err(), "a pane of three numbers");
        assert!(call("glass.panes", json!({"panes": [[1, 2, 3, 4, 5]]})).is_ok());
        assert!(call("panes.state", json!({"state": 7})).is_err(), "a state that is not an object");
        assert!(call("settings.set", json!({})).is_err(), "no patch");
        assert!(call("settings.set", json!({"patch": {"unknown_key": 1}})).is_err());
        assert!(call("settings.set", json!({"patch": {"theme": "sepia"}})).is_err());
        assert_eq!(call("settings.get", json!({})).unwrap()["language"], "vi");
        assert!(!dir.join("settings.json").exists(), "a refused change writes nothing");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_setting_is_saved_and_a_message_that_is_not_a_request_is_dropped() {
        let (mut app, dir) = app("save");
        let mut d = Dispatcher::new();
        register_core(&mut d);
        d.handle(&mut app, window(), "not json");
        d.handle(&mut app, window(), r#"{"method": "settings.get"}"#);
        d.handle(&mut app, window(), r#"{"id": 1, "method": "settings.set", "args": {"patch": {"show_hidden": true}}}"#);
        assert!(app.settings.show_hidden);
        let saved: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(saved["show_hidden"], true);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn panes_state_is_saved_as_the_layout() {
        let (mut app, dir) = app("layout");
        let mut d = Dispatcher::new();
        register_core(&mut d);
        d.call(&mut app, window(), "panes.state", json!({"state": {"layout": "h2", "panes": []}})).unwrap();
        let saved: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("layout.json")).unwrap()).unwrap();
        assert_eq!(saved["layout"], "h2");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
