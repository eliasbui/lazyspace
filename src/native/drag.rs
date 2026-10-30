//! Dragging files out of the list to Finder, another app or another pane, as a real drag of file URLs. The page arms
//! the drag on a press on selected rows (`drag.arm`); a monitor of the app's own events then starts the session from
//! the first real drag event past a few points, which AppKit needs as the event of the session, and keeps that event
//! from WebKit (design.md section 8.2). A press that ends without moving disarms it.

use block2::RcBlock;
use objc2::{MainThreadMarker, MainThreadOnly, define_class, msg_send, rc::Retained, runtime::{AnyObject, ProtocolObject}};
use objc2_app_kit::{NSDragOperation, NSDraggingContext, NSDraggingItem, NSDraggingSession, NSDraggingSource, NSEvent, NSEventMask, NSEventType, NSPasteboardWriting, NSView, NSWorkspace};
use objc2_foundation::{NSArray, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString, NSURL};
use std::{cell::{Cell, RefCell}, path::PathBuf, ptr::NonNull};

/// How far the pointer moves, in points, before a press becomes a drag.
const THRESHOLD: f64 = 4.0;
/// The most icons drawn under the pointer; the rest are carried without one.
const MAX_ICONS: usize = 8;

define_class!(
    /// The source of the drag: copy or move within the app, also link outside it, as Finder offers.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "LZDragSource"]
    struct DragSource;

    unsafe impl NSObjectProtocol for DragSource {}

    unsafe impl NSDraggingSource for DragSource {
        #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
        fn mask(&self, _session: &NSDraggingSession, context: NSDraggingContext) -> NSDragOperation {
            if context == NSDraggingContext::WithinApplication {
                NSDragOperation::Copy | NSDragOperation::Move | NSDragOperation::Generic
            } else {
                NSDragOperation::Copy | NSDragOperation::Move | NSDragOperation::Link | NSDragOperation::Generic
            }
        }
    }
);

impl DragSource {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        // SAFETY: NSObject's init on a freshly allocated instance.
        unsafe { msg_send![mtm.alloc::<Self>(), init] }
    }
}

struct Armed {
    monitor: Retained<AnyObject>,
    _handler: RcBlock<dyn Fn(NonNull<NSEvent>) -> *mut NSEvent>,
}

thread_local! {
    static ARMED: RefCell<Option<Armed>> = const { RefCell::new(None) };
    /// The source of the drag under way; AppKit does not keep it, so it lives until the next drag.
    static SOURCE: RefCell<Option<Retained<DragSource>>> = const { RefCell::new(None) };
}

/// Readies a drag of `paths` from `view`; nothing happens unless the pointer, still pressed, moves past the threshold.
pub fn arm(mtm: MainThreadMarker, view: Retained<NSView>, paths: Vec<PathBuf>) {
    disarm();
    // The press may already be over (a quick click), and a drag must never start without one.
    if NSEvent::pressedMouseButtons() & 1 == 0 || paths.is_empty() {
        return;
    }
    let origin: Cell<Option<NSPoint>> = Cell::new(None);
    let started = Cell::new(false);
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit passes a live event for the length of the call.
        let e = unsafe { event.as_ref() };
        if started.get() {
            return event.as_ptr();
        }
        match e.r#type() {
            NSEventType::LeftMouseUp => {
                later_disarm();
                event.as_ptr()
            }
            NSEventType::LeftMouseDragged => {
                let point = e.locationInWindow();
                let first = origin.get().unwrap_or_else(|| {
                    origin.set(Some(point));
                    point
                });
                if (point.x - first.x).hypot(point.y - first.y) < THRESHOLD {
                    return event.as_ptr();
                }
                started.set(true);
                begin(mtm, &view, &paths, e);
                later_disarm();
                // The event is the session's now; WebKit must not see it and start a drag of its own.
                std::ptr::null_mut()
            }
            _ => event.as_ptr(),
        }
    });
    let mask = NSEventMask::LeftMouseDragged | NSEventMask::LeftMouseUp;
    // SAFETY: the handler returns the event it was given, or null to keep it from the app, as monitors may.
    if let Some(monitor) = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &handler) } {
        ARMED.set(Some(Armed { monitor, _handler: handler }));
    }
}

pub fn disarm() {
    if let Some(armed) = ARMED.take() {
        // SAFETY: the monitor was returned by addLocalMonitorForEventsMatchingMask_handler and is removed once.
        unsafe { NSEvent::removeMonitor(&armed.monitor) };
    }
}

/// A monitor is not removed from inside its own handler; the main queue does it right after.
fn later_disarm() {
    dispatch2::DispatchQueue::main().exec_async(disarm);
}

fn begin(mtm: MainThreadMarker, view: &NSView, paths: &[PathBuf], event: &NSEvent) {
    let at = view.convertPoint_fromView(event.locationInWindow(), None);
    let workspace = NSWorkspace::sharedWorkspace();
    let items: Vec<Retained<NSDraggingItem>> = paths
        .iter()
        .enumerate()
        .map(|(i, path)| {
            let text = NSString::from_str(&path.to_string_lossy());
            let writer: Retained<ProtocolObject<dyn NSPasteboardWriting>> = ProtocolObject::from_retained(NSURL::fileURLWithPath(&text));
            let item = NSDraggingItem::initWithPasteboardWriter(mtm.alloc(), &writer);
            if i < MAX_ICONS {
                let icon = workspace.iconForFile(&text);
                let offset = i as f64 * 4.0;
                let y = if view.isFlipped() { at.y - 16.0 + offset } else { at.y - 16.0 - offset };
                let frame = NSRect::new(NSPoint::new(at.x - 16.0 + offset, y), NSSize::new(32.0, 32.0));
                // SAFETY: the contents are an NSImage, which a dragging item accepts.
                unsafe { item.setDraggingFrame_contents(frame, Some(&icon)) };
            }
            item
        })
        .collect();
    let source = DragSource::new(mtm);
    view.beginDraggingSessionWithItems_event_source(&NSArray::from_retained_slice(&items), event, ProtocolObject::from_ref(&*source));
    SOURCE.set(Some(source));
}
