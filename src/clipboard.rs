//! Files on the system's clipboard, so copy and paste work between LazySpace and Finder or any other app. A cut is
//! LazySpace's own: the files go on the clipboard as for a copy, and a paste while the clipboard still holds them
//! moves them instead.

use objc2::{ClassType, rc::Retained, runtime::{AnyObject, ProtocolObject}};
use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString, NSPasteboardURLReadingFileURLsOnlyKey, NSPasteboardWriting};
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString, NSURL};
use std::path::{Path, PathBuf};

/// Puts the files on the clipboard and returns its change count, by which a later paste knows it is still them.
pub fn write(paths: &[PathBuf]) -> isize {
    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();
    let urls: Vec<Retained<ProtocolObject<dyn NSPasteboardWriting>>> =
        paths.iter().map(|p| ProtocolObject::from_retained(NSURL::fileURLWithPath(&NSString::from_str(&p.to_string_lossy())))).collect();
    pasteboard.writeObjects(&NSArray::from_retained_slice(&urls));
    pasteboard.changeCount()
}

/// The files on the clipboard, whoever put them there.
pub fn read() -> Vec<PathBuf> {
    let pasteboard = NSPasteboard::generalPasteboard();
    let classes = NSArray::from_slice(&[NSURL::class()]);
    let yes = NSNumber::new_bool(true);
    // SAFETY: the key is a process-lifetime constant; the value is an NSNumber as the option documents.
    let options: Retained<NSDictionary<NSString, AnyObject>> = unsafe { NSDictionary::from_slices(&[NSPasteboardURLReadingFileURLsOnlyKey], &[yes.as_ref()]) };
    // SAFETY: the class array holds NSURL and the options are the documented reading options.
    let Some(objects) = (unsafe { pasteboard.readObjectsForClasses_options(&classes, Some(&options)) }) else {
        return Vec::new();
    };
    objects.iter().filter_map(|o| o.downcast::<NSURL>().ok()).filter_map(|u| u.path()).map(|p| PathBuf::from(p.to_string())).collect()
}

/// Puts text on the clipboard (a path copied as text).
pub fn write_text(text: &str) {
    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();
    // SAFETY: the type is a process-lifetime constant of AppKit.
    pasteboard.setString_forType(&NSString::from_str(text), unsafe { NSPasteboardTypeString });
}

pub fn change_count() -> isize {
    NSPasteboard::generalPasteboard().changeCount()
}

/// A cut waiting for its paste: the files and the clipboard's change count when they were cut.
#[derive(Debug, Default)]
pub struct Cut {
    pub paths: Vec<PathBuf>,
    pub count: isize,
}

impl Cut {
    /// Whether a paste now should move: the clipboard has not changed since the cut and holds the same files.
    pub fn applies(&self, count: isize, on_clipboard: &[PathBuf]) -> bool {
        !self.paths.is_empty() && self.count == count && self.paths.iter().all(|p| on_clipboard.iter().any(|c| c == p))
    }

    pub fn holds(&self, path: &Path) -> bool {
        self.paths.iter().any(|p| p == path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cut_applies_only_while_the_clipboard_is_unchanged() {
        let cut = Cut { paths: vec!["/a".into(), "/b".into()], count: 7 };
        assert!(cut.applies(7, &["/a".into(), "/b".into()]));
        assert!(!cut.applies(8, &["/a".into(), "/b".into()]), "something else was copied since");
        assert!(!cut.applies(7, &["/a".into()]));
        assert!(!Cut::default().applies(0, &[]));
        assert!(cut.holds(Path::new("/b")) && !cut.holds(Path::new("/c")));
    }
}
