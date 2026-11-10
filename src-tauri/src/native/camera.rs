//! Phones and cameras as Image Capture reads them (ImageCaptureCore): an iPhone or iPad, a camera, an Android phone
//! set to transfer photos (PTP). The framework is driven from the main thread, where its browser was started and where
//! its delegate hears of devices and their files; the objects it hands out stay there. What other threads need is kept
//! beside them as plain data: the devices with how far each is (`Camera`), and each device's files as a tree
//! (`Node`), made again from the framework's catalog when that changed. A provider on another thread asks the main
//! thread for the rest (`on_main`) and waits for the answer, never the other way round.

use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::{MainThreadMarker, MainThreadOnly, Message, define_class, msg_send, rc::Retained, runtime::ProtocolObject};
use objc2_foundation::{NSArray, NSData, NSDate, NSError, NSObject, NSObjectProtocol};
use objc2_image_capture_core::{
    ICCameraDevice, ICCameraDeviceDelegate, ICCameraDeviceSupportsHEIF, ICCameraFile, ICCameraFolder, ICCameraItem, ICDevice, ICDeviceBrowser, ICDeviceBrowserDelegate, ICDeviceDelegate, ICDeviceLocationTypeMask,
    ICDeviceTypeMask, ICMediaPresentation, ICTransportTypeExFAT, ICTransportTypeMassStorage,
};
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    sync::{
        Arc, Condvar, LazyLock, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

/// How far the app is with a device.
#[derive(Debug, Clone, PartialEq)]
pub enum Phase {
    /// Seen, not opened yet: a device is opened the first time it is browsed.
    Closed,
    Opening,
    /// Open, its catalog being read; the percent read so far.
    Reading(u32),
    /// Open with its whole catalog.
    Ready,
    /// An iPhone or iPad that is locked with a passcode, or does not trust this Mac yet.
    Restricted,
    Failed(String),
}

/// A device ImageCaptureCore found.
#[derive(Debug, Clone, PartialEq)]
pub struct Camera {
    /// Its name in `device://<key>/`: from where it is plugged in, so the disk watcher (IOKit) names it alike.
    pub key: String,
    pub name: String,
    /// The USB location id, 0 for a device not on USB.
    pub location: u32,
    /// The USB vendor and product ids.
    pub ids: (u16, u16),
    pub phase: Phase,
}

/// A file or folder of a device, as its catalog has it. `item` is the item's place in the list the main thread keeps.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Node {
    pub name: String,
    pub dir: bool,
    pub size: u64,
    /// Seconds since 1970.
    pub mtime: i64,
    pub item: usize,
    pub children: Vec<Node>,
}

/// What a device has to show when browsed.
#[derive(Debug, Clone, PartialEq)]
pub enum Catalog {
    /// No such device: it was unplugged, or ImageCaptureCore does not see it.
    Missing,
    Restricted,
    Failed(String),
    /// Its files, and whether the catalog was read to the end.
    Files { root: Arc<Node>, complete: bool },
}

/// What changed, for the pages.
pub enum Change {
    /// A device came, went, or got further.
    Devices,
    /// The files of the device with this key changed, or were all read.
    Files(String),
}

#[derive(Default)]
struct Shared {
    cameras: Vec<Camera>,
    trees: HashMap<String, Arc<Node>>,
    /// The devices whose tree must be made again before it is used.
    stale: HashSet<String>,
}

/// What other threads read, and the condition they wait on for a device to get further.
static SHARED: LazyLock<(Mutex<Shared>, Condvar)> = LazyLock::new(|| (Mutex::new(Shared::default()), Condvar::new()));

/// What is told of each change, on the main thread.
type OnChange = Box<dyn Fn(Change)>;

/// The framework's objects for one device, on the main thread only.
struct Live {
    device: Retained<ICCameraDevice>,
    /// The items of the last tree made, by `Node::item`.
    items: Vec<Retained<ICCameraItem>>,
}

