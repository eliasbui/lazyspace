//! Helpers the native modules share: the NSWindow behind a tao window, links opened by the system, the folder picker,
//! and an NSImage as PNG. Code that uses AppKit is kept thin and holds no logic of its own, so the logic can be
//! tested without a window.

pub mod camera;
pub mod devices;
pub mod drag;
pub mod icons;
pub mod menu;
pub mod panel;
pub mod quicklook;
pub mod services;
pub mod share;
pub mod tags;
pub mod trash;
pub mod workspace;

use crate::tr;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSWindow, NSWorkspace};
use objc2_foundation::{NSDictionary, NSString, NSURL};
use serde_json::{Value, json};
use std::process::Command;
use tao::{platform::macos::WindowExtMacOS, window::Window};

/// The start of today on this Mac's clock, in seconds since 1970, as Finder and Spotlight count "today".
pub fn start_of_today() -> i64 {
    let calendar = objc2_foundation::NSCalendar::currentCalendar();
    calendar.startOfDayForDate(&objc2_foundation::NSDate::now()).timeIntervalSince1970() as i64
}

/// The web view of a window as an NSView, for AppKit calls that need the view the page is drawn in.
pub fn web_view(webview: &wry::WebView) -> objc2::rc::Retained<objc2_app_kit::NSView> {
    use wry::WebViewExtMacOS;
    objc2::rc::Retained::into_super(objc2::rc::Retained::into_super(webview.webview()))
}

/// The NSWindow of a tao window, which lives as long as the tao window does.
pub fn ns_window(window: &Window) -> Option<&NSWindow> {
    // SAFETY: tao hands out the pointer to the NSWindow it made for this window, or null.
    unsafe { (window.ns_window() as *const NSWindow).as_ref() }
}

/// Whether `url` is one the system may open for the page: a web page or a mail address.
pub fn is_web_url(url: &str) -> bool {
    url.split_once(':').is_some_and(|(scheme, rest)| {
        let scheme = scheme.to_ascii_lowercase();
        !rest.is_empty() && matches!(scheme.as_str(), "http" | "https" | "mailto")
    })
}

/// Opens a web page or a mail address with the app the system names for it.
pub fn open_url(url: &str) -> Result<(), String> {
    if !is_web_url(url) {
        return Err(tr("Chỉ mở được liên kết http, https và mailto", "Only http, https and mailto links can be opened").into());
    }
    let url = NSURL::URLWithString(&NSString::from_str(url)).ok_or(tr("Liên kết không hợp lệ", "The link is not valid"))?;
    if NSWorkspace::sharedWorkspace().openURL(&url) { Ok(()) } else { Err(tr("Không mở được liên kết", "The link could not be opened").into()) }
}

/// Asks for a folder with the system's picker: its path, or null when the user cancels. The prompt goes in as an
/// argument of the script, not into its text.
pub fn choose_folder(prompt: &str) -> Result<Value, String> {
    let script = ["on run argv", "POSIX path of (choose folder with prompt (item 1 of argv))", "end run"];
    let mut command = Command::new("/usr/bin/osascript");
    for line in script {
        command.args(["-e", line]);
    }
    let out = command.arg(prompt).output().map_err(|e| e.to_string())?;
    // Cancelling the picker is an error of osascript with no output.
    let path = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    Ok(if path.is_empty() { Value::Null } else { json!(path.trim_end_matches('/')) })
}

/// An image as PNG bytes; the icon and thumbnail protocol of F2 draws with it.
#[allow(dead_code)]
pub fn png_of(image: &NSImage) -> Option<Vec<u8>> {
    let tiff = image.TIFFRepresentation()?;
    let rep = NSBitmapImageRep::imageRepWithData(&tiff)?;
    // SAFETY: an empty properties dictionary is valid for PNG output.
    let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }?;
    Some(png.to_vec())
}

#[cfg(test)]
mod tests {
    use super::is_web_url;

    #[test]
    fn only_web_pages_and_mail_are_opened_for_the_page() {
        assert!(is_web_url("https://github.com/eliasbui/lazyspace"));
        assert!(is_web_url("HTTP://example.com"));
        assert!(is_web_url("mailto:someone@example.com"));
        for url in ["file:///etc/passwd", "lazy://file/x", "javascript:alert(1)", "about:blank", "https:", "/Applications", ""] {
            assert!(!is_web_url(url), "{url}");
        }
    }
}
