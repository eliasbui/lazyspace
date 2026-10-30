//! Liquid Glass (beta), the native layer: a strip of the system's glass (NSGlassEffectView from macOS 26, the sidebar's
//! vibrancy before it) down the left of the window, behind the page. The page is opaque everywhere but its sidebar, so
//! the desktop shows through the sidebar alone, as through Finder's on macOS 26. The toolbar's capsules and the sheets
//! are drawn by the page (ui/index.html, `:root.glass`), in the same frame as everything else on it.
//!
//! Nothing here follows the page's layout, which is drawn in another process a frame or more after a window or sidebar
//! moves: native views placed after it would always trail it. The strip is wider than the widest sidebar and as tall
//! as the window, and the page hides the part of it beyond the sidebar.

use crate::native;
use objc2::{MainThreadMarker, rc::Retained, runtime::AnyClass};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSColor, NSGlassEffectView, NSGlassEffectViewStyle, NSView, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
    NSVisualEffectState, NSVisualEffectView, NSWindowOrderingMode,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use tao::window::Window;
use wry::{WebView, WebViewExtMacOS};

/// The width of the strip in points: the widest sidebar the page allows (380) and its margin, with room to spare.
const STRIP: f64 = 420.0;

/// Whether the system has real Liquid Glass (macOS 26 and later).
pub fn available() -> bool {
    AnyClass::get(c"NSGlassEffectView").is_some()
}

/// Puts the glass behind the web view, in the content view tao made, and makes the window see-through. Does nothing
/// off the main thread. The content view keeps the strip for as long as the window lives.
pub fn attach(window: &Window, webview: &WebView) {
    let (Some(mtm), Some(ns_window)) = (MainThreadMarker::new(), native::ns_window(window)) else { return };
    let Some(root) = ns_window.contentView() else { return };
    let web: Retained<NSView> = Retained::into_super(Retained::into_super(webview.webview()));
    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
    let strip = backing(mtm, NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(STRIP, root.bounds().size.height)));
    strip.setAutoresizingMask(NSAutoresizingMaskOptions::ViewHeightSizable | NSAutoresizingMaskOptions::ViewMaxXMargin);
    root.addSubview_positioned_relativeTo(&strip, NSWindowOrderingMode::Below, Some(&web));
}

/// The strip: real Liquid Glass where the system has it, the sidebar's vibrancy elsewhere.
fn backing(mtm: MainThreadMarker, frame: NSRect) -> Retained<NSView> {
    if available() {
        let glass = NSGlassEffectView::initWithFrame(mtm.alloc(), frame);
        glass.setStyle(NSGlassEffectViewStyle::Regular);
        return Retained::into_super(glass);
    }
    let effect = NSVisualEffectView::initWithFrame(mtm.alloc(), frame);
    effect.setMaterial(NSVisualEffectMaterial::Sidebar);
    effect.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
    effect.setState(NSVisualEffectState::FollowsWindowActiveState);
    Retained::into_super(effect)
}