thread_local! {
    static LIVE: RefCell<HashMap<String, Live>> = RefCell::new(HashMap::new());
    static BROWSER: RefCell<Option<(Retained<ICDeviceBrowser>, Retained<Watcher>)>> = const { RefCell::new(None) };
    static ON_CHANGE: RefCell<Option<OnChange>> = const { RefCell::new(None) };
}

define_class!(
    /// The delegate of the browser and of every device it finds.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "LZCameraWatcher"]
    struct Watcher;

    unsafe impl NSObjectProtocol for Watcher {}

    unsafe impl ICDeviceBrowserDelegate for Watcher {
        #[unsafe(method(deviceBrowser:didAddDevice:moreComing:))]
        fn added(&self, _browser: &ICDeviceBrowser, device: &ICDevice, _more: bool) {
            add(self, device);
        }

        #[unsafe(method(deviceBrowser:didRemoveDevice:moreGoing:))]
        fn removed(&self, _browser: &ICDeviceBrowser, device: &ICDevice, _more: bool) {
            remove(device);
        }

        #[unsafe(method(deviceBrowser:deviceDidChangeName:))]
        fn renamed(&self, _browser: &ICDeviceBrowser, device: &ICDevice) {
            let name = name_of(device);
            update(&key_of(device), |c| c.name = name);
        }
    }

    unsafe impl ICDeviceDelegate for Watcher {
        #[unsafe(method(device:didCloseSessionWithError:))]
        fn closed(&self, device: &ICDevice, _error: Option<&NSError>) {
            let key = key_of(device);
            if let Ok(mut shared) = SHARED.0.lock() {
                shared.trees.remove(&key);
            }
            update(&key, |c| c.phase = Phase::Closed);
        }

        #[unsafe(method(didRemoveDevice:))]
        fn gone(&self, device: &ICDevice) {
            remove(device);
        }

        #[unsafe(method(device:didOpenSessionWithError:))]
        fn opened(&self, device: &ICDevice, error: Option<&NSError>) {
            let phase = match error {
                _ if restricted(device) => Phase::Restricted,
                Some(error) => Phase::Failed(error.localizedDescription().to_string()),
                None => Phase::Reading(percent(device)),
            };
            update(&key_of(device), |c| c.phase = phase);
        }
    }

    unsafe impl ICCameraDeviceDelegate for Watcher {
        #[unsafe(method(cameraDevice:didAddItems:))]
        fn items_added(&self, camera: &ICCameraDevice, _items: &NSArray<ICCameraItem>) {
            files_changed(camera);
        }

        #[unsafe(method(cameraDevice:didRemoveItems:))]
        fn items_removed(&self, camera: &ICCameraDevice, _items: &NSArray<ICCameraItem>) {
            files_changed(camera);
        }

        #[unsafe(method(cameraDevice:didRenameItems:))]
        fn items_renamed(&self, camera: &ICCameraDevice, _items: &NSArray<ICCameraItem>) {
            files_changed(camera);
        }

        #[unsafe(method(cameraDevice:didReceiveThumbnail:forItem:error:))]
        fn thumbnail(&self, _camera: &ICCameraDevice, _thumbnail: Option<&objc2_core_graphics::CGImage>, _item: &ICCameraItem, _error: Option<&NSError>) {}

        #[unsafe(method(cameraDevice:didReceiveMetadata:forItem:error:))]
        fn metadata(&self, _camera: &ICCameraDevice, _metadata: Option<&objc2_foundation::NSDictionary>, _item: &ICCameraItem, _error: Option<&NSError>) {}

        #[unsafe(method(cameraDeviceDidChangeCapability:))]
        fn capability(&self, _camera: &ICCameraDevice) {}

        #[unsafe(method(cameraDevice:didReceivePTPEvent:))]
        fn ptp_event(&self, _camera: &ICCameraDevice, _data: &NSData) {}

        #[unsafe(method(deviceDidBecomeReadyWithCompleteContentCatalog:))]
        fn ready(&self, camera: &ICCameraDevice) {
            let key = key_of(camera);
            let phase = if restricted(camera) { Phase::Restricted } else { Phase::Ready };
            mark_stale(&key);
            update(&key, |c| c.phase = phase);
            notify(Change::Files(key));
        }

        #[unsafe(method(cameraDeviceDidRemoveAccessRestriction:))]
        fn unlocked(&self, device: &ICDevice) {
            // Unlocked and trusted: the catalog comes now, or once the device is opened again.
            let key = key_of(device);
            mark_stale(&key);
            let camera = device.downcast_ref::<ICCameraDevice>();
            let open = camera.is_some_and(|c| unsafe { c.hasOpenSession() });
            update(&key, |c| c.phase = if open { Phase::Reading(0) } else { Phase::Closed });
            if let (Some(camera), false) = (camera, open) {
                unsafe { camera.requestOpenSession() };
                update(&key, |c| c.phase = Phase::Opening);
            }
            notify(Change::Files(key));
        }

        #[unsafe(method(cameraDeviceDidEnableAccessRestriction:))]
        fn locked(&self, device: &ICDevice) {
            update(&key_of(device), |c| c.phase = Phase::Restricted);
        }
    }
);

