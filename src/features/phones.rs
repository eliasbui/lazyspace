//! Phones and cameras as places: each one plugged in shows in the sidebar for as long as it is (`devices.phones`,
//! asked by the page and posted again on each change), and opens as `device://<key>/<path>`, its folders and files as
//! Image Capture lists them (src/native/camera.rs). They are read, never written: copying out of one to a folder or
//! dragging a file to another pane goes through the copy jobs, which read the file from the device bit by bit.
//!
//! Two watchers feed the list. IOKit (src/native/devices.rs) sees every phone and camera on USB at once, including an
//! Android phone that shares its files over MTP, which ImageCaptureCore may not see at all; ImageCaptureCore sees the
//! ones it can read, a moment later. Both name a device by its USB location, so they are told as one, and a place of a
//! device IOKit alone sees says why it cannot be opened rather than showing nothing.

use crate::{
    Proxy, UserEvent,
    ipc::{Dispatcher, event},
    native::{
        camera::{self, Camera, Catalog, Change, Node, Phase},
        devices::Device,
    },
    tr,
    vfs::{Capabilities, Commit, Entry, Provider, Uri, registry},
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    io::{self, Read},
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

pub const SCHEME: &str = "device";
/// Apple's USB vendor id.
const APPLE: u16 = 0x05AC;
/// How long a listing waits for a device's catalog to be read whole before it shows what is there.
const PATIENCE: Duration = Duration::from_secs(20);
/// How long a place waits for ImageCaptureCore to find a device IOKit already saw.
const FINDING: Duration = Duration::from_secs(6);
/// The bytes asked of a device at a time when a file is read.
const CHUNK: u64 = 4 << 20;

/// A phone or camera as the sidebar shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Phone {
    pub key: String,
    pub name: String,
    /// "apple", "camera" or "mtp", as `devices::classify` has it.
    pub kind: &'static str,
    pub uri: String,
    /// Whether ImageCaptureCore found it, so its files can be listed.
    pub readable: bool,
    /// "opening", "reading", "ready", "locked", "failed", or "" before it is opened.
    pub state: &'static str,
    /// How much of its catalog is read, while it is.
    pub percent: u32,
    /// The key IOKit gave it, when that is not `key`: the place a note of it opens still finds it.
    #[serde(skip)]
    pub alias: Option<String>,
}

/// The phones and cameras IOKit saw on USB, in the order they came.
static USB: Mutex<Vec<Device>> = Mutex::new(Vec::new());

/// The key of a device IOKit saw, the same as `camera::key_for` makes of the location ImageCaptureCore gives.
pub fn usb_key(device: &Device) -> String {
    if device.location != 0 { camera::key_for(device.location, "") } else { format!("io-{}", device.id) }
}

pub fn uri_of(key: &str) -> String {
    Uri { scheme: SCHEME.into(), authority: key.into(), path: "/".into() }.to_string()
}

/// The devices of both watchers as one list, by name: a device both see is shown once, with the name ImageCaptureCore
/// gives it (the one set on the phone) and the kind IOKit found. Both are matched by where they are plugged in, else
/// by their vendor and product ids when only one device of IOKit's has them.
pub fn merge(usb: &[Device], cameras: &[Camera]) -> Vec<Phone> {
    let mut phones: Vec<Phone> = Vec::new();
    let by_location = |c: &Camera| usb.iter().find(|d| usb_key(d) == c.key);
    let unmatched: Vec<&Device> = usb.iter().filter(|d| !cameras.iter().any(|c| c.key == usb_key(d))).collect();
    for camera in cameras {
        let by_ids = || {
            let alike: Vec<&&Device> = unmatched.iter().filter(|d| d.ids == camera.ids && camera.ids != (0, 0)).collect();
            (alike.len() == 1).then(|| *alike[0])
        };
        let seen = by_location(camera).or_else(by_ids);
        let alias = seen.map(usb_key).filter(|k| *k != camera.key);
        let kind = seen.map_or(if camera.ids.0 == APPLE { "apple" } else { "camera" }, |d| d.kind);
        let (state, percent) = match &camera.phase {
            Phase::Closed => ("", 0),
            Phase::Opening => ("opening", 0),
            Phase::Reading(p) => ("reading", *p),
            Phase::Ready => ("ready", 100),
            Phase::Restricted => ("locked", 0),
            Phase::Failed(_) => ("failed", 0),
        };
        phones.push(Phone { key: camera.key.clone(), name: camera.name.clone(), kind, uri: uri_of(&camera.key), readable: true, state, percent, alias });
    }
    for device in usb {
        let key = usb_key(device);
        if !phones.iter().any(|p| p.key == key || p.alias.as_deref() == Some(key.as_str())) {
            phones.push(Phone { name: device.name.clone(), kind: device.kind, uri: uri_of(&key), key, readable: false, state: "", percent: 0, alias: None });
        }
    }
    phones.sort_by_key(|p| (crate::vfs::fold(&p.name), p.key.clone()));
    phones
}

