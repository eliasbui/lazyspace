//! Liquid Glass (beta), the native layer. Behind the page goes the system's glass (NSGlassEffectView from macOS 26, a
//! vibrancy material before it), clear, so the desktop shows through the window as through Finder's on macOS 26. The
//! page lays the files on a card of the window's colour of its own, and asks, with `glass.panes`, for panes of real
//! glass under the sidebar, the capsules and the open sheet. The page's own CSS (ui/index.html, `:root.glass`) is the effect without this
//! layer and the fallback when it is not there.

use crate::native;
use objc2::{
    MainThreadMarker,
    rc::Retained,
    runtime::AnyClass,
};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSColor, NSGlassEffectView, NSGlassEffectViewStyle, NSView, NSVisualEffectBlendingMode,
    NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView, NSWindowOrderingMode,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::cell::RefCell;
use tao::window::Window;
use wry::{WebView, WebViewExtMacOS};

/// The most panes of glass the page may ask for.
const MAX_PANES: usize = 64;

/// Whether the system has real Liquid Glass (macOS 26 and later); the page uses it to leave the glass to the app.
pub fn available() -> bool {
    AnyClass::get(c"NSGlassEffectView").is_some()
}

/// The glass behind one window's page: nothing until `attach`.
pub struct GlassLayer {
    attached: Option<Attached>,
}

struct Attached {
    mtm: MainThreadMarker,
    root: Retained<NSView>,
    web: Retained<NSView>,
    panes: RefCell<Vec<Retained<NSGlassEffectView>>>,
}

impl GlassLayer {
    pub fn none() -> GlassLayer {
        GlassLayer { attached: None }
    }

    /// Puts the glass behind the web view, in the content view tao made, and makes the window see-through.
    /// Does nothing off the main thread.
    pub fn attach(window: &Window, webview: &WebView) -> GlassLayer {
        let (Some(mtm), Some(ns_window)) = (MainThreadMarker::new(), native::ns_window(window)) else {
            return GlassLayer::none();
        };
        let Some(root) = ns_window.contentView() else {
            return GlassLayer::none();
        };
        let web: Retained<NSView> = Retained::into_super(Retained::into_super(webview.webview()));
        ns_window.setOpaque(false);
        ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
        let backing = backing(mtm, root.bounds());
        backing.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
        root.addSubview_positioned_relativeTo(&backing, NSWindowOrderingMode::Below, Some(&web));
        GlassLayer { attached: Some(Attached { mtm, root, web, panes: RefCell::new(Vec::new()) }) }
    }

    /// Lays panes of glass, each `[x, y, width, height, radius]` in points from the top left, between the window's own
    /// glass and the page. Panes beyond the first `MAX_PANES` are left out. Before macOS 26 there is no NSGlassEffectView
    /// to lay, and the page's own CSS draws the panes.
    pub fn set_panes(&self, panes: &[[f64; 5]]) {
        let Some(Attached { mtm, root, web, panes: pool }) = &self.attached else { return };
        if !available() {
            return;
        }
        let panes = &panes[..panes.len().min(MAX_PANES)];
        let size = root.bounds().size;
        let mut pool = pool.borrow_mut();
        while pool.len() > panes.len() {
            if let Some(pane) = pool.pop() {
                pane.removeFromSuperview();
            }
        }
        while pool.len() < panes.len() {
            let pane = NSGlassEffectView::initWithFrame(mtm.alloc(), NSRect::ZERO);
            pane.setStyle(NSGlassEffectViewStyle::Regular);
            root.addSubview_positioned_relativeTo(&pane, NSWindowOrderingMode::Below, Some(web));
            pool.push(pane);
        }
        for (pane, p) in pool.iter().zip(panes) {
            pane.setFrame(NSRect::new(NSPoint::new(p[0], size.height - p[1] - p[3]), NSSize::new(p[2], p[3])));
            pane.setCornerRadius(p[4].min(p[2] / 2.0).min(p[3] / 2.0).max(0.0));
            // Until the page answers a resize: a tall pane stretches, the others keep to the top, and to the right
            // edge when they are on its half.
            let mut mask = if p[3] > size.height / 2.0 { NSAutoresizingMaskOptions::ViewHeightSizable } else { NSAutoresizingMaskOptions::ViewMinYMargin };
            if p[0] + p[2] / 2.0 > size.width / 2.0 {
                mask |= NSAutoresizingMaskOptions::ViewMinXMargin;
            }
            pane.setAutoresizingMask(mask);
        }
    }
}

/// The window's background: real Liquid Glass where the system has it, a vibrancy material elsewhere.
fn backing(mtm: MainThreadMarker, frame: NSRect) -> Retained<NSView> {
    if available() {
        let glass = NSGlassEffectView::initWithFrame(mtm.alloc(), frame);
        glass.setStyle(NSGlassEffectViewStyle::Regular);
        return Retained::into_super(glass);
    }
    let effect = NSVisualEffectView::initWithFrame(mtm.alloc(), frame);
    effect.setMaterial(NSVisualEffectMaterial::UnderWindowBackground);
    effect.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
    effect.setState(NSVisualEffectState::Active);
    Retained::into_super(effect)
}