impl Watcher {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        // SAFETY: NSObject's init on a freshly allocated instance.
        unsafe { msg_send![mtm.alloc::<Self>(), init] }
    }
}

/// Starts looking for phones and cameras on this Mac, for the life of the app; `on_change` is called on the main thread
/// each time one comes, goes, gets further, or its files change.
pub fn start(mtm: MainThreadMarker, on_change: impl Fn(Change) + 'static) {
    ON_CHANGE.with(|c| *c.borrow_mut() = Some(Box::new(on_change)));
    let watcher = Watcher::new(mtm);
    // SAFETY: the browser and its delegate are kept below for the life of the app, so the weak delegate never dangles.
    let browser = unsafe {
        let browser = ICDeviceBrowser::new();
        browser.setDelegate(Some(ProtocolObject::from_ref(&*watcher)));
        browser.setBrowsedDeviceTypeMask(ICDeviceTypeMask(ICDeviceTypeMask::Camera.0 | ICDeviceLocationTypeMask::Local.0));
        browser.start();
        browser
    };
    BROWSER.with(|b| *b.borrow_mut() = Some((browser, watcher)));
}

/// The devices found, in the order they came.
pub fn cameras() -> Vec<Camera> {
    SHARED.0.lock().map(|s| s.cameras.clone()).unwrap_or_default()
}

/// The name a device goes by in `device://`: `usb-` and its USB location in hex, the same as the disk watcher makes of
/// the location IOKit gives, or `ic-` and its id for a device on no USB port.
pub fn key_for(location: u32, uuid: &str) -> String {
    if location != 0 {
        return format!("usb-{location:08x}");
    }
    let id: String = uuid.chars().filter(char::is_ascii_alphanumeric).collect::<String>().to_ascii_lowercase();
    format!("ic-{id}")
}

fn key_of(device: &ICDevice) -> String {
    // SAFETY: plain getters of a device the framework handed us.
    let (location, uuid) = unsafe { (device.usbLocationID() as u32, device.UUIDString()) };
    key_for(location, &uuid.map(|u| u.to_string()).unwrap_or_default())
}

fn name_of(device: &ICDevice) -> String {
    // SAFETY: a plain getter.
    unsafe { device.name() }.map(|n| n.to_string()).filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "Camera".into())
}

fn restricted(device: &ICDevice) -> bool {
    // SAFETY: a plain getter of a camera device.
    device.downcast_ref::<ICCameraDevice>().is_some_and(|c| unsafe { c.isAccessRestrictedAppleDevice() })
}

