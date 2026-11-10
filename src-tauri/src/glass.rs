//! Liquid Glass (beta), the native layer: the system's glass behind the page, NSGlassEffectView from macOS 26 and the
//! sidebar's vibrancy before it, both put there by window-vibrancy. The page is opaque everywhere but its sidebar, so the
//! desktop shows through the sidebar alone, as through Finder's on macOS 26. The toolbar's capsules and the sheets are
//! drawn by the page, in the same frame as everything else on it.
//!
//! The library lays one view over the whole window, under the page, where the home-made layer of earlier versions laid a
//! strip down its left; the page hides what is not its sidebar, so the two look the same. Nothing follows the page's
//! layout, which is drawn in another process a frame or more after a window or sidebar moves.

use tauri::WebviewWindow;
use window_vibrancy::{LiquidGlassOptions, NSGlassEffectViewStyle, NSVisualEffectMaterial, NSVisualEffectState, apply_liquid_glass, apply_vibrancy};

/// Whether the system has real Liquid Glass (macOS 26 and later).
pub fn available() -> bool {
    objc2::runtime::AnyClass::get(c"NSGlassEffectView").is_some()
}

/// Puts the glass behind the web view and makes the window see-through (the window was made transparent). A failure is
/// only reported: the window stays as it is, and the page paints a solid window itself.
pub fn attach(window: &WebviewWindow) {
    let result = if available() {
        apply_liquid_glass(window, LiquidGlassOptions::new(NSGlassEffectViewStyle::Regular))
    } else {
        apply_vibrancy(window, NSVisualEffectMaterial::Sidebar, Some(NSVisualEffectState::FollowsWindowActiveState), None)
    };
    if let Err(e) = result {
        eprintln!("glass: not applied ({e})");
    }
}
