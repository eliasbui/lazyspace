mod browse;
mod clipboard;
mod contextmenu;
mod features;
mod fswatch;
mod glass;
mod interact;
mod ipc;
mod jobs;
mod menus;
mod native;
mod protocol;
mod settings;
mod sizes;
mod update;
mod vfs;
mod views;

use ipc::{Dispatcher, event};
use serde_json::{Value, json};
use settings::Settings;
use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};
use tauri::{AppHandle, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const APP_NAME: &str = "LazySpace";
const WINDOW_ICON: &[u8] = include_bytes!("../../assets/icon-256.png");
/// The size of a main window that has no size saved, and the least it may be.
const MAIN_SIZE: (f64, f64) = (1100.0, 720.0);
const MAIN_MIN: (f64, f64) = (640.0, 420.0);
/// The size of the floating shelf.
const SHELF_SIZE: (f64, f64) = (264.0, 440.0);
/// The id of the icon in the menu bar.
const TRAY_ID: &str = "lazyspace-tray";
/// The prefix of the label of every window, which is followed by the id of its surface.
const LABEL: &str = "lz-";

/// Whether the app speaks English rather than Vietnamese in its own words: the menus and messages it makes. The page
/// keeps its own copy of its words (ui/index.html).
pub(crate) static ENGLISH: AtomicBool = AtomicBool::new(false);

/// `vi`, or `en` when the app speaks English.
pub(crate) fn tr<'a>(vi: &'a str, en: &'a str) -> &'a str {
    if ENGLISH.load(Ordering::Relaxed) { en } else { vi }
}

/// Whether a window opens without taking the keyboard from the app in front, for a run that is not looked at
/// (`LAZYSPACE_NO_FOCUS`, set by the smoke run).
pub(crate) fn no_focus() -> bool {
    std::env::var_os("LAZYSPACE_NO_FOCUS").is_some_and(|v| !v.is_empty())
}

/// Whether the windows open the classic page of earlier versions (`LAZYSPACE_CLASSIC=1`) instead of the new one, to compare.
pub(crate) fn classic() -> bool {
    std::env::var_os("LAZYSPACE_CLASSIC").is_some_and(|v| !v.is_empty())
}

/// The window of a page, as the app counts them. Tauri names a window by a label, `lz-<id>`; the id is the one of the
/// surface that holds it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct WindowId(pub u64);

impl WindowId {
    /// A key that no window has, for a test.
    #[cfg(test)]
    pub const fn dummy() -> WindowId {
        WindowId(0)
    }

    fn label(self) -> String {
        format!("{LABEL}{}", self.0)
    }

    fn of_label(label: &str) -> Option<WindowId> {
        label.strip_prefix(LABEL)?.parse().ok().map(WindowId)
    }
}

pub enum UserEvent {
    /// A message for the page of a window, or of every window when `window` is None.
    Post { window: Option<WindowId>, message: Value },
    /// An entry of the menu bar or of the icon in the menu bar.
    Menu(String),
    /// Work that needs the App, sent from another thread.
    Main(Box<dyn FnOnce(&mut App) + Send>),
}

/// Where other threads send events to the main one. It has nothing behind it in a unit test, where no event loop can
/// be made, and then sending does nothing.
#[derive(Clone)]
pub struct Proxy(Option<AppHandle>);

impl Proxy {
    pub fn none() -> Proxy {
        Proxy(None)
    }

    /// Whether the event reached the loop.
    pub fn send(&self, event: UserEvent) -> bool {
        self.0.as_ref().is_some_and(|handle| handle.run_on_main_thread(move || with_host(move |host| host.app.event(event))).is_ok())
    }
}

/// The App and the dispatcher of its methods. Neither can leave the main thread, where every handler runs, so they live
/// in a thread-local there and everything else reaches them with `with_host`.
struct Host {
    app: App,
    dispatcher: Dispatcher,
}

thread_local! {
    static HOST: RefCell<Option<Host>> = const { RefCell::new(None) };
    /// What was asked for while a handler held the host, which runs once it lets go.
    static LATER: RefCell<VecDeque<Box<dyn FnOnce(&mut Host)>>> = const { RefCell::new(VecDeque::new()) };
}

/// Runs `f` with the host, then does what the windows asked for. A call that arrives while the host is in use (a window
/// made inside a handler can raise an event of its own at once) waits for the first to end.
fn with_host(f: impl FnOnce(&mut Host) + 'static) {
    let busy = HOST.with(|host| host.try_borrow_mut().is_err());
    if busy {
        LATER.with(|later| later.borrow_mut().push_back(Box::new(f)));
        return;
    }
    HOST.with(|cell| {
        let mut cell = cell.borrow_mut();
        let Some(host) = cell.as_mut() else { return };
        f(host);
        host.app.flush_surfaces();
        while let Some(next) = LATER.with(|later| later.borrow_mut().pop_front()) {
            next(host);
            host.app.flush_surfaces();
        }
    });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SurfaceId(pub u64);

impl SurfaceId {
    fn window(self) -> WindowId {
        WindowId(self.0)
    }
}

/// What a window is for: the file manager itself, the desktop under the other windows, or the floating shelf.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Main,
    Desktop,
    Shelf,
}

impl Role {
    fn name(self) -> &'static str {
        match self {
            Role::Main => "main",
            Role::Desktop => "desktop",
            Role::Shelf => "shelf",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SurfaceOptions {
    /// The place the page opens, passed to it in `app.hello`.
    pub uri: Option<String>,
    /// `[x, y, width, height]` in points, or None for the place and size the app chooses.
    pub frame: Option<[f64; 4]>,
    pub transparent: bool,
    pub always_on_top: bool,
    pub decorations: bool,
}

impl Default for SurfaceOptions {
    fn default() -> Self {
        SurfaceOptions { uri: None, frame: None, transparent: false, always_on_top: false, decorations: true }
    }
}

/// A window with its page.
pub struct Surface {
    pub window: WebviewWindow,
    pub id: SurfaceId,
    pub role: Role,
    pub options: SurfaceOptions,
    /// Whether the page has said `app.ready`; what is posted before waits in `queued`.
    ready: bool,
    queued: Vec<Value>,
    /// A main window is made hidden and shows once its page has drawn its first frame (`app.drawn`), so it never
    /// shows half drawn.
    hidden_until_drawn: bool,
}

impl Surface {
    fn send(&self, message: &Value) {
        let _ = self.window.eval(format!("window.app && app.receive({message})"));
    }

    /// Shows the window, out of the Dock if it was minimized there, and in front.
    pub fn bring_forward(&self) {
        let _ = self.window.show();
        let _ = self.window.unminimize();
        if !no_focus() {
            let _ = self.window.set_focus();
        }
    }
}

pub struct App {
    pub settings: Settings,
    pub proxy: Proxy,
    pub surfaces: HashMap<WindowId, Surface>,
    /// The listing of every tab (src/views.rs).
    pub views: views::Views,
    /// The long operations that run (src/jobs.rs).
    pub jobs: jobs::Jobs,
    /// The rest of the core browser: the watcher, the cut, the undo list, the folder sizes (src/browse.rs).
    pub browse: browse::State,
    settings_path: PathBuf,
    layout_path: PathBuf,
    /// Windows asked for and not made yet, and windows asked to close: they are done after each event, as they were
    /// when the event loop was the app's own (`open_surface`).
    pub(crate) opening: Vec<(SurfaceId, Role, SurfaceOptions)>,
    closing: Vec<SurfaceId>,
    next_surface: u64,
    focused: Option<WindowId>,
    menu_bar: Option<menus::MenuBar>,
    update_checked: bool,
    /// The window and id of the request being handled, for `ipc::defer` to answer it later.
    request: Option<(WindowId, u64)>,
    /// Whether the icon in the menu bar is up while the app keeps running in the background (Settings `background`).
    tray: bool,
}

impl App {
    pub fn new(settings: Settings, settings_path: PathBuf, layout_path: PathBuf, proxy: Proxy) -> App {
        App {
            settings,
            browse: browse::State::new(proxy.clone()),
            proxy,
            surfaces: HashMap::new(),
            views: views::Views::default(),
            jobs: jobs::Jobs::default(),
            settings_path,
            layout_path,
            opening: Vec::new(),
            closing: Vec::new(),
            next_surface: 1,
            focused: None,
            menu_bar: None,
            update_checked: false,
            request: None,
            tray: false,
        }
    }

    /// What reached the main thread from another one.
    fn event(&mut self, event: UserEvent) {
        match event {
            UserEvent::Post { window: Some(window), message } => self.post(window, message),
            UserEvent::Post { window: None, message } => self.post_all(message),
            UserEvent::Menu(id) => self.menu(&id),
            UserEvent::Main(work) => work(self),
        }
    }

    fn handle(&self) -> Option<&AppHandle> {
        self.proxy.0.as_ref()
    }

    /// Asks for a window. It is made after the event being handled, by `flush_surfaces`.
    pub fn open_surface(&mut self, role: Role, options: SurfaceOptions) -> SurfaceId {
        let id = SurfaceId(self.next_surface);
        self.next_surface += 1;
        self.opening.push((id, role, options));
        id
    }

    /// Asks for a window to close, which `flush_surfaces` does after the event being handled. Closing the last main
    /// window does not quit the app.
    pub fn close_surface(&mut self, id: SurfaceId) {
        self.closing.push(id);
    }

    /// Does what `open_surface` and `close_surface` queued: the closes first, then the opens.
    fn flush_surfaces(&mut self) {
        for id in std::mem::take(&mut self.closing) {
            self.remove_surface(id);
        }
        for (id, role, options) in std::mem::take(&mut self.opening) {
            if let Err(e) = self.create_surface(id, role, options) {
                eprintln!("window: {e}");
            }
        }
    }

    fn create_surface(&mut self, id: SurfaceId, role: Role, options: SurfaceOptions) -> Result<(), String> {
        let handle = self.handle().ok_or("no app")?.clone();
        let saved = settings::load_layout(&self.layout_path);
        let saved_size = match (saved["window"]["width"].as_f64(), saved["window"]["height"].as_f64()) {
            (Some(w), Some(h)) if role == Role::Main => Some((w.clamp(MAIN_MIN.0, 10000.0), h.clamp(MAIN_MIN.1, 10000.0))),
            _ => None,
        };
        // The shelf sits on the right of the main screen, a little below its top, unless told where.
        let options = if role == Role::Shelf && options.frame.is_none() {
            let frame = handle.primary_monitor().ok().flatten().map(|m| {
                let size = m.size().to_logical::<f64>(m.scale_factor());
                [size.width - SHELF_SIZE.0 - 16.0, 90.0, SHELF_SIZE.0, SHELF_SIZE.1]
            });
            SurfaceOptions { frame, ..options }
        } else {
            options
        };
        let (width, height) = options.frame.map(|f| (f[2], f[3])).or(saved_size).unwrap_or(MAIN_SIZE);
        let glass = self.settings.glass && role == Role::Main;
        let transparent = options.transparent || glass;
        let window_id = id.window();
        let mut builder = WebviewWindowBuilder::new(&handle, window_id.label(), WebviewUrl::App(if classic() { "classic.html" } else { "index.html" }.into()))
            .title(APP_NAME)
            .inner_size(width, height)
            .theme(self.window_theme())
            .transparent(transparent)
            .always_on_top(options.always_on_top)
            .visible_on_all_workspaces(role != Role::Main)
            .visible(role != Role::Main)
            .focused(role == Role::Main && !no_focus())
            .decorations(options.decorations)
            .initialization_script(compat_script(&self.settings))
            .on_navigation(|url| {
                let allowed = allow_navigation(url.as_str());
                if ipc::trace() {
                    eprintln!("navigation: {url} {}", if allowed { "allowed" } else { "refused" });
                }
                allowed
            })
            .on_page_load(|window, payload| {
                if ipc::trace() {
                    eprintln!("page: {} {:?} {}", window.label(), payload.event(), payload.url());
                }
            })
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
        if let Some([x, y, ..]) = options.frame {
            builder = builder.position(x, y);
        }
        if role == Role::Main {
            builder = builder.min_inner_size(MAIN_MIN.0, MAIN_MIN.1);
        }
        // The page runs up under a see-through title bar, so its sidebar holds the window's buttons as Finder's does,
        // and its toolbar moves the window (ipc `app.drag`).
        if options.decorations {
            builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true).traffic_light_position(tauri::LogicalPosition::new(20.0, 20.0));
        }
        let window = builder.build().map_err(|e| e.to_string())?;
        if ipc::trace() {
            eprintln!("window: {} made as {}", window.label(), role.name());
        }
        watch_window(&window, window_id);
        interact::watch_drops(&window, self.proxy.clone(), window_id);
        if glass {
            glass::attach(&window);
        }
        if role == Role::Desktop {
            native::panel::pin_to_desktop(&window);
        }
        self.surfaces.insert(window_id, Surface { window, id, role, options, ready: false, queued: Vec::new(), hidden_until_drawn: role == Role::Main });
        self.focused = Some(window_id);
        if role == Role::Main {
            // A page that never says it has drawn (a script error) must not leave its window hidden for good.
            let proxy = self.proxy.clone();
            thread::spawn(move || {
                thread::sleep(std::time::Duration::from_secs(3));
                proxy.send(UserEvent::Main(Box::new(move |app| app.page_drawn(window_id))));
            });
        }
        Ok(())
    }

    /// The page of a main window has drawn its first frame: the window shows, in front.
    pub fn page_drawn(&mut self, window: WindowId) {
        let Some(surface) = self.surfaces.get_mut(&window).filter(|s| s.hidden_until_drawn) else { return };
        surface.hidden_until_drawn = false;
        surface.bring_forward();
        set_in_dock(true);
    }

    /// The icon in the menu bar is there while the app keeps running in the background, made again in a new language.
    fn sync_tray(&mut self, remake: bool) {
        let Some(handle) = self.handle().cloned() else { return };
        if self.tray && (remake || !self.settings.background) {
            let _ = handle.remove_tray_by_id(TRAY_ID);
            self.tray = false;
        }
        if self.settings.background && !self.tray {
            self.tray = menus::tray(&handle, TRAY_ID, WINDOW_ICON);
        }
    }

    /// Quit or the last window closed while the app runs in the background: the windows hide, their pages and tabs
    /// kept, and the app leaves the Dock for its icon in the menu bar.
    fn hide_all(&mut self) {
        for surface in self.surfaces.values().filter(|s| s.role != Role::Desktop) {
            let _ = surface.window.hide();
        }
        set_in_dock(false);
    }

    /// Closes the window `id`, or hides every window when it is the last main one shown and the app runs in the
    /// background.
    fn close_or_hide(&mut self, id: SurfaceId) {
        let shown_main = self.surfaces.values().filter(|s| s.role == Role::Main && s.window.is_visible().unwrap_or(false)).count();
        let is_main = self.surfaces.values().any(|s| s.id == id && s.role == Role::Main);
        if self.settings.background && is_main && shown_main <= 1 {
            self.hide_all();
        } else {
            self.close_surface(id);
        }
    }

    fn remove_surface(&mut self, id: SurfaceId) {
        let key = id.window();
        if !self.surfaces.contains_key(&key) {
            return;
        }
        interact::window_closed(self, key);
        if self.focused == Some(key) {
            self.focused = None;
        }
        if let Some(surface) = self.surfaces.remove(&key) {
            if surface.role == Role::Main {
                self.remember_size(&surface);
            }
            let _ = surface.window.destroy();
        }
        self.views.close_window(key);
    }

    /// A window the user closed: the same as `close_surface`, from the window's id.
    fn close_requested(&mut self, window: WindowId) {
        if let Some(id) = self.surfaces.get(&window).map(|s| s.id) {
            self.close_or_hide(id);
        }
    }

    /// The Dock icon was clicked while no window showed: brings a main window back, or makes one.
    fn reopen(&mut self) {
        let mains: Vec<&Surface> = self.surfaces.values().filter(|s| s.role == Role::Main && !s.hidden_until_drawn).collect();
        if !mains.is_empty() {
            set_in_dock(true);
            // The shelf hidden with the main windows comes back with them.
            for surface in self.surfaces.values().filter(|s| s.role == Role::Shelf) {
                let _ = surface.window.show();
            }
            for surface in mains {
                surface.bring_forward();
            }
        } else if !self.opening.iter().any(|(_, role, _)| *role == Role::Main) {
            self.open_surface(Role::Main, SurfaceOptions::default());
        }
    }

    /// The main window that gets what the menu bar does: the one in front, else the oldest.
    pub(crate) fn menu_target(&self) -> Option<WindowId> {
        let main = |window: &WindowId| self.surfaces.get(window).is_some_and(|s| s.role == Role::Main);
        self.focused.filter(main).or_else(|| self.surfaces.iter().filter(|(_, s)| s.role == Role::Main).min_by_key(|(_, s)| s.id.0).map(|(window, _)| *window))
    }

    /// Posts to the page of a window: at once when the page has said it is ready, else after its `app.ready`.
    pub fn post(&mut self, window: WindowId, message: Value) {
        let Some(surface) = self.surfaces.get_mut(&window) else { return };
        if surface.ready {
            surface.send(&message);
        } else {
            surface.queued.push(message);
        }
    }

    pub fn post_all(&mut self, message: Value) {
        let windows: Vec<WindowId> = self.surfaces.keys().copied().collect();
        for window in windows {
            self.post(window, message.clone());
        }
    }

    /// The page of a window is ready: it is told what it needs to draw itself, then gets what waited for it.
    pub fn page_ready(&mut self, window: WindowId) {
        let Some(surface) = self.surfaces.get_mut(&window) else { return };
        surface.ready = true;
        let queued = std::mem::take(&mut surface.queued);
        let hello = event(
            "app.hello",
            json!({
                "version": update::CURRENT,
                "theme": theme_name(surface.window.theme().unwrap_or(Theme::Light)),
                "settings": &self.settings,
                "features": [],
                "windowRole": surface.role.name(),
                "windowId": surface.id.0,
                "uri": surface.options.uri,
                "layout": settings::load_layout(&self.layout_path),
                "accessibility": native::accessibility(),
                "glassAvailable": glass::available(),
            }),
        );
        surface.send(&hello);
        for message in queued {
            surface.send(&message);
        }
        if self.settings.check_updates && !self.update_checked {
            self.check_for_update(false);
        }
    }

    /// The window's own light or dark, for what the page does not draw: the window's buttons, the system's menus.
    fn window_theme(&self) -> Option<Theme> {
        match self.settings.theme.as_str() {
            "light" => Some(Theme::Light),
            "dark" => Some(Theme::Dark),
            _ => None,
        }
    }

    /// Takes new settings in: saves them, then does what the changed ones ask for.
    pub fn apply_settings(&mut self, new: Settings) -> Result<(), String> {
        new.save(&self.settings_path)?;
        let old = std::mem::replace(&mut self.settings, new);
        if old.language != self.settings.language {
            ENGLISH.store(self.settings.language == "en", Ordering::Relaxed);
            self.menu_bar = self.handle().and_then(menus::menu_bar);
            if let (Some(bar), Some(handle)) = (&self.menu_bar, self.handle()) {
                bar.install(handle);
            }
        }
        if old.background != self.settings.background || old.language != self.settings.language {
            self.sync_tray(old.language != self.settings.language);
        }
        if old.theme != self.settings.theme {
            for surface in self.surfaces.values() {
                let _ = surface.window.set_theme(self.window_theme());
            }
        }
        // A window cannot become see-through after it is made, so the main windows are made again; each page comes
        // back from layout.json.
        if old.glass != self.settings.glass {
            let mut main: Vec<(SurfaceId, SurfaceOptions)> = self.surfaces.values().filter(|s| s.role == Role::Main).map(|s| (s.id, s.options.clone())).collect();
            main.sort_by_key(|(id, _)| id.0);
            for (id, options) in main {
                self.close_surface(id);
                self.open_surface(Role::Main, options);
            }
        }
        let settings = serde_json::to_value(&self.settings).map_err(|e| e.to_string())?;
        self.post_all(event("settings.changed", settings));
        Ok(())
    }

    /// The layout the page of `window` reports, saved as `layout.json` with the size of the window.
    pub fn save_layout(&self, window: WindowId, mut state: Value) -> Result<(), String> {
        // Only a main window's layout is the one the next main window comes back to.
        if self.surfaces.get(&window).is_some_and(|s| s.role != Role::Main) {
            return Ok(());
        }
        let map = state.as_object_mut().ok_or(tr("Bố cục phải là một đối tượng", "The layout must be an object"))?;
        if let Some(surface) = self.surfaces.get(&window) {
            map.insert("window".into(), size_of(&surface.window));
        }
        settings::save_layout(&self.layout_path, &state)
    }

    /// The size of a main window that closes, kept in `layout.json` for the next one.
    fn remember_size(&self, surface: &Surface) {
        let mut layout = settings::load_layout(&self.layout_path);
        if !layout.is_object() {
            layout = json!({});
        }
        layout["window"] = size_of(&surface.window);
        if let Err(e) = settings::save_layout(&self.layout_path, &layout) {
            eprintln!("layout: {e}");
        }
    }

    /// An entry of the menu bar. Quit is handled by `quit`.
    fn menu(&mut self, id: &str) {
        match id {
            menus::QUIT if self.settings.background => self.hide_all(),
            menus::QUIT | menus::TRAY_QUIT => {
                if let Some(handle) = self.handle() {
                    handle.exit(0);
                }
            }
            menus::NEW_WINDOW => {
                self.open_surface(Role::Main, SurfaceOptions::default());
            }
            menus::CLOSE_WINDOW => {
                // The desktop goes away only when it is turned off in Settings.
                if let Some(id) = self.focused.and_then(|w| self.surfaces.get(&w)).filter(|s| s.role != Role::Desktop).map(|s| s.id) {
                    self.close_or_hide(id);
                }
            }
            menus::TRAY_SHOW => self.reopen(),
            menus::HOME_PAGE => drop(native::open_url(&format!("https://github.com/{}", update::REPO))),
            menus::REPORT => drop(native::open_url(&format!("https://github.com/{}/issues", update::REPO))),
            other => {
                if let Some(window) = self.menu_target() {
                    self.post(window, event("menu.action", json!({ "id": other })));
                }
            }
        }
    }

    /// Looks for a newer version in the background and tells every page of it; a check the user asked for also says
    /// when there is none, or why it failed.
    pub fn check_for_update(&mut self, manual: bool) {
        self.update_checked = true;
        let proxy = self.proxy.clone();
        thread::spawn(move || {
            if let Some(app) = update::app_path() {
                update::tidy(&app);
            }
            let message = match update::check() {
                Ok(check) if check.newer => event("update.available", json!({ "current": check.current, "latest": check.latest, "notes": check.notes, "installable": check.installable, "url": check.url })),
                Ok(check) if manual => event("update.none", json!({ "current": check.current })),
                Err(error) if manual => event("update.error", json!({ "error": error })),
                _ => return,
            };
            proxy.send(UserEvent::Post { window: None, message });
        });
    }

    pub fn install_update(&self) {
        let proxy = self.proxy.clone();
        thread::spawn(move || {
            let run = || -> Result<(), String> {
                let app = update::installed().ok_or(tr("Bản này không tự cập nhật được, hãy tải từ trang phát hành", "This copy cannot update itself, download it from the releases page"))?;
                let check = update::check()?;
                update::install(&check, &app, |percent| {
                    proxy.send(UserEvent::Post { window: None, message: event("update.progress", json!(percent)) });
                })
            };
            let message = match run() {
                Ok(()) => event("update.ready", Value::Null),
                Err(error) => event("update.error", json!({ "error": error })),
            };
            proxy.send(UserEvent::Post { window: None, message });
        });
    }
}

/// What a window tells the app: it is asked to close, comes to the front, or the system's light or dark changes.
fn watch_window(window: &WebviewWindow, id: WindowId) {
    window.on_window_event(move |e| match e {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            with_host(move |host| host.app.close_requested(id));
        }
        WindowEvent::Focused(true) => with_host(move |host| host.app.focused = Some(id)),
        WindowEvent::ThemeChanged(theme) => {
            let theme = *theme;
            with_host(move |host| host.app.post_all(ipc::event("theme.changed", json!({ "theme": theme_name(theme) }))));
        }
        _ => {}
    });
}

/// The one command the page calls: the text `window.ipc.postMessage` was given, a request for the dispatcher. It is
/// synchronous, so Tauri runs it on the main thread, where the App is; the answer goes back as an event of the page
/// (`Surface::send`), as it did when the page had a web view of its own.
#[tauri::command]
fn ipc(window: WebviewWindow, body: String) {
    let Some(id) = WindowId::of_label(window.label()) else { return };
    with_host(move |host| host.dispatcher.handle(&mut host.app, id, &body));
}

/// The folders and files macOS asked the app to open before the first window was made.
fn early() -> &'static Mutex<Option<Vec<PathBuf>>> {
    static EARLY: Mutex<Option<Vec<PathBuf>>> = Mutex::new(Some(Vec::new()));
    &EARLY
}