pub fn phones() -> Vec<Phone> {
    let usb = USB.lock().map(|u| u.clone()).unwrap_or_default();
    merge(&usb, &camera::cameras())
}

fn post_phones(proxy: &Proxy) {
    proxy.send(UserEvent::Post { window: None, message: event("devices.phones", json!(phones())) });
}

/// A phone or camera IOKit saw come; the sidebars of every window follow.
pub fn usb_added(proxy: &Proxy, device: Device) {
    if let Ok(mut usb) = USB.lock() {
        usb.retain(|d| d.id != device.id);
        usb.push(device);
    }
    post_phones(proxy);
}

pub fn usb_removed(proxy: &Proxy, id: u64) {
    if let Ok(mut usb) = USB.lock() {
        usb.retain(|d| d.id != id);
    }
    post_phones(proxy);
}

pub fn register(d: &mut Dispatcher) {
    registry().add(SCHEME, Arc::new(DeviceProvider));
    d.on_start(|app| {
        let Some(mtm) = objc2::MainThreadMarker::new() else { return };
        let proxy = app.proxy.clone();
        camera::start(mtm, move |change| match change {
            Change::Devices => post_phones(&proxy),
            Change::Files(key) => {
                proxy.send(UserEvent::Post { window: None, message: event("devices.files", json!({ "key": key, "uri": uri_of(&key) })) });
            }
        });
    });
    d.on("devices.phones", |_, _, _| Ok(json!(phones())));
}

/// Why a device that ImageCaptureCore does not read cannot be opened, by what IOKit says it is.
pub fn unreadable(kind: &str, name: &str) -> String {
    match kind {
        "mtp" => format!(
            "{name} {}",
            tr(
                "đang chia sẻ tệp qua MTP, mà macOS không đọc được. Trên điện thoại, kéo thanh thông báo xuống, chạm vào mục USB và chọn \"Truyền ảnh (PTP)\": ảnh và video sẽ hiện ở đây. Các tệp khác cần một ứng dụng MTP như OpenMTP hoặc Android File Transfer.",
                "shares its files over MTP, which macOS cannot read. On the phone, pull down the notifications, tap the USB one and choose \"Transfer photos (PTP)\": its photos and videos will show here. Other files need an MTP app such as OpenMTP or Android File Transfer.",
            )
        ),
        "apple" => locked(name),
        _ => format!(
            "{name} {}",
            tr(
                "chưa được Image Capture nhận ra. Hãy bật thiết bị, chọn chế độ kết nối máy tính (PTP) nếu có, hoặc rút ra cắm lại.",
                "is not recognised by Image Capture yet. Turn it on, choose its computer connection (PTP) mode if it has one, or unplug it and plug it in again.",
            )
        ),
    }
}

