//! Quick Look on Space: the system's preview panel, fed the selected files. The panel takes its items from the first
//! object of the key window's responder chain that accepts to control it; the web view of wry is the first responder
//! and its class is not ours, so a small responder of ours goes in the chain right after the window
//! (design.md section 8.4).

use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send, rc::Retained, runtime::ProtocolObject};
use objc2_app_kit::{NSResponder, NSWindow};
use objc2_foundation::{NSInteger, NSObjectProtocol, NSString, NSURL};
use objc2_quick_look_ui::{QLPreviewItem, QLPreviewPanel, QLPreviewPanelDataSource};
use std::{cell::RefCell, collections::HashMap, path::PathBuf};

define_class!(
    /// The controller of the panel for one window, and the source of its items.
    #[unsafe(super(NSResponder))]
    #[thread_kind = MainThreadOnly]
    #[name = "LZQuickLook"]
    #[ivars = RefCell<Vec<Retained<NSURL>>>]
    struct QuickLook;

    unsafe impl NSObjectProtocol for QuickLook {}

    unsafe impl QLPreviewPanelDataSource for QuickLook {
        #[unsafe(method(numberOfPreviewItemsInPreviewPanel:))]
        fn count(&self, _panel: Option<&QLPreviewPanel>) -> NSInteger {
            self.ivars().borrow().len() as NSInteger
        }

        #[unsafe(method_id(previewPanel:previewItemAtIndex:))]
        fn item(&self, _panel: Option<&QLPreviewPanel>, index: NSInteger) -> Option<Retained<ProtocolObject<dyn QLPreviewItem>>> {
            let urls = self.ivars().borrow();
            let url = usize::try_from(index).ok().and_then(|i| urls.get(i)).cloned();
            url.map(ProtocolObject::from_retained)
        }
    }

    impl QuickLook {
        #[unsafe(method(acceptsPreviewPanelControl:))]
        fn accepts(&self, _panel: Option<&QLPreviewPanel>) -> bool {
            true
        }

        #[unsafe(method(beginPreviewPanelControl:))]
        fn begin(&self, panel: Option<&QLPreviewPanel>) {
            if let Some(panel) = panel {
                // SAFETY: the responder lives as long as its window, which outlives the panel's use of it.
                unsafe {
                    panel.setDataSource(Some(ProtocolObject::from_ref(self)));
                    panel.reloadData();
                }
            }
        }

        #[unsafe(method(endPreviewPanelControl:))]
        fn end(&self, panel: Option<&QLPreviewPanel>) {
            if let Some(panel) = panel {
                // SAFETY: clearing the data source is always allowed.
                unsafe { panel.setDataSource(None) };
            }
        }
    }
);

impl QuickLook {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = mtm.alloc::<Self>().set_ivars(RefCell::new(Vec::new()));
        // SAFETY: NSResponder's init on a freshly allocated instance with its ivars set.
        unsafe { msg_send![super(this), init] }
    }
}

thread_local! {
    /// The controller of each window, by the window's address; it stays in the chain as long as the window does.
    static CONTROLLERS: RefCell<HashMap<usize, Retained<QuickLook>>> = RefCell::new(HashMap::new());
}

/// Opens the panel on `paths`, at `index`, or closes it when it is open.
pub fn toggle(mtm: MainThreadMarker, window: &NSWindow, paths: &[PathBuf], index: usize) {
    // SAFETY: the shared panel is created on the main thread, which `mtm` proves.
    let Some(panel) = (unsafe { QLPreviewPanel::sharedPreviewPanel(mtm) }) else { return };
    if panel.isVisible() {
        panel.orderOut(None);
        return;
    }
    if paths.is_empty() {
        return;
    }
    let controller = CONTROLLERS.with_borrow_mut(|all| {
        all.entry(window as *const NSWindow as usize)
            .or_insert_with(|| {
                let controller = QuickLook::new(mtm);
                // SAFETY: the window's responder chain is changed on the main thread; the old next responder goes
                // after ours, so nothing in the chain is lost.
                unsafe {
                    controller.setNextResponder(window.nextResponder().as_deref());
                    window.setNextResponder(Some(&controller));
                }
                controller
            })
            .clone()
    });
    *controller.ivars().borrow_mut() = paths.iter().map(|p| NSURL::fileURLWithPath(&NSString::from_str(&p.to_string_lossy()))).collect();
    // SAFETY: the panel is told to look for its controller again and to read the new items.
    unsafe {
        panel.updateController();
        panel.reloadData();
        panel.setCurrentPreviewItemIndex(index.min(paths.len() - 1) as NSInteger);
    }
    panel.makeKeyAndOrderFront(None);
}

/// Forgets the controller of a window that closed.
pub fn forget(window: &NSWindow) {
    CONTROLLERS.with_borrow_mut(|all| all.remove(&(window as *const NSWindow as usize)));
}
