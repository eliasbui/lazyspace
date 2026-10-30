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

use glass::GlassLayer;
use ipc::{Dispatcher, event};
use serde_json::{Value, json};
use settings::Settings;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};
use tao::{
    dpi::{LogicalPosition, LogicalSize},
    event::{Event, StartCause, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy, EventLoopWindowTarget},
    window::{Icon, Theme, Window, WindowBuilder, WindowId},
};
use wry::{NewWindowResponse, WebView, WebViewBuilder, http::Request};

const APP_NAME: &str = "LazySpace";
const INDEX_HTML: &str = include_str!("../ui/index.html");
/// The scripts and styles of ui/parts, joined by build.rs.
const PARTS_HTML: &str = include_str!(concat!(env!("OUT_DIR"), "/parts.html"));
const WINDOW_ICON: &[u8] = include_bytes!("../assets/icon-256.png");
/// The size of a main window that has no size saved, and the least it may be.
const MAIN_SIZE: (f64, f64) = (1100.0, 720.0);
const MAIN_MIN: (f64, f64) = (640.0, 420.0);

/// Whether the app speaks English rather than Vietnamese in its own words: the menus and messages it makes. The page
/// keeps its own copy of its words (ui/index.html).
pub(crate) static ENGLISH: AtomicBool = AtomicBool::new(false);

/// `vi`, or `en` when the app speaks English.
pub(crate) fn tr<'a>(vi: &'a str, en: &'a str) -> &'a str {
    if ENGLISH.load(Ordering::Relaxed) { en } else { vi }
}

pub enum UserEvent {
    /// A message from the page of a window, as its webview's IPC handler got it.
    Ipc { window: WindowId, body: String },
    /// A message for the page of a window, or of every window when `window` is None.
    Post { window: Option<WindowId>, message: Value },
    Menu(muda::MenuId),
    /// Work that needs the App, sent from another thread.
    Main(Box<dyn FnOnce(&mut App) + Send>),
}

/// Where other threads send events to the main one. It has nothing behind it in a unit test, where no event loop can
/// be made, and then sending does nothing.
#[derive(Clone)]
pub struct Proxy(Option<EventLoopProxy<UserEvent>>);

impl Proxy {
    pub fn none() -> Proxy {
        Proxy(None)
    }

