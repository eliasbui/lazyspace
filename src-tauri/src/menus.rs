//! The menu bar of the app. The predefined entries are the system's own actions. The entries with an id below reach
//! main.rs as `UserEvent::Menu`: New Window, Close Window, Quit and the two Help links it handles itself, every other
//! one it hands to the page as the event `menu.action { id }`. Only the entries main.rs handles itself carry a
//! shortcut: the page owns the keys of the rest (the keymap is data and changes with the user's choice), and a menu
//! shortcut would take the key before the page saw it.

use crate::tr;
use tauri::{
    AppHandle, Wry,
    image::Image,
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
};

pub const SETTINGS: &str = "app.settings";
pub const QUIT: &str = "app.quit";
pub const NEW_WINDOW: &str = "file.new_window";
pub const NEW_FOLDER: &str = "file.new_folder";
pub const CLOSE_TAB: &str = "file.close_tab";
pub const CLOSE_WINDOW: &str = "window.close";
pub const HOME_PAGE: &str = "help.home";
pub const REPORT: &str = "help.report";
/// The entries of the menu of the icon in the menu bar, when the app keeps running there (Settings `background`).
pub const TRAY_SHOW: &str = "tray.show";
pub const TRAY_QUIT: &str = "tray.quit";

/// The menu bar, made again when the language changes.
pub struct MenuBar {
    bar: Menu<Wry>,
    window: Submenu<Wry>,
    help: Submenu<Wry>,
}

impl MenuBar {
    /// Puts the bar up; macOS takes it once the app has started.
    pub fn install(&self, handle: &AppHandle) {
        if let Err(e) = handle.set_menu(self.bar.clone()) {
            eprintln!("menu: {e}");
        }
        let _ = self.window.set_as_windows_menu_for_nsapp();
        let _ = self.help.set_as_help_menu_for_nsapp();
    }
}

pub fn menu_bar(handle: &AppHandle) -> Option<MenuBar> {
    build(handle).map_err(|e| eprintln!("menu: {e}")).ok()
}