/// What an iPhone or iPad that will not open its files says.
pub fn locked(name: &str) -> String {
    format!(
        "{name} {}",
        tr(
            "đang khóa hoặc chưa tin cậy máy Mac này. Mở khóa thiết bị, chạm \"Tin cậy\" khi được hỏi và nhập mật mã, rồi mở lại.",
            "is locked or does not trust this Mac yet. Unlock it, tap \"Trust\" when it asks and enter its passcode, then open it again.",
        )
    )
}

fn not_connected() -> String {
    tr("Thiết bị không còn kết nối. Hãy cắm lại rồi mở từ thanh bên.", "The device is not connected. Plug it in again, then open it from the sidebar.").into()
}

fn read_only() -> String {
    tr("Không ghi được lên điện thoại hay máy ảnh: LazySpace chỉ đọc chúng.", "Nothing can be written to a phone or camera: LazySpace only reads them.").into()
}

/// The files of the device a place is on, with its name; an error that says why when there are none to show.
fn open(uri: &Uri, cancel: &AtomicBool, patience: Duration) -> Result<(Arc<Node>, bool, Phone), String> {
    let started = Instant::now();
    // ImageCaptureCore finds a device a moment after IOKit does.
    let phone = loop {
        let found = phones().into_iter().find(|p| p.key == uri.authority || p.alias.as_ref() == Some(&uri.authority));
        match found {
            Some(p) if p.readable => break p,
            _ if started.elapsed() < FINDING && !cancel.load(Ordering::Relaxed) && objc2::MainThreadMarker::new().is_none() => thread::sleep(Duration::from_millis(200)),
            Some(p) => return Err(unreadable(p.kind, &p.name)),
            None => return Err(not_connected()),
        }
    };
    match camera::catalog(&phone.key, patience, cancel) {
        Catalog::Missing => Err(not_connected()),
        Catalog::Restricted => Err(locked(&phone.name)),
        Catalog::Failed(error) if phone.kind == "mtp" => Err(format!("{error}. {}", unreadable("mtp", &phone.name))),
        Catalog::Failed(error) => Err(format!("{}: {error}", tr("Không mở được thiết bị", "The device could not be opened"))),
        Catalog::Files { root, complete } => Ok((root, complete, phone)),
    }
}

/// The tree of the device a single item is on: at once when the item is in what was read so far, as it is for each
/// file a copy goes through, else after waiting for the rest of the catalog.
fn located(uri: &Uri) -> Result<(Arc<Node>, Phone), String> {
    let (root, complete, phone) = open(uri, &AtomicBool::new(false), Duration::ZERO)?;
    if complete || camera::find(&root, &uri.path).is_some() {
        return Ok((root, phone));
    }
    open(uri, &AtomicBool::new(false), PATIENCE).map(|(root, _, phone)| (root, phone))
}