    /// Whether the event reached the loop.
    pub fn send(&self, event: UserEvent) -> bool {
        self.0.as_ref().is_some_and(|p| p.send_event(event).is_ok())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SurfaceId(pub u64);

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

/// A window with its page. The fields drop in order: the glass and the page go before the window they are in.
pub struct Surface {
    pub glass: GlassLayer,
    pub webview: WebView,
    pub window: Window,
    pub id: SurfaceId,
    pub role: Role,
    pub options: SurfaceOptions,
    /// Whether the page has said `app.ready`; what is posted before waits in `queued`.
    ready: bool,
    queued: Vec<Value>,
}

impl Surface {
    fn send(&self, message: &Value) {
        let _ = self.webview.evaluate_script(&format!("window.app && app.receive({message})"));
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
    /// Windows asked for and not made yet, and windows asked to close: the event loop does both after each event,
    /// because only it holds what tao needs to make a window (`open_surface`).
    opening: Vec<(SurfaceId, Role, SurfaceOptions)>,
    closing: Vec<SurfaceId>,
    next_surface: u64,
    focused: Option<WindowId>,
    menu_bar: Option<menus::MenuBar>,
    update_checked: bool,
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
        }
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
    fn flush_surfaces(&mut self, target: &EventLoopWindowTarget<UserEvent>) {
        for id in std::mem::take(&mut self.closing) {
            self.remove_surface(id);
        }
        for (id, role, options) in std::mem::take(&mut self.opening) {
            if let Err(e) = self.create_surface(target, id, role, options) {
                eprintln!("window: {e}");
            }
        }
    }

    fn create_surface(&mut self, target: &EventLoopWindowTarget<UserEvent>, id: SurfaceId, role: Role, options: SurfaceOptions) -> Result<(), String> {
        let saved = settings::load_layout(&self.layout_path);
        let saved_size = match (saved["window"]["width"].as_f64(), saved["window"]["height"].as_f64()) {
            (Some(w), Some(h)) if role == Role::Main => Some((w.clamp(MAIN_MIN.0, 10000.0), h.clamp(MAIN_MIN.1, 10000.0))),
            _ => None,
        };
        let (width, height) = options.frame.map(|f| (f[2], f[3])).or(saved_size).unwrap_or(MAIN_SIZE);
        let glass = self.settings.glass && role == Role::Main;
        let transparent = options.transparent || glass;
        let icon = decode_png(WINDOW_ICON).and_then(|(rgba, w, h)| Icon::from_rgba(rgba, w, h).ok());
        let mut builder = WindowBuilder::new()
            .with_title(APP_NAME)
            .with_inner_size(LogicalSize::new(width, height))
            .with_window_icon(icon)
            .with_theme(self.window_theme())
            .with_transparent(transparent)
            .with_always_on_top(options.always_on_top)
            .with_decorations(options.decorations);
        if let Some([x, y, ..]) = options.frame {
            builder = builder.with_position(LogicalPosition::new(x, y));
        }
        if role == Role::Main {
            builder = builder.with_min_inner_size(LogicalSize::new(MAIN_MIN.0, MAIN_MIN.1));
        }
        // The page runs up under a see-through title bar, so its sidebar holds the window's buttons as Finder's does,
        // and its toolbar moves the window (ipc `app.drag`).
        if options.decorations {
            use tao::platform::macos::WindowBuilderExtMacOS;
            builder = builder.with_titlebar_transparent(true).with_title_hidden(true).with_fullsize_content_view(true).with_traffic_light_inset(LogicalPosition::new(20.0, 20.0));
        }
        let window = builder.build(target).map_err(|e| e.to_string())?;
        let window_id = window.id();
        let proxy = self.proxy.clone();
        let webview = WebViewBuilder::new()
            .with_html(page(&self.settings))
            .with_transparent(transparent)
            .with_ipc_handler(move |request: Request<String>| {
                proxy.send(UserEvent::Ipc { window: window_id, body: request.into_body() });
            })
            .with_asynchronous_custom_protocol(protocol::SCHEME.into(), |_, request, responder| protocol::handle(request, responder))
            .with_navigation_handler(allow_navigation)
            .with_drag_drop_handler(interact::drop_handler(self.proxy.clone(), window_id))
            .with_new_window_req_handler(|_, _| NewWindowResponse::Deny)
            .with_devtools(cfg!(debug_assertions))
            .build(&window)
            .map_err(|e| e.to_string())?;
        let glass = if glass { GlassLayer::attach(&window, &webview) } else { GlassLayer::none() };
        self.surfaces.insert(window_id, Surface { glass, webview, window, id, role, options, ready: false, queued: Vec::new() });
        self.focused = Some(window_id);
        Ok(())
    }

    fn remove_surface(&mut self, id: SurfaceId) {
        let Some(key) = self.surfaces.iter().find(|(_, s)| s.id == id).map(|(key, _)| *key) else { return };
        interact::window_closed(self, key);
        if self.focused == Some(key) {
            self.focused = None;
        }
        if let Some(surface) = self.surfaces.remove(&key) {
            if surface.role == Role::Main {
                self.remember_size(&surface);
            }
        }
        self.views.close_window(key);
    }

    /// A window the user closed: the same as `close_surface`, from the window's id.
    fn close_requested(&mut self, window: WindowId) {
        if let Some(surface) = self.surfaces.get(&window) {
            self.closing.push(surface.id);
        }
    }

    /// The Dock icon was clicked while no window showed: brings a main window back, or makes one.
    fn reopen(&mut self) {
        if let Some(surface) = self.surfaces.values().find(|s| s.role == Role::Main) {
            surface.window.set_visible(true);
            surface.window.set_minimized(false);
            surface.window.set_focus();
        } else if !self.opening.iter().any(|(_, role, _)| *role == Role::Main) {
            self.open_surface(Role::Main, SurfaceOptions::default());
        }
    }

    /// The main window that gets what the menu bar does: the one in front, else the oldest.
    fn menu_target(&self) -> Option<WindowId> {
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
                "theme": theme_name(surface.window.theme()),
                "settings": &self.settings,
                "features": [],
                "windowRole": surface.role.name(),
                "windowId": surface.id.0,
                "glassAvailable": glass::available(),
                "uri": surface.options.uri,
                "layout": settings::load_layout(&self.layout_path),
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
            self.menu_bar = menus::menu_bar();
            if let Some(bar) = &self.menu_bar {
                bar.install();
            }
        }
        if old.theme != self.settings.theme {
            for surface in self.surfaces.values() {
                surface.window.set_theme(self.window_theme());
            }
        }
        // A window cannot become see-through after it is made (tao), so the main windows are made again; each page
        // comes back from layout.json.
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

    /// An entry of the menu bar. Quit is handled by the event loop.
    fn menu(&mut self, id: &str) {
        match id {
            menus::NEW_WINDOW => {
                self.open_surface(Role::Main, SurfaceOptions::default());
            }
            menus::CLOSE_WINDOW => {
                if let Some(id) = self.focused.and_then(|w| self.surfaces.get(&w)).map(|s| s.id) {
                    self.close_surface(id);
                }
            }
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
                Ok(check) if check.newer => event("update.available", json!({ "current": check.current, "latest": check.latest, "notes": check.notes, "installable": check.installable })),
                Ok(check) if manual => event("update.none", json!({ "current": check.current })),
                Err(error) if manual => event("toast", json!(error)),
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
                Err(error) => event("toast", json!(error)),
            };
            proxy.send(UserEvent::Post { window: None, message });
        });
    }
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

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = Proxy(Some(event_loop.create_proxy()));
    {
        let proxy = Mutex::new(proxy.clone());
        muda::MenuEvent::set_event_handler(Some(move |e: muda::MenuEvent| {
            let _ = proxy.lock().map(|p| p.send(UserEvent::Menu(e.id)));
        }));
    }
    let mut dispatcher = Dispatcher::new();
    ipc::register_core(&mut dispatcher);
    browse::register(&mut dispatcher);
    interact::register(&mut dispatcher);
    features::register(&mut dispatcher);
    let mut app = App::new(settings, settings_path, settings::layout_path(), proxy);
    app.menu_bar = menus::menu_bar();