fn build(handle: &AppHandle) -> tauri::Result<MenuBar> {
    let about = AboutMetadata {
        name: Some("LazySpace".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        comments: Some(tr("Trình quản lý tệp cho macOS", "A file manager for macOS").into()),
        copyright: Some(format!("Copyright (c) 2026 Doanh Thai Bui. {}", tr("Giấy phép MIT.", "MIT License."))),
        ..Default::default()
    };
    let item = |id: &str, text: &str| MenuItem::with_id(handle, id, text, true, None::<&str>);
    let keyed = |id: &str, text: &str, key: &str| MenuItem::with_id(handle, id, text, true, Some(key));
    let separator = || PredefinedMenuItem::separator(handle);
    let app = Submenu::with_items(
        handle,
        "LazySpace",
        true,
        &[
            &PredefinedMenuItem::about(handle, Some(tr("Giới thiệu LazySpace", "About LazySpace")), Some(about))?,
            &separator()?,
            &keyed(SETTINGS, tr("Cài đặt...", "Settings..."), "Cmd+Comma")?,
            &separator()?,
            &PredefinedMenuItem::services(handle, Some(tr("Dịch vụ", "Services")))?,
            &separator()?,
            &PredefinedMenuItem::hide(handle, Some(tr("Ẩn LazySpace", "Hide LazySpace")))?,
            &PredefinedMenuItem::hide_others(handle, Some(tr("Ẩn các ứng dụng khác", "Hide Others")))?,
            &PredefinedMenuItem::show_all(handle, Some(tr("Hiện tất cả", "Show All")))?,
            &separator()?,
            &keyed(QUIT, tr("Thoát LazySpace", "Quit LazySpace"), "Cmd+Q")?,
        ],
    )?;
    let file = Submenu::with_items(
        handle,
        tr("Tệp", "File"),
        true,
        &[
            &keyed(NEW_WINDOW, tr("Cửa sổ mới", "New Window"), "Cmd+N")?,
            &item("file.new_tab", tr("Tab mới", "New Tab"))?,
            &item(NEW_FOLDER, tr("Thư mục mới", "New Folder"))?,
            &separator()?,
            &item("file.eject", tr("Đẩy ra", "Eject"))?,
            &separator()?,
            &item(CLOSE_TAB, tr("Đóng tab", "Close Tab"))?,
            &keyed(CLOSE_WINDOW, tr("Đóng cửa sổ", "Close Window"), "Cmd+Shift+W")?,
        ],
    )?;
    let edit = Submenu::with_items(
        handle,
        tr("Sửa", "Edit"),
        true,
        &[
            &PredefinedMenuItem::undo(handle, Some(tr("Hoàn tác", "Undo")))?,
            &PredefinedMenuItem::redo(handle, Some(tr("Làm lại", "Redo")))?,
            &separator()?,
            &PredefinedMenuItem::cut(handle, Some(tr("Cắt", "Cut")))?,
            &PredefinedMenuItem::copy(handle, Some(tr("Sao chép", "Copy")))?,
            &PredefinedMenuItem::paste(handle, Some(tr("Dán", "Paste")))?,
            &PredefinedMenuItem::select_all(handle, Some(tr("Chọn tất cả", "Select All")))?,
        ],
    )?;
    let view = Submenu::with_items(
        handle,
        tr("Xem", "View"),
        true,
        &[
            &item("view.list", tr("Dạng danh sách", "as List"))?,
            &item("view.icons", tr("Dạng biểu tượng", "as Icons"))?,
            &item("view.columns", tr("Dạng cột", "as Columns"))?,
            &item("view.gallery", tr("Dạng gallery", "as Gallery"))?,
            &item("view.hidden", tr("Hiện tệp ẩn", "Show Hidden Files"))?,
            &separator()?,
            &PredefinedMenuItem::fullscreen(handle, Some(tr("Vào chế độ toàn màn hình", "Enter Full Screen")))?,
        ],
    )?;
    let go = Submenu::with_items(
        handle,
        tr("Đi tới", "Go"),
        true,
        &[
            &item("go.back", tr("Trở lại", "Back"))?,
            &item("go.forward", tr("Tiến tới", "Forward"))?,
            &item("go.enclosing", tr("Thư mục chứa", "Enclosing Folder"))?,
            &separator()?,
            &item("go.home", tr("Thư mục nhà", "Home"))?,
            &item("go.desktop", tr("Màn hình nền", "Desktop"))?,
            &item("go.downloads", tr("Tải xuống", "Downloads"))?,
            &item("go.applications", tr("Ứng dụng", "Applications"))?,
        ],
    )?;
    let window = Submenu::with_items(
        handle,
        tr("Cửa sổ", "Window"),
        true,
        &[
            &PredefinedMenuItem::minimize(handle, Some(tr("Thu nhỏ", "Minimize")))?,
            &PredefinedMenuItem::maximize(handle, Some(tr("Phóng to", "Zoom")))?,
            &separator()?,
            &PredefinedMenuItem::bring_all_to_front(handle, Some(tr("Đưa tất cả lên trước", "Bring All to Front")))?,
        ],
    )?;
    let help = Submenu::with_items(handle, tr("Trợ giúp", "Help"), true, &[&item(HOME_PAGE, tr("LazySpace trên GitHub", "LazySpace on GitHub"))?, &item(REPORT, tr("Báo lỗi", "Report a Problem"))?])?;
    let bar = Menu::with_items(handle, &[&app, &file, &edit, &view, &go, &window, &help])?;
    Ok(MenuBar { bar, window, help })
}

/// The icon in the menu bar, with its menu: bring the windows back, a new window, or quit for good. Its entries reach
/// the app through the same handler as the menu bar's. Whether it is up.
pub fn tray(handle: &AppHandle, id: &str, icon_png: &[u8]) -> bool {
    let make = || -> tauri::Result<()> {
        let menu = Menu::with_items(
            handle,
            &[
                &MenuItem::with_id(handle, TRAY_SHOW, tr("Mở LazySpace", "Open LazySpace"), true, None::<&str>)?,
                &MenuItem::with_id(handle, NEW_WINDOW, tr("Cửa sổ mới", "New Window"), true, None::<&str>)?,
                &PredefinedMenuItem::separator(handle)?,
                &MenuItem::with_id(handle, TRAY_QUIT, tr("Thoát hẳn LazySpace", "Quit LazySpace for Good"), true, None::<&str>)?,
            ],
        )?;
        TrayIconBuilder::with_id(id).icon(Image::from_bytes(icon_png)?).icon_as_template(false).tooltip("LazySpace").menu(&menu).build(handle)?;
        Ok(())
    };
    make().map_err(|e| eprintln!("tray: {e}")).is_ok()
}