fn percent(device: &ICDevice) -> u32 {
    // SAFETY: a plain getter of a camera device.
    device.downcast_ref::<ICCameraDevice>().map_or(0, |c| unsafe { c.contentCatalogPercentCompleted() }.min(100) as u32)
}

fn notify(change: Change) {
    ON_CHANGE.with(|c| {
        if let Some(on) = c.borrow().as_ref() {
            on(change);
        }
    });
}

/// Changes what other threads know of a device, wakes those waiting on it and tells the pages.
fn update(key: &str, change: impl FnOnce(&mut Camera)) {
    let (lock, woken) = &*SHARED;
    let Ok(mut shared) = lock.lock() else { return };
    let Some(camera) = shared.cameras.iter_mut().find(|c| c.key == key) else { return };
    let before = camera.clone();
    change(camera);
    let changed = *camera != before;
    drop(shared);
    woken.notify_all();
    if changed {
        notify(Change::Devices);
    }
}

fn mark_stale(key: &str) {
    if let Ok(mut shared) = SHARED.0.lock() {
        shared.stale.insert(key.to_owned());
    }
}

fn add(watcher: &Watcher, device: &ICDevice) {
    let Some(camera) = device.downcast_ref::<ICCameraDevice>() else { return };
    // SAFETY: plain getters and setters of a device the framework handed us, on the main thread where it lives; the
    // delegate is kept for the life of the app (BROWSER).
    unsafe {
        // A memory card or a camera that mounts as a disk is in the sidebar's disks already.
        let transport = device.transportType();
        if transport.is_some_and(|t| t.isEqualToString(ICTransportTypeMassStorage) || t.isEqualToString(ICTransportTypeExFAT)) {
            return;
        }
        // An iPhone gives its photos as they were taken (HEIC, HEVC), with the sizes it lists, rather than converted.
        if camera.capabilities().iter().any(|c| c.isEqualToString(ICCameraDeviceSupportsHEIF)) {
            camera.setMediaPresentation(ICMediaPresentation::OriginalAssets);
        }
        camera.setDelegate(Some(ProtocolObject::from_ref(watcher)));
    }
    let key = key_of(device);
    // SAFETY: plain getters.
    let (location, ids) = unsafe { (device.usbLocationID() as u32, (device.usbVendorID() as u16, device.usbProductID() as u16)) };
    let entry = Camera { key: key.clone(), name: name_of(device), location, ids, phase: Phase::Closed };
    LIVE.with(|live| live.borrow_mut().insert(key.clone(), Live { device: camera.retain(), items: Vec::new() }));
    if let Ok(mut shared) = SHARED.0.lock() {
        shared.cameras.retain(|c| c.key != key);
        shared.cameras.push(entry);
        shared.trees.remove(&key);
    }
    SHARED.1.notify_all();
    notify(Change::Devices);
}

fn remove(device: &ICDevice) {
    let key = key_of(device);
    let known = LIVE.with(|live| live.borrow_mut().remove(&key)).is_some();
    if let Ok(mut shared) = SHARED.0.lock() {
        shared.cameras.retain(|c| c.key != key);
        shared.trees.remove(&key);
        shared.stale.remove(&key);
    }
    SHARED.1.notify_all();
    if known {
        notify(Change::Devices);
    }
}

fn files_changed(camera: &ICCameraDevice) {
    let key = key_of(camera);
    mark_stale(&key);
    let ready = SHARED.0.lock().is_ok_and(|s| s.cameras.iter().any(|c| c.key == key && c.phase == Phase::Ready));
    if ready {
        notify(Change::Files(key));
    } else {
        // While the catalog is read, the percent goes up; the page hears of it with the device.
        let now = percent(camera);
        update(&key, |c| {
            if matches!(c.phase, Phase::Opening | Phase::Reading(_)) {
                c.phase = Phase::Reading(now);
            }
        });
    }
}

