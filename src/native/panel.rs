//! Windows that are not ordinary ones: the desktop, drawn under every other window at the level of the desktop's icons,
//! on every Space, and left in place by Mission Control.

use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplicationDidChangeScreenParametersNotification, NSScreen, NSWindowCollectionBehavior};
use objc2_core_graphics::{CGWindowLevelForKey, CGWindowLevelKey};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSOperationQueue};
use std::ptr::NonNull;
use tao::window::Window;

/// Puts a window at the level of the desktop's icons, over the main screen but its menu bar and Dock, on every Space,
/// and out of Mission Control and of Command-`.
pub fn pin_to_desktop(window: &Window) {
    let (Some(ns), Some(mtm)) = (super::ns_window(window), MainThreadMarker::new()) else { return };
    ns.setLevel(CGWindowLevelForKey(CGWindowLevelKey::DesktopIconWindowLevelKey) as isize);
    ns.setCollectionBehavior(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::Stationary | NSWindowCollectionBehavior::IgnoresCycle);
    ns.setHasShadow(false);
    // The first screen is the one with the menu bar, where Finder puts the desktop's icons.
    if let Some(screen) = NSScreen::screens(mtm).firstObject() {
        ns.setFrame_display(screen.visibleFrame(), true);
    }
}

/// Calls `f` on the main thread each time the screens change: one added or removed, a new resolution, the Dock moved.
pub fn on_screens_changed(f: impl Fn() + 'static) {
    let block = block2::RcBlock::new(move |_: NonNull<NSNotification>| f());
    // SAFETY: the name is AppKit's constant and the block lives as long as the observer, which lives for the run.
    let observer = unsafe { NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(Some(NSApplicationDidChangeScreenParametersNotification), None, Some(&NSOperationQueue::mainQueue()), &block) };
    std::mem::forget(observer);
}
