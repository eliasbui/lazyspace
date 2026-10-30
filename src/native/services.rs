//! "Open in LazySpace" among the Services of other apps: Finder lists it in the menu of a folder or a file, and every
//! app under Services, as Info.plist declares it (scripts/bundle-macos.sh, `NSServices`). macOS starts LazySpace when it
//! is not running and hands the items over on a pasteboard; they open as "Show in LazySpace" does (a folder in a new
//! tab, anything else in its folder with it selected, src/features/viewer.rs).

use crate::{Proxy, UserEvent, clipboard, features::viewer};
use objc2::{MainThreadMarker, MainThreadOnly, define_class, msg_send, rc::Retained};
use objc2_app_kit::{NSApplication, NSPasteboard, NSUpdateDynamicServices};
use objc2_foundation::{NSObject, NSObjectProtocol, NSString};
use std::sync::{Mutex, OnceLock};

/// Where the items go: the event loop, which holds the App.
static PROXY: OnceLock<Mutex<Proxy>> = OnceLock::new();

define_class!(
    /// The object macOS sends the service's message to.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "LZServices"]
    struct Services;

    unsafe impl NSObjectProtocol for Services {}

    impl Services {
        /// `NSMessage` of the service in Info.plist, with the arguments AppKit sends a service.
        #[unsafe(method(openInLazySpace:userData:error:))]
        fn open_in_lazyspace(&self, pasteboard: &NSPasteboard, _data: Option<&NSString>, _error: *mut *mut NSString) {
            let paths = clipboard::read_from(pasteboard);
            if paths.is_empty() {
                return;
            }
            if let Some(proxy) = PROXY.get().and_then(|p| p.lock().ok()) {
                proxy.send(UserEvent::Main(Box::new(move |app| viewer::show(app, &paths))));
            }
        }
    }
);

/// Makes LazySpace the provider of its services, and has macOS read them again so that a copy just installed offers
/// them without a new login. Does nothing off the main thread.
pub fn install(proxy: Proxy) {
    let Some(mtm) = MainThreadMarker::new() else { return };
    let _ = PROXY.set(Mutex::new(proxy));
    // SAFETY: NSObject's init on a freshly allocated instance of a class without ivars.
    let services: Retained<Services> = unsafe { msg_send![mtm.alloc::<Services>(), init] };
    // SAFETY: the provider answers the message Info.plist names, with the signature AppKit calls a service by.
    unsafe { NSApplication::sharedApplication(mtm).setServicesProvider(Some(&services)) };
    // It serves for as long as the app runs.
    std::mem::forget(services);
    NSUpdateDynamicServices();
}
