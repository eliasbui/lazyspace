//! Liquid Glass (beta), the native layer. Behind the page goes the system's glass (NSGlassEffectView from macOS 26, a
//! vibrancy material before it), with a veil of the window's colour over it so the page reads as easily as on a plain
//! window. The page then asks, with `glass.panes`, for panes of real glass under the sidebar, the capsules and the open
//! sheet, and leaves those places clear. The page's own CSS (ui/index.html, `:root.glass`) is the effect without this
//! layer and the fallback when it is not there.

use crate::native;
use block2::RcBlock;
use objc2::{
    MainThreadMarker,
    rc::Retained,
    runtime::AnyClass,
};
use objc2_app_kit::{
    NSAppearance, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSAutoresizingMaskOptions, NSBox, NSBoxType, NSColor,
    NSGlassEffectView, NSGlassEffectViewStyle, NSTitlePosition, NSView, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
    NSVisualEffectState, NSVisualEffectView, NSWindowOrderingMode,
};
use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize};
use std::{cell::RefCell, ptr::NonNull};
use tao::window::Window;
use wry::{WebView, WebViewExtMacOS};

/// How much of the window's colour lies over its glass, from 0 (clear glass) to 1 (a plain window).
const VEIL: f64 = 0.8;

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

    /// Puts the glass and the veil behind the web view, in the content view tao made, and makes the window see-through.
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
        let veil = NSBox::initWithFrame(mtm.alloc(), root.bounds());
        veil.setBoxType(NSBoxType::Custom);
        veil.setTitlePosition(NSTitlePosition::NoTitle);
        veil.setBorderWidth(0.0);
        veil.setFillColor(&veil_color());
        for view in [&*backing, &**veil] {
            view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
            root.addSubview_positioned_relativeTo(view, NSWindowOrderingMode::Below, Some(&web));
        }
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

/// The colour of the page's window (`--window` of ui/index.html, light and dark) at `VEIL`, asked again for each
/// appearance. The system's window colour does not fill a box on macOS 26, and a colour made see-through once keeps
/// the appearance it was made in.
fn veil_color() -> Retained<NSColor> {
    let provider = RcBlock::new(|appearance: NonNull<NSAppearance>| -> NonNull<NSColor> {
        // SAFETY: AppKit passes a live appearance for the length of the call; the names are process-lifetime
        // constants.
        let dark = unsafe {
            let names = NSArray::from_slice(&[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]);
            appearance.as_ref().bestMatchFromAppearancesWithNames(&names).is_some_and(|name| &*name == NSAppearanceNameDarkAqua)
        };
        let (r, g, b) = if dark { (0x1c, 0x1c, 0x1e) } else { (0xef, 0xef, 0xf2) };
        let color = NSColor::colorWithSRGBRed_green_blue_alpha(f64::from(r) / 255.0, f64::from(g) / 255.0, f64::from(b) / 255.0, VEIL);
        // AppKit takes the colour without owning it, so it lives on in the autorelease pool.
        NonNull::new(Retained::autorelease_return(color)).expect("a colour is never null")
    });
    // SAFETY: the provider is a block of the expected signature that AppKit may call on any appearance change.
    unsafe { NSColor::colorWithName_dynamicProvider(None, &provider) }
}