fn opened(urls: Vec<tauri::Url>) {
    let paths: Vec<PathBuf> = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
    // What macOS sends as the app starts (AppKit sends `application:openURLs:` ahead of `applicationDidFinishLaunching:`)
    // waits for the first main window; later it is shown at once.
    if let Ok(mut waiting) = early().lock() {
        if let Some(waiting) = waiting.as_mut() {
            waiting.extend(paths);
            return;
        }
    }
    with_host(move |host| features::viewer::opened(&mut host.app, paths));
}

fn main() {
    let settings_path = settings::settings_path();
    let settings = Settings::load(&settings_path);
    ENGLISH.store(settings.language == "en", Ordering::Relaxed);
    if !settings_path.exists() {
        if let Err(e) = settings.save(&settings_path) {
            eprintln!("settings: {e}");
        }
    }
    thread::spawn(vfs::tidy_cache);

    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ipc])
        .register_asynchronous_uri_scheme_protocol(protocol::SCHEME, |_, request, responder| protocol::handle(request, responder))
        .on_menu_event(|handle, e| {
            let id = e.id().as_ref().to_owned();
            // A menu entry is handled on the main thread, where the App is.
            let _ = handle.run_on_main_thread(move || with_host(move |host| host.app.event(UserEvent::Menu(id))));
        })
        .setup(move |tauri_app| {
            let handle = tauri_app.handle().clone();
            let mut dispatcher = Dispatcher::new();
            ipc::register_core(&mut dispatcher);
            let proxy = Proxy(Some(handle.clone()));
            browse::register(&mut dispatcher);
            interact::register(&mut dispatcher);
            features::register(&mut dispatcher);
            let mut app = App::new(settings, settings_path, settings::layout_path(), proxy);
            app.menu_bar = menus::menu_bar(&handle);
            if no_focus() {
                // An app that is not in the Dock takes no focus when its window shows.
                set_in_dock(false);
            }
            HOST.with(|host| *host.borrow_mut() = Some(Host { app, dispatcher }));
            with_host(move |host| {
                if let Some(bar) = &host.app.menu_bar {
                    bar.install(&handle);
                }
                host.dispatcher.start(&mut host.app);
                host.app.sync_tray(false);
                host.app.open_surface(Role::Main, SurfaceOptions::default());
                let waiting = early().lock().ok().and_then(|mut waiting| waiting.take());
                if let Some(paths) = waiting.filter(|p| !p.is_empty()) {
                    features::viewer::opened(&mut host.app, paths);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the app");

    app.run(|_, event| match event {
        // The last window closing does not end the app: a new one opens from the Dock icon, or the icon in the menu bar
        // stays. Quitting has a code.
        tauri::RunEvent::ExitRequested { code, api, .. } => {
            if code.is_none() {
                api.prevent_exit();
            }
        }
        // The Dock icon was clicked while no window showed.
        tauri::RunEvent::Reopen { has_visible_windows: false, .. } => with_host(|host| host.app.reopen()),
        // A folder or a file to show, sent by macOS once LazySpace stands in for Finder (src/features/viewer.rs).
        tauri::RunEvent::Opened { urls } => opened(urls),
        _ => {}
    });
}

/// The look of the settings and the bridge to the host, on the page before its own scripts run: the language, the light
/// or dark and the glass on its root, so its first frame is already drawn in them, and `window.lazyHost.postMessage`,
/// which hands a request to the app's one command (build.rs points the page's `window.ipc.postMessage` at it).
fn compat_script(settings: &Settings) -> String {
    let attributes = json!({
        "lang": settings.language,
        "data-theme": settings.theme,
        "data-accent": settings.accent,
        "data-sidebar-icons": settings.sidebar_icons,
        "data-icon-size": settings.icon_size,
        "data-text-size": settings.text_size,
    });
    let glass = if settings.glass { "root.setAttribute('data-glass', '');" } else { "" };
    // The root may not exist yet when this runs; the look is put on it the moment it does, before the first frame.
    format!(
        "window.lazyHost = {{ postMessage: (body) => window.__TAURI_INTERNALS__.invoke('ipc', {{ body }}).catch(() => {{}}) }};
(() => {{
  const look = () => {{
    const root = document.documentElement;
    for (const [name, value] of Object.entries({attributes})) root.setAttribute(name, String(value));
    {glass}
  }};
  if (document.documentElement) look();
  else new MutationObserver((_, watcher) => {{ if (document.documentElement) {{ watcher.disconnect(); look(); }} }}).observe(document, {{ childList: true }});
}})();"
    )
}

/// The app in the Dock and the app switcher with its menu bar, or only as its icon in the menu bar while its windows
/// are hidden.
fn set_in_dock(shown: bool) {
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
    let Some(mtm) = objc2::MainThreadMarker::new() else { return };
    // A run that must not take the focus stays out of the Dock.
    let shown = shown && !no_focus();
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(if shown { NSApplicationActivationPolicy::Regular } else { NSApplicationActivationPolicy::Accessory });
    if shown {
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
    }
}

/// The page is the only place a window goes: a link to the web opens in the browser, anything else is refused. The page is
/// the app's own (`tauri://localhost`), or in a debug build the Vite server of the front end.
fn allow_navigation(url: &str) -> bool {
    let own = |base: &str| url.strip_prefix(base).is_some_and(|rest| rest.is_empty() || rest.starts_with(['/', '?', '#']));
    if url == "about:blank" || own("tauri://localhost") || (cfg!(debug_assertions) && own("http://localhost:1432")) {
        return true;
    }
    let _ = native::open_url(url);
    false
}

fn theme_name(theme: Theme) -> &'static str {
    if theme == Theme::Light { "light" } else { "dark" }
}

/// The size of a window in points, as `layout.json` keeps it.
fn size_of(window: &WebviewWindow) -> Value {
    let size = window.inner_size().map(|s| s.to_logical::<f64>(window.scale_factor().unwrap_or(1.0))).unwrap_or_else(|_| tauri::LogicalSize::new(MAIN_SIZE.0, MAIN_SIZE.1));
    json!({ "width": size.width.round(), "height": size.height.round() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_page_comes_in_the_language_and_look_of_the_settings() {
        let settings = Settings { language: "en".into(), theme: "dark".into(), glass: true, ..Default::default() };
        let script = compat_script(&settings);
        assert!(script.contains(r#""lang":"en""#) && script.contains(r#""data-theme":"dark""#), "{script}");
        assert!(script.contains("setAttribute('data-glass', '')"));
        let plain = compat_script(&Settings::default());
        assert!(plain.contains(r#""lang":"vi""#) && plain.contains(r#""data-theme":"system""#) && plain.contains(r#""data-accent":"system""#));
        assert!(!plain.contains("data-glass"), "glass is off by default");
        assert!(plain.contains("window.lazyHost"), "the page posts its requests through the bridge");
    }

    #[test]
    fn a_window_goes_nowhere_but_its_own_page() {
        assert!(allow_navigation("about:blank"));
        assert!(allow_navigation("tauri://localhost/index.html"));
        assert!(allow_navigation("tauri://localhost/classic.html"));
        for url in ["file:///etc/hosts", "lazy://file/x", "javascript:alert(1)", "data:text/html,x", "tauri://evil/index.html", "tauri://localhost.evil/x"] {
            assert!(!allow_navigation(url), "{url}");
        }
    }

    #[test]
    fn a_window_is_named_by_its_surface_and_found_again_by_its_name() {
        let id = SurfaceId(7).window();
        assert_eq!(WindowId::of_label(&id.label()), Some(id));
        assert_eq!(WindowId::of_label("main"), None);
        assert_eq!(WindowId::of_label("lz-x"), None);
    }

    #[test]
    fn the_window_icon_is_a_png_of_rgba() {
        let icon = tauri::image::Image::from_bytes(WINDOW_ICON).unwrap();
        assert_eq!((icon.width(), icon.height(), icon.rgba().len()), (256, 256, 256 * 256 * 4));
    }

    #[test]
    fn the_classic_page_has_its_parts_in_and_no_marker_left() {
        let page = include_str!("../../dist-web/classic.html");
        assert!(!page.contains("<!--parts-->"), "build.rs did not put the parts in");
        assert!(page.contains("window.paintTheme"), "the page's own script is there");
        assert!(page.trim_end().ends_with("</html>"));
    }
}