/// Opens the device for browsing, when it is not open yet.
fn open(_mtm: MainThreadMarker, key: &str) -> bool {
    let device = LIVE.with(|live| live.borrow().get(key).map(|l| l.device.clone()));
    let Some(device) = device else { return false };
    let phase = SHARED.0.lock().ok().and_then(|s| s.cameras.iter().find(|c| c.key == key).map(|c| c.phase.clone()));
    // SAFETY: asking a device the framework handed us to open, on the main thread.
    if matches!(phase, Some(Phase::Closed | Phase::Failed(_))) && !unsafe { device.hasOpenSession() } {
        update(key, |c| c.phase = Phase::Opening);
        unsafe { device.requestOpenSession() };
    } else if restricted(&device) {
        update(key, |c| c.phase = Phase::Restricted);
    }
    true
}

/// The tree of the device's files, made again from the framework's catalog when it changed since.
fn tree(_mtm: MainThreadMarker, key: &str) -> Option<Arc<Node>> {
    let fresh = SHARED.0.lock().ok().and_then(|s| if s.stale.contains(key) { None } else { s.trees.get(key).cloned() });
    if let Some(tree) = fresh {
        return Some(tree);
    }
    let device = LIVE.with(|live| live.borrow().get(key).map(|l| l.device.clone()))?;
    let mut items = Vec::new();
    // SAFETY: the catalog of a device the framework handed us, read on the main thread.
    let top = unsafe { device.contents() };
    let root = Arc::new(Node { name: String::new(), dir: true, children: nodes_of(top.as_deref(), &mut items, 0), ..Node::default() });
    LIVE.with(|live| {
        if let Some(l) = live.borrow_mut().get_mut(key) {
            l.items = items;
        }
    });
    if let Ok(mut shared) = SHARED.0.lock() {
        shared.stale.remove(key);
        shared.trees.insert(key.to_owned(), root.clone());
    }
    Some(root)
}

/// The deepest a catalog is followed, against a device that reports a folder inside itself.
const MAX_DEPTH: usize = 32;

fn nodes_of(list: Option<&NSArray<ICCameraItem>>, items: &mut Vec<Retained<ICCameraItem>>, depth: usize) -> Vec<Node> {
    let Some(list) = list.filter(|_| depth < MAX_DEPTH) else { return Vec::new() };
    let mut nodes = Vec::new();
    for item in list.iter() {
        // SAFETY: plain getters of the items of a catalog, on the main thread.
        let name = unsafe { item.name() }.map(|n| n.to_string()).unwrap_or_default();
        let date = |d: Option<Retained<NSDate>>| d.map_or(0, |d| d.timeIntervalSince1970() as i64);
        let mtime = unsafe { date(item.modificationDate()).max(date(item.creationDate())) };
        let mut node = Node { name, mtime, item: items.len(), ..Node::default() };
        if let Some(folder) = item.downcast_ref::<ICCameraFolder>() {
            node.dir = true;
            // SAFETY: as above.
            node.children = nodes_of(unsafe { folder.contents() }.as_deref(), items, depth + 1);
        } else if let Some(file) = item.downcast_ref::<ICCameraFile>() {
            // SAFETY: as above.
            node.size = unsafe { file.fileSize() }.max(0) as u64;
        } else {
            continue;
        }
        items.push(item);
        nodes.push(node);
    }
    tidy(&mut nodes);
    nodes
}

/// Gives the items of a folder names a path can hold: a slash reads as a colon, as Finder shows it, an empty name is
/// replaced, and a name met twice gets a number, so each item has a path of its own.
pub fn tidy(nodes: &mut [Node]) {
    let mut taken = HashSet::new();
    for node in nodes.iter_mut() {
        let mut name = node.name.replace('/', ":").replace('\0', "");
        if name.trim().is_empty() || name == "." || name == ".." {
            name = "_".into();
        }
        let wanted = name.clone();
        let mut n = 2;
        while !taken.insert(name.to_lowercase()) {
            name = numbered(&wanted, n, node.dir);
            n += 1;
        }
        node.name = name;
    }
}

