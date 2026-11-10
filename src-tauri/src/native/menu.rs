//! The context menu as a real NSMenu: Liquid Glass on macOS 26, past the window's edge, VoiceOver, typing to pick.
//! It is built from the tree src/contextmenu.rs arranged, with SF Symbols for icons and the apps that open a file in
//! "Open With", and shown where the page was clicked. Showing it runs AppKit's own loop until it closes, so it is
//! started from the main queue, after the event the app is handling, never inside it.

use crate::{contextmenu::MenuNode, native::workspace, tr};
use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send, rc::Retained, sel};
use objc2_app_kit::{NSControlStateValueOff, NSControlStateValueOn, NSEventModifierFlags, NSImage, NSMenu, NSMenuItem, NSView, NSWorkspace};
use objc2_foundation::{NSObject, NSObjectProtocol, NSPoint, NSSize, NSString};
use std::cell::RefCell;

/// The id an "Open With" item answers with: the prefix and the path of the app.
pub const OPEN_WITH: &str = "openWith:";

define_class!(
    /// What every item of the menu sends its action to; it keeps the id of the item chosen.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "LZMenuTarget"]
    #[ivars = RefCell<Option<String>>]
    struct MenuTarget;

    unsafe impl NSObjectProtocol for MenuTarget {}

    impl MenuTarget {
        #[unsafe(method(choose:))]
        fn choose(&self, sender: &NSMenuItem) {
            let id = sender.representedObject().and_then(|o| o.downcast::<NSString>().ok()).map(|s| s.to_string());
            *self.ivars().borrow_mut() = id;
        }
    }
);

impl MenuTarget {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = mtm.alloc::<Self>().set_ivars(RefCell::new(None));
        // SAFETY: NSObject's init on a freshly allocated instance with its ivars set.
        unsafe { msg_send![super(this), init] }
    }
}

fn symbol(name: &str) -> Option<Retained<NSImage>> {
    let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(&NSString::from_str(name), None)?;
    image.setTemplate(true);
    Some(image)
}

fn item(mtm: MainThreadMarker, target: &MenuTarget, id: &str, label: &str) -> Retained<NSMenuItem> {
    // SAFETY: `choose:` is a method of the target, with the signature of a menu action.
    let item = unsafe { NSMenuItem::initWithTitle_action_keyEquivalent(mtm.alloc(), &NSString::from_str(label), Some(sel!(choose:)), &NSString::new()) };
    // SAFETY: the target outlives the menu: both live until the popup returns.
    unsafe {
        item.setTarget(Some(target));
        item.setRepresentedObject(Some(&NSString::from_str(id)));
    }
    item
}

fn build(mtm: MainThreadMarker, target: &MenuTarget, nodes: &[MenuNode], apps: Option<&[workspace::App]>) -> Retained<NSMenu> {
    let menu = NSMenu::new(mtm);
    menu.setAutoenablesItems(false);
    for node in nodes {
        if node.separator {
            menu.addItem(&NSMenuItem::separatorItem(mtm));
            continue;
        }
        let entry = item(mtm, target, &node.id, &node.label);
        entry.setEnabled(node.enabled);
        entry.setState(if node.checked { NSControlStateValueOn } else { NSControlStateValueOff });
        if let Some(image) = node.icon.as_deref().and_then(symbol) {
            entry.setImage(Some(&image));
        }
        if let Some((key, mods)) = node.shortcut.as_deref().and_then(crate::contextmenu::key_equivalent) {
            entry.setKeyEquivalent(&NSString::from_str(&key));
            let mut mask = NSEventModifierFlags::empty();
            for (on, flag) in mods.iter().zip([NSEventModifierFlags::Command, NSEventModifierFlags::Shift, NSEventModifierFlags::Option, NSEventModifierFlags::Control]) {
                if *on {
                    mask |= flag;
                }
            }
            entry.setKeyEquivalentModifierMask(mask);
        }
        if node.id == "openWith" {
            if let Some(apps) = apps {
                entry.setSubmenu(Some(&open_with(mtm, target, apps)));
            }
        } else if !node.submenu.is_empty() {
            entry.setSubmenu(Some(&build(mtm, target, &node.submenu, apps)));
        }
        menu.addItem(&entry);
    }
    menu
}

/// "Open With": the system's choice first, then the others, each with its own icon.
fn open_with(mtm: MainThreadMarker, target: &MenuTarget, apps: &[workspace::App]) -> Retained<NSMenu> {
    let menu = NSMenu::new(mtm);
    menu.setAutoenablesItems(false);
    let workspace = NSWorkspace::sharedWorkspace();
    for (i, app) in apps.iter().enumerate() {
        let label = if app.is_default { format!("{} ({})", app.name, tr("mặc định", "default")) } else { app.name.clone() };
        let entry = item(mtm, target, &format!("{OPEN_WITH}{}", app.path), &label);
        let image = workspace.iconForFile(&NSString::from_str(&app.path));
        image.setSize(NSSize::new(16.0, 16.0));
        entry.setImage(Some(&image));
        menu.addItem(&entry);
        if i == 0 && apps.len() > 1 {
            menu.addItem(&NSMenuItem::separatorItem(mtm));
        }
    }
    if apps.is_empty() {
        let none = item(mtm, target, "", tr("Không có ứng dụng nào", "No apps"));
        none.setEnabled(false);
        menu.addItem(&none);
    }
    menu
}

/// Shows the menu at `(x, y)` (CSS pixels from the top left of the web view) and returns the id of the item chosen,
/// or None when it closed without a choice.
pub fn popup(mtm: MainThreadMarker, view: &NSView, nodes: &[MenuNode], x: f64, y: f64, apps: Option<&[workspace::App]>) -> Option<String> {
    let target = MenuTarget::new(mtm);
    let menu = build(mtm, &target, nodes, apps);
    let point = if view.isFlipped() { NSPoint::new(x, y) } else { NSPoint::new(x, view.bounds().size.height - y) };
    menu.popUpMenuPositioningItem_atLocation_inView(None, point, Some(view));
    let chosen = target.ivars().borrow_mut().take();
    chosen.filter(|id| !id.is_empty())
}