    event_loop.run(move |event, target, flow| {
        *flow = ControlFlow::Wait;
        match event {
            Event::NewEvents(StartCause::Init) => {
                if let Some(bar) = &app.menu_bar {
                    bar.install();
                }
                dispatcher.start(&mut app);
                app.open_surface(Role::Main, SurfaceOptions::default());
            }
            Event::Reopen { has_visible_windows: false, .. } => app.reopen(),
            Event::WindowEvent { window_id, event: WindowEvent::CloseRequested, .. } => app.close_requested(window_id),
            Event::WindowEvent { window_id, event: WindowEvent::Focused(true), .. } => app.focused = Some(window_id),
            Event::WindowEvent { event: WindowEvent::ThemeChanged(theme), .. } => app.post_all(ipc::event("theme.changed", json!({ "theme": theme_name(theme) }))),
            Event::UserEvent(UserEvent::Ipc { window, body }) => dispatcher.handle(&mut app, window, &body),
            Event::UserEvent(UserEvent::Post { window: Some(window), message }) => app.post(window, message),
            Event::UserEvent(UserEvent::Post { window: None, message }) => app.post_all(message),
            Event::UserEvent(UserEvent::Menu(id)) if id.as_ref() == menus::QUIT => *flow = ControlFlow::Exit,
            Event::UserEvent(UserEvent::Menu(id)) => app.menu(id.as_ref()),
            Event::UserEvent(UserEvent::Main(work)) => work(&mut app),
            _ => {}
        }
        app.flush_surfaces(target);
    });
}

/// The page with the language, the light or dark and the glass of the settings on its root, so its first frame is
/// already drawn in them, and the parts of ui/parts after its own script.
fn page(settings: &Settings) -> String {
    let glass = if settings.glass { " data-glass" } else { "" };
    let root = format!("<html lang=\"{}\" data-theme=\"{}\"{glass}>", settings.language, settings.theme);
    INDEX_HTML.replacen("<html lang=\"vi\">", &root, 1).replacen("<!--parts-->", PARTS_HTML, 1)
}

/// The page is the only place a window goes: a link to the web opens in the browser, anything else is refused.
fn allow_navigation(url: String) -> bool {
    if url == "about:blank" {
        return true;
    }
    let _ = native::open_url(&url);
    false
}

fn theme_name(theme: Theme) -> &'static str {
    if theme == Theme::Light { "light" } else { "dark" }
}

/// The size of a window in points, as `layout.json` keeps it.
fn size_of(window: &Window) -> Value {
    let size = window.inner_size().to_logical::<f64>(window.scale_factor());
    json!({ "width": size.width.round(), "height": size.height.round() })
}

/// The RGBA pixels and side of a PNG icon.
fn decode_png(bytes: &[u8]) -> Option<(Vec<u8>, u32, u32)> {
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    buf.truncate(info.buffer_size());
    (info.color_type == png::ColorType::Rgba).then_some((buf, info.width, info.height))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_page_comes_in_the_language_and_look_of_the_settings() {
        let settings = Settings { language: "en".into(), theme: "dark".into(), glass: true, ..Default::default() };
        assert!(page(&settings).contains(r#"<html lang="en" data-theme="dark" data-glass>"#), "the root of ui/index.html is still <html lang=\"vi\">");
        assert!(page(&Settings::default()).contains(r#"<html lang="vi" data-theme="system">"#));
    }

    #[test]
    fn the_parts_of_the_page_go_in_where_the_page_marks_them() {
        let page = page(&Settings::default());
        assert!(!page.contains("<!--parts-->"), "the marker in ui/index.html is gone or was never replaced");
        assert!(INDEX_HTML.contains("<!--parts-->"));
        assert!(page.trim_end().ends_with("</html>"));
    }

    #[test]
    fn a_window_goes_nowhere_but_its_own_page() {
        assert!(allow_navigation("about:blank".into()));
        for url in ["file:///etc/hosts", "lazy://file/x", "javascript:alert(1)", "data:text/html,x"] {
            assert!(!allow_navigation(url.into()), "{url}");
        }
    }

    #[test]
    fn the_window_icon_is_a_png_of_rgba() {
        let (rgba, w, h) = decode_png(WINDOW_ICON).unwrap();
        assert_eq!((w, h, rgba.len()), (256, 256, 256 * 256 * 4));
    }
}
