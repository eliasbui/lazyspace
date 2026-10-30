//! The system's share sheet for files of this Mac (AirDrop, Messages, Mail and whatever else is installed), opened at a
//! point of the page.

use objc2::{MainThreadMarker, rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSSharingServicePicker, NSView};
use objc2_foundation::{NSArray, NSPoint, NSRect, NSRectEdge, NSSize, NSString, NSURL};
use std::{cell::RefCell, path::PathBuf};

thread_local! {
    /// The picker on screen, kept until the next one: AppKit does not keep it while its sheet is open.
    static SHOWN: RefCell<Option<Retained<NSSharingServicePicker>>> = const { RefCell::new(None) };
}

/// Opens the share sheet for `paths` at (`x`, `y`) of `view`, in the page's points from its top left.
pub fn show(mtm: MainThreadMarker, view: &NSView, paths: &[PathBuf], x: f64, y: f64) {
    let items: Vec<Retained<AnyObject>> =
        paths.iter().map(|p| Retained::into_super(Retained::into_super(NSURL::fileURLWithPath(&NSString::from_str(&p.to_string_lossy()))))).collect();
    let items = NSArray::from_retained_slice(&items);
    // SAFETY: file URLs are items the picker shares.
    let picker = unsafe { NSSharingServicePicker::initWithItems(mtm.alloc(), &items) };
    let y = if view.isFlipped() { y } else { view.bounds().size.height - y };
    picker.showRelativeToRect_ofView_preferredEdge(NSRect::new(NSPoint::new(x, y), NSSize::new(1.0, 1.0)), view, NSRectEdge::MinY);
    SHOWN.with(|shown| *shown.borrow_mut() = Some(picker));
}