/// `IMG_1.JPG` as `IMG_1 (2).JPG`; a folder's name has no extension to keep.
fn numbered(name: &str, n: u32, dir: bool) -> String {
    match name.rfind('.').filter(|&i| i > 0 && !dir) {
        Some(i) => format!("{} ({n}){}", &name[..i], &name[i..]),
        None => format!("{name} ({n})"),
    }
}

/// The node at `path` (`/DCIM/100APPLE/IMG_0001.HEIC`) in a tree; the root for `/`.
pub fn find<'a>(root: &'a Node, path: &str) -> Option<&'a Node> {
    path.split('/').filter(|p| !p.is_empty()).try_fold(root, |node, part| node.children.iter().find(|c| c.name == part))
}

/// The files of a device, after waiting up to `patience` for its catalog to be read whole. Off the main thread the
/// device is opened if needed and waited for; on it, what is there is given at once, as nothing may wait there.
pub fn catalog(key: &str, patience: Duration, cancel: &AtomicBool) -> Catalog {
    let key_owned = key.to_owned();
    if !on_main(move |mtm| open(mtm, &key_owned)).unwrap_or(false) {
        return Catalog::Missing;
    }
    let started = Instant::now();
    let (lock, woken) = &*SHARED;
    let phase = loop {
        let Ok(shared) = lock.lock() else { return Catalog::Missing };
        let Some(phase) = shared.cameras.iter().find(|c| c.key == key).map(|c| c.phase.clone()) else { return Catalog::Missing };
        let waiting = matches!(phase, Phase::Closed | Phase::Opening | Phase::Reading(_));
        if !waiting || MainThreadMarker::new().is_some() || started.elapsed() >= patience || cancel.load(Ordering::Relaxed) {
            break phase;
        }
        drop(woken.wait_timeout(shared, Duration::from_millis(250)));
    };
    match phase {
        Phase::Restricted => return Catalog::Restricted,
        Phase::Failed(error) => return Catalog::Failed(error),
        _ => {}
    }
    let key_owned = key.to_owned();
    match on_main(move |mtm| tree(mtm, &key_owned)) {
        Ok(Some(root)) => Catalog::Files { root, complete: phase == Phase::Ready },
        _ => Catalog::Missing,
    }
}

/// Reads `length` bytes of the file at `path` on a device from `offset`. Off the main thread only: the bytes come on a
/// queue of the framework's and are waited for here.
pub fn read(key: &str, path: &str, offset: u64, length: u64) -> Result<Vec<u8>, String> {
    let (sender, received) = mpsc::channel::<Result<Vec<u8>, String>>();
    let (key, path) = (key.to_owned(), path.to_owned());
    let asked = on_main(move |mtm| {
        let _ = tree(mtm, &key);
        let item = SHARED.0.lock().ok().and_then(|s| s.trees.get(&key).and_then(|t| find(t, &path)).filter(|n| !n.dir).map(|n| n.item));
        let file = item.and_then(|i| LIVE.with(|live| live.borrow().get(&key).and_then(|l| l.items.get(i).cloned())));
        let Some(file) = file.and_then(|f| f.downcast::<ICCameraFile>().ok()) else { return false };
        let sender = Mutex::new(Some(sender));
        let done = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
            // SAFETY: the framework passes a live data or error, or null, for the length of the call.
            let result = match unsafe { (data.as_ref(), error.as_ref()) } {
                (Some(data), _) => Ok(data.to_vec()),
                (None, Some(error)) => Err(error.localizedDescription().to_string()),
                (None, None) => Ok(Vec::new()),
            };
            if let Some(sender) = sender.lock().ok().and_then(|mut s| s.take()) {
                let _ = sender.send(result);
            }
        });
        // SAFETY: the block is copied by the framework and called once, on a queue of its own.
        unsafe { file.requestReadDataAtOffset_length_completion(offset as libc::off_t, length as libc::off_t, &done) };
        true
    })?;
    if !asked {
        return Err(crate::tr("Tệp không còn trên thiết bị", "The file is no longer on the device").into());
    }
    match received.recv_timeout(Duration::from_secs(120)) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => Err(crate::tr("Thiết bị không trả lời", "The device does not answer").into()),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(crate::tr("Thiết bị đã ngắt kết nối", "The device was disconnected").into()),
    }
}