/// The entry of a node of a device's tree, in the folder `dir`.
pub fn entry_of(dir: &Uri, node: &Node) -> Entry {
    let ext = if node.dir { String::new() } else { Path::new(&node.name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default() };
    let icon = match (node.dir, ext.is_empty()) {
        (true, _) => "type:public.folder".to_owned(),
        (false, true) => "type:public.data".to_owned(),
        (false, false) => format!("ext:{ext}"),
    };
    Entry {
        name: node.name.clone(),
        uri: dir.join(&node.name).to_string(),
        kind: if node.dir { "dir" } else { "file" },
        is_dir: node.dir,
        size: if node.dir { 0 } else { node.size },
        mtime: node.mtime,
        ctime: node.mtime,
        hidden: node.name.starts_with('.'),
        ext,
        icon,
    }
}

/// The items of the folder `uri` in a device's tree.
pub fn list_in(root: &Node, uri: &Uri) -> Result<Vec<Entry>, String> {
    let node = camera::find(root, &uri.path).ok_or_else(|| format!("{}: {}", tr("Không tìm thấy", "Not found"), uri.path))?;
    if !node.dir {
        return Err(format!("{}: {}", tr("Không phải thư mục", "Not a folder"), uri.name()));
    }
    Ok(node.children.iter().map(|child| entry_of(uri, child)).collect())
}

pub struct DeviceProvider;

impl Provider for DeviceProvider {
    fn capabilities(&self, _: &Uri) -> Capabilities {
        Capabilities { write: false, rename: false, trash: false, watch: false, sizes: false, local_path: false }
    }

    fn list(&self, uri: &Uri, cancel: &AtomicBool) -> Result<Vec<Entry>, String> {
        let (root, complete, phone) = open(uri, cancel, PATIENCE)?;
        // A catalog read in part is shown as it is, and listed again when it is whole (`devices.files`); one with
        // nothing yet says it is being read rather than looking empty.
        if !complete && root.children.is_empty() {
            return Err(format!("{} {}...", tr("Đang đọc danh sách tệp trên", "Reading the list of files on"), phone.name));
        }
        list_in(&root, uri)
    }

    fn stat(&self, uri: &Uri) -> Result<Entry, String> {
        let (root, phone) = located(uri)?;
        let node = camera::find(&root, &uri.path).ok_or_else(|| format!("{}: {}", tr("Không tìm thấy", "Not found"), uri.path))?;
        match uri.parent() {
            None => Ok(Entry { name: phone.name, ..entry_of(uri, node) }),
            Some(parent) => Ok(entry_of(&parent, node)),
        }
    }

    fn read(&self, uri: &Uri) -> Result<Box<dyn Read + Send>, String> {
        let (root, phone) = located(uri)?;
        let node = camera::find(&root, &uri.path).filter(|n| !n.dir).ok_or_else(|| format!("{}: {}", tr("Không phải tệp", "Not a file"), uri.name()))?;
        Ok(Box::new(DeviceFile { key: phone.key, path: uri.path.clone(), size: node.size, offset: 0, buffer: Vec::new(), at: 0, fetch: camera::read }))
    }

    fn write(&self, _: &Uri) -> Result<Box<dyn Commit>, String> {
        Err(read_only())
    }

    fn mkdir(&self, _: &Uri) -> Result<(), String> {
        Err(read_only())
    }

    fn rename(&self, _: &Uri, _: &Uri) -> Result<(), String> {
        Err(read_only())
    }

    fn delete(&self, _: &Uri, _: &AtomicBool) -> Result<(), String> {
        Err(read_only())
    }
}

/// A file of a device read in chunks of `CHUNK` bytes, each asked of the device when the last is used up.
struct DeviceFile {
    key: String,
    path: String,
    size: u64,
    /// Where the next chunk starts.
    offset: u64,
    buffer: Vec<u8>,
    /// How much of `buffer` was given out.
    at: usize,
    fetch: Fetch,
}

/// How a chunk of a file is asked of a device: its key, the file's path, the offset and the length.
type Fetch = fn(&str, &str, u64, u64) -> Result<Vec<u8>, String>;

impl Read for DeviceFile {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if self.at >= self.buffer.len() {
            if self.offset >= self.size || out.is_empty() {
                return Ok(0);
            }
            let chunk = (self.fetch)(&self.key, &self.path, self.offset, CHUNK.min(self.size - self.offset)).map_err(io::Error::other)?;
            // A device that gives nothing back before the end would have the copy wait for ever.
            if chunk.is_empty() {
                return Err(io::Error::other(tr("Thiết bị ngừng gửi dữ liệu giữa chừng", "The device stopped sending the file part way")));
            }
            self.offset += chunk.len() as u64;
            self.buffer = chunk;
            self.at = 0;
        }
        let n = out.len().min(self.buffer.len() - self.at);
        out[..n].copy_from_slice(&self.buffer[self.at..self.at + n]);
        self.at += n;
        Ok(n)
    }
}

