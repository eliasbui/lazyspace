//! The menu bar of the app. The predefined entries are the system's own actions. The entries with an id below reach
//! main.rs as `UserEvent::Menu`: New Window, Close Window, Quit and the two Help links it handles itself, every other
//! one it hands to the page as the event `menu.action { id }`. Only the entries main.rs handles itself carry a
//! shortcut: the page owns the keys of the rest (the keymap is data and changes with the user's choice), and a menu
//! shortcut would take the key before the page saw it.

use crate::tr;
use muda::{
    AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu,
    accelerator::{Accelerator, Code, Modifiers},
};

pub const SETTINGS: &str = "app.settings";
pub const QUIT: &str = "app.quit";
pub const NEW_WINDOW: &str = "file.new_window";
pub const NEW_FOLDER: &str = "file.new_folder";
pub const CLOSE_TAB: &str = "file.close_tab";
pub const CLOSE_WINDOW: &str = "window.close";
pub const HOME_PAGE: &str = "help.home";
pub const REPORT: &str = "help.report";

/// The menu bar, made again when the language changes.
pub struct MenuBar {
    bar: Menu,
    window: Submenu,
    help: Submenu,
}

impl MenuBar {
    /// Puts the bar up; macOS takes it once the app has started.
    pub fn install(&self) {
        self.bar.init_for_nsapp();
        self.window.set_as_windows_menu_for_nsapp();
        self.help.set_as_help_menu_for_nsapp();
    }
}

pub fn menu_bar() -> Option<MenuBar> {
    let key = |modifiers, code| Some(Accelerator::new(modifiers, code));
    let about = AboutMetadata {
        name: Some("LazySpace".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        comments: Some(tr("Trình quản lý tệp cho macOS", "A file manager for macOS").into()),
        copyright: Some(format!("Copyright (c) 2026 Doanh Thai Bui. {}", tr("Giấy phép MIT.", "MIT License."))),
        ..Default::default()
    };
    let item = |id: &str, text: &str| MenuItem::with_id(id, text, true, None);
    let app = Submenu::with_items(
        "LazySpace",
        true,
        &[
            &PredefinedMenuItem::about(Some(tr("Giới thiệu LazySpace", "About LazySpace")), Some(about)),
            &PredefinedMenuItem::separator(),
            &MenuItem::with_id(SETTINGS, tr("Cài đặt...", "Settings..."), true, key(Modifiers::META, Code::Comma)),
            &PredefinedMenuItem::separator(),
            &PredefinedMenuItem::services(Some(tr("Dịch vụ", "Services"))),
            &PredefinedMenuItem::separator(),
            &PredefinedMenuItem::hide(Some(tr("Ẩn LazySpace", "Hide LazySpace"))),
            &PredefinedMenuItem::hide_others(Some(tr("Ẩn các ứng dụng khác", "Hide Others"))),
            &PredefinedMenuItem::show_all(Some(tr("Hiện tất cả", "Show All"))),
            &PredefinedMenuItem::separator(),
            &MenuItem::with_id(QUIT, tr("Thoát LazySpace", "Quit LazySpace"), true, key(Modifiers::META, Code::KeyQ)),
        ],
    );
    let file = Submenu::with_items(
        tr("Tệp", "File"),
        true,
        &[
            &MenuItem::with_id(NEW_WINDOW, tr("Cửa sổ mới", "New Window"), true, key(Modifiers::META, Code::KeyN)),
            &item(NEW_FOLDER, tr("Thư mục mới", "New Folder")),
            &PredefinedMenuItem::separator(),
            &item(CLOSE_TAB, tr("Đóng tab", "Close Tab")),
            &MenuItem::with_id(CLOSE_WINDOW, tr("Đóng cửa sổ", "Close Window"), true, key(Modifiers::META | Modifiers::SHIFT, Code::KeyW)),
        ],
    );
    let edit = Submenu::with_items(
        tr("Sửa", "Edit"),
        true,
        &[
            &PredefinedMenuItem::undo(Some(tr("Hoàn tác", "Undo"))),
            &PredefinedMenuItem::redo(Some(tr("Làm lại", "Redo"))),
            &PredefinedMenuItem::separator(),
            &PredefinedMenuItem::cut(Some(tr("Cắt", "Cut"))),
            &PredefinedMenuItem::copy(Some(tr("Sao chép", "Copy"))),
            &PredefinedMenuItem::paste(Some(tr("Dán", "Paste"))),
            &PredefinedMenuItem::select_all(Some(tr("Chọn tất cả", "Select All"))),
        ],
    );
    let view = Submenu::with_items(
        tr("Xem", "View"),
        true,
        &[
            &item("view.list", tr("Dạng danh sách", "as List")),
            &item("view.icons", tr("Dạng biểu tượng", "as Icons")),
            &item("view.hidden", tr("Hiện tệp ẩn", "Show Hidden Files")),
            &PredefinedMenuItem::separator(),
            &PredefinedMenuItem::fullscreen(Some(tr("Vào chế độ toàn màn hình", "Enter Full Screen"))),
        ],
    );
    let go = Submenu::with_items(
        tr("Đi tới", "Go"),
        true,
        &[
            &item("go.back", tr("Trở lại", "Back")),
            &item("go.forward", tr("Tiến tới", "Forward")),
            &item("go.enclosing", tr("Thư mục chứa", "Enclosing Folder")),
            &PredefinedMenuItem::separator(),
            &item("go.home", tr("Thư mục nhà", "Home")),
            &item("go.desktop", tr("Màn hình nền", "Desktop")),
            &item("go.downloads", tr("Tải xuống", "Downloads")),
            &item("go.applications", tr("Ứng dụng", "Applications")),
        ],
    );
    let window = Submenu::with_items(
        tr("Cửa sổ", "Window"),
        true,
        &[
            &PredefinedMenuItem::minimize(Some(tr("Thu nhỏ", "Minimize"))),
            &PredefinedMenuItem::maximize(Some(tr("Phóng to", "Zoom"))),
            &PredefinedMenuItem::separator(),
            &PredefinedMenuItem::bring_all_to_front(Some(tr("Đưa tất cả lên trước", "Bring All to Front"))),
        ],
    );
    let help = Submenu::with_items(
        tr("Trợ giúp", "Help"),
        true,
        &[&item(HOME_PAGE, tr("LazySpace trên GitHub", "LazySpace on GitHub")), &item(REPORT, tr("Báo lỗi", "Report a Problem"))],
    );
    let bar = Menu::new();
    let (app, file, edit, view, go, window, help) = (app.ok()?, file.ok()?, edit.ok()?, view.ok()?, go.ok()?, window.ok()?, help.ok()?);
    bar.append_items(&[&app, &file, &edit, &view, &go, &window, &help]).ok()?;
    Some(MenuBar { bar, window, help })
}