/// A closure sent to the main thread, which is where it runs; what it holds is used there only.
struct ToMain<F>(F);
// SAFETY: the closure is only called on the main thread (checked with MainThreadMarker), and what it captures is plain
// data or objects of the framework that are retained and released from any thread.
unsafe impl<F> Send for ToMain<F> {}

impl<F> ToMain<F> {
    fn into_inner(self) -> F {
        self.0
    }
}

/// Runs `work` on the main thread and gives back what it returns: at once on the main thread, else by its queue,
/// waiting for the answer.
fn on_main<T: Send + 'static>(work: impl FnOnce(MainThreadMarker) -> T + 'static) -> Result<T, String> {
    if let Some(mtm) = MainThreadMarker::new() {
        return Ok(work(mtm));
    }
    let (sender, received) = mpsc::channel();
    let work = ToMain(work);
    DispatchQueue::main().exec_async(move || {
        let work = work.into_inner();
        if let Some(mtm) = MainThreadMarker::new() {
            let _ = sender.send(work(mtm));
        }
    });
    received.recv_timeout(Duration::from_secs(30)).map_err(|_| crate::tr("Ứng dụng đang bận, hãy thử lại", "The app is busy, try again").to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf(name: &str, dir: bool) -> Node {
        Node { name: name.into(), dir, ..Node::default() }
    }

    #[test]
    fn a_device_is_named_by_where_it_is_plugged_in() {
        assert_eq!(key_for(0x1420_0000, "ABC"), "usb-14200000");
        assert_eq!(key_for(0x0010_0000, ""), "usb-00100000");
        assert_eq!(key_for(0, "5F1A-22B0-xyz"), "ic-5f1a22b0xyz");
    }

    #[test]
    fn names_in_a_folder_are_made_unique_and_valid() {
        let mut nodes = vec![leaf("IMG_1.JPG", false), leaf("img_1.jpg", false), leaf("a/b", false), leaf("", false), leaf("DCIM", true), leaf("DCIM", true), leaf("IMG_1.JPG", false)];
        tidy(&mut nodes);
        let names: Vec<&str> = nodes.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, ["IMG_1.JPG", "img_1 (2).jpg", "a:b", "_", "DCIM", "DCIM (2)", "IMG_1 (3).JPG"]);
    }

    #[test]
    fn a_path_is_found_in_the_tree() {
        let mut dcim = leaf("DCIM", true);
        let mut apple = leaf("100APPLE", true);
        apple.children = vec![Node { name: "IMG_0001.HEIC".into(), size: 7, item: 3, ..Node::default() }];
        dcim.children = vec![apple];
        let root = Node { dir: true, children: vec![dcim], ..Node::default() };
        assert_eq!(find(&root, "/"), Some(&root));
        assert_eq!(find(&root, "/DCIM/100APPLE/IMG_0001.HEIC").map(|n| (n.size, n.item)), Some((7, 3)));
        assert_eq!(find(&root, "DCIM//100APPLE/").map(|n| n.name.as_str()), Some("100APPLE"));
        assert_eq!(find(&root, "/DCIM/101APPLE"), None);
        assert_eq!(find(&root, "/dcim"), None, "names are matched as the device writes them");
    }
}