/// The note of a device IOKit saw come, with the place it opens as.
pub fn note_of(device: &Device) -> Value {
    let mut note = json!(device);
    note["uri"] = json!(uri_of(&usb_key(device)));
    note
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usb(id: u64, kind: &'static str, name: &str, location: u32) -> Device {
        Device { id, kind, name: name.into(), vendor: String::new(), location, ids: (0x1234, id as u16) }
    }

    fn camera(key: &str, name: &str, vendor: u16, phase: Phase) -> Camera {
        Camera { key: key.into(), name: name.into(), location: 0, ids: (vendor, 1), phase }
    }

    fn node(name: &str, dir: bool, size: u64, children: Vec<Node>) -> Node {
        Node { name: name.into(), dir, size, mtime: 1_700_000_000, item: 0, children }
    }

    fn tree() -> Node {
        node(
            "",
            true,
            0,
            vec![node(
                "DCIM",
                true,
                0,
                vec![node("100APPLE", true, 0, vec![node("IMG_0001.HEIC", false, 2_345_678, vec![]), node("Ảnh #1 50%.JPG", false, 12, vec![]), node("NOEXT", false, 3, vec![])]), node("101APPLE", true, 0, vec![])],
            )],
        )
    }

    #[test]
    fn both_watchers_make_one_list() {
        let devices = [usb(7, "apple", "iPhone", 0x1420_0000), usb(8, "mtp", "Pixel 8", 0x0010_0000), usb(9, "camera", "Canon", 0)];
        let cameras = [camera("usb-14200000", "Bao's iPhone", APPLE, Phase::Reading(40)), camera("ic-abc", "Wi-Fi Camera", 0x04A9, Phase::Ready)];
        let phones = merge(&devices, &cameras);
        let summary: Vec<(&str, &str, &str, bool, &str)> = phones.iter().map(|p| (p.key.as_str(), p.name.as_str(), p.kind, p.readable, p.state)).collect();
        assert_eq!(
            summary,
            [
                ("usb-14200000", "Bao's iPhone", "apple", true, "reading"),
                ("io-9", "Canon", "camera", false, ""),
                ("usb-00100000", "Pixel 8", "mtp", false, ""),
                ("ic-abc", "Wi-Fi Camera", "camera", true, "ready"),
            ]
        );
        assert_eq!(phones[0].percent, 40);
        assert_eq!(phones[0].uri, "device://usb-14200000/");
        assert_eq!(merge(&[], &[camera("usb-1", "iPad", APPLE, Phase::Restricted)])[0].kind, "apple", "Apple's vendor id says it without IOKit");
        assert_eq!(merge(&[], &[camera("usb-1", "iPad", APPLE, Phase::Restricted)])[0].state, "locked");
        assert!(merge(&[], &[]).is_empty());
        // Where the two watchers disagree on the location, one device of the same ids is still the same device.
        let pixel = usb(8, "mtp", "Pixel 8", 0x0010_0000);
        let seen = Camera { key: "usb-00200000".into(), name: "Pixel".into(), location: 0x0020_0000, ids: pixel.ids, phase: Phase::Closed };
        let one = merge(std::slice::from_ref(&pixel), std::slice::from_ref(&seen));
        assert_eq!(one.len(), 1);
        assert_eq!((one[0].key.as_str(), one[0].kind, one[0].alias.as_deref()), ("usb-00200000", "mtp", Some("usb-00100000")));
        let twin = usb(9, "mtp", "Pixel 8", 0x0030_0000);
        assert_eq!(merge(&[pixel.clone(), Device { ids: pixel.ids, ..twin }], &[seen]).len(), 3, "two alike are not guessed between");
    }

    #[test]
    fn a_usb_device_and_its_camera_have_the_same_key() {
        let device = usb(42, "apple", "iPhone", 0x1420_0000);
        assert_eq!(usb_key(&device), camera::key_for(0x1420_0000, "UUID-OF-IT"));
        assert_eq!(usb_key(&usb(42, "mtp", "Phone", 0)), "io-42");
        assert_eq!(note_of(&device)["uri"], "device://usb-14200000/");
        assert_eq!(note_of(&device)["kind"], "apple");
    }

    #[test]
    fn a_catalog_lists_as_folders_with_sizes_dates_and_uris() {
        let root = tree();
        let top = list_in(&root, &Uri::parse("device://usb-14200000/").unwrap()).unwrap();
        assert_eq!(top.len(), 1);
        assert_eq!((top[0].name.as_str(), top[0].kind, top[0].is_dir, top[0].uri.as_str()), ("DCIM", "dir", true, "device://usb-14200000/DCIM"));
        let dir = Uri::parse("device://usb-14200000/DCIM/100APPLE").unwrap();
        let files = list_in(&root, &dir).unwrap();
        let names: Vec<&str> = files.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["IMG_0001.HEIC", "Ảnh #1 50%.JPG", "NOEXT"]);
        assert_eq!((files[0].size, files[0].mtime, files[0].ext.as_str(), files[0].icon.as_str()), (2_345_678, 1_700_000_000, "heic", "ext:heic"));
        assert_eq!(files[1].uri, "device://usb-14200000/DCIM/100APPLE/%E1%BA%A2nh%20%231%2050%25.JPG");
        assert_eq!(files[2].icon, "type:public.data");
        // The URI of an entry leads back to its node.
        let back = Uri::parse(&files[1].uri).unwrap();
        assert_eq!(camera::find(&root, &back.path).map(|n| n.size), Some(12));
        assert_eq!(list_in(&root, &Uri::parse("device://usb-14200000/DCIM/101APPLE").unwrap()).unwrap(), []);
        assert!(list_in(&root, &Uri::parse("device://usb-14200000/DCIM/999").unwrap()).is_err());
        assert!(list_in(&root, &back).is_err(), "a file is no folder");
    }

    #[test]
    fn a_device_file_is_read_in_chunks_to_the_end() {
        fn fetch(_: &str, _: &str, offset: u64, length: u64) -> Result<Vec<u8>, String> {
            Ok((offset..offset + length).map(|i| (i % 251) as u8).collect())
        }
        let size = CHUNK * 2 + 1000;
        let mut file = DeviceFile { key: "k".into(), path: "/a".into(), size, offset: 0, buffer: Vec::new(), at: 0, fetch };
        let mut all = Vec::new();
        file.read_to_end(&mut all).unwrap();
        assert_eq!(all.len() as u64, size);
        assert!(all.iter().enumerate().all(|(i, &b)| b == (i % 251) as u8));

        fn stuck(_: &str, _: &str, _: u64, _: u64) -> Result<Vec<u8>, String> {
            Ok(Vec::new())
        }
        let mut file = DeviceFile { key: "k".into(), path: "/a".into(), size: 10, offset: 0, buffer: Vec::new(), at: 0, fetch: stuck };
        assert!(file.read_to_end(&mut Vec::new()).is_err(), "a device that sends nothing fails the read");
        fn gone(_: &str, _: &str, _: u64, _: u64) -> Result<Vec<u8>, String> {
            Err("unplugged".into())
        }
        let mut file = DeviceFile { key: "k".into(), path: "/a".into(), size: 10, offset: 0, buffer: Vec::new(), at: 0, fetch: gone };
        assert_eq!(file.read_to_end(&mut Vec::new()).unwrap_err().to_string(), "unplugged");
    }

    #[test]
    fn a_device_that_cannot_be_read_says_why() {
        let mtp = unreadable("mtp", "Pixel 8");
        assert!(mtp.starts_with("Pixel 8 ") && mtp.contains("MTP") && mtp.contains("PTP"), "{mtp}");
        assert!(unreadable("apple", "iPhone").contains("Tin cậy") || unreadable("apple", "iPhone").contains("Trust"));
        assert!(unreadable("camera", "Canon").starts_with("Canon "));
        let provider = DeviceProvider;
        let nowhere = Uri::parse("device://usb-ffffffff/").unwrap();
        assert!(!provider.capabilities(&nowhere).write);
        assert_eq!(provider.mkdir(&nowhere), Err(read_only()));
        assert_eq!(provider.list(&nowhere, &AtomicBool::new(true)), Err(not_connected()), "a place of a device that went");
    }
}
