//! What macOS says of the disks and devices plugged in: a disk mounted, unmounted or renamed (NSWorkspace's
//! notifications), what a disk is (DiskArbitration: on USB, a memory card, the network), the file a disk image was
//! opened from (hdiutil), and the phones and cameras on USB, which come with no disk at all (IOKit). Their files are
//! read through ImageCaptureCore (src/native/camera.rs), over PTP; nothing on a Mac reads MTP.

use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSWorkspace, NSWorkspaceDidMountNotification, NSWorkspaceDidRenameVolumeNotification, NSWorkspaceDidUnmountNotification, NSWorkspaceVolumeOldURLKey, NSWorkspaceVolumeURLKey};
use objc2_foundation::{NSArray, NSData, NSDictionary, NSNotification, NSNumber, NSOperationQueue, NSPropertyListMutabilityOptions, NSPropertyListSerialization, NSString, NSURL};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    ffi::{CStr, c_char, c_void},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    ptr::{self, NonNull},
    rc::Rc,
    sync::Mutex,
    thread,
};

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFRunLoopDefaultMode: *const c_void;
    fn CFRunLoopGetCurrent() -> *mut c_void;
    fn CFRunLoopAddSource(run_loop: *mut c_void, source: *mut c_void, mode: *const c_void);
    fn CFRunLoopRun();
    fn CFRelease(object: *const c_void);
}

#[link(name = "DiskArbitration", kind = "framework")]
unsafe extern "C" {
    fn DASessionCreate(allocator: *const c_void) -> *mut c_void;
    fn DADiskCreateFromVolumePath(allocator: *const c_void, session: *mut c_void, path: *const c_void) -> *mut c_void;
    fn DADiskCopyDescription(disk: *mut c_void) -> *mut c_void;
}

/// An object of the I/O registry (io_object_t, a Mach port).
type IoObject = u32;
type Matched = extern "C" fn(*mut c_void, IoObject);

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IONotificationPortCreate(main_port: u32) -> *mut c_void;
    fn IONotificationPortGetRunLoopSource(port: *mut c_void) -> *mut c_void;
    fn IOServiceMatching(class: *const c_char) -> *mut c_void;
    fn IOServiceAddMatchingNotification(port: *mut c_void, kind: *const c_char, matching: *mut c_void, callback: Matched, refcon: *mut c_void, iterator: *mut IoObject) -> i32;
    fn IOIteratorNext(iterator: IoObject) -> IoObject;
    fn IOObjectRelease(object: IoObject) -> i32;
    fn IORegistryEntryGetParentEntry(entry: IoObject, plane: *const c_char, parent: *mut IoObject) -> i32;
    fn IORegistryEntryGetRegistryEntryID(entry: IoObject, id: *mut u64) -> i32;
    fn IORegistryEntryGetName(entry: IoObject, name: *mut c_char) -> i32;
    fn IORegistryEntryCreateCFProperty(entry: IoObject, key: *const c_void, allocator: *const c_void, options: u32) -> *mut c_void;
}

/// A change of the disks the system shows.
#[derive(Debug, Clone, PartialEq)]
pub enum VolumeEvent {
    Mounted(PathBuf),
    Unmounted(PathBuf),
    Renamed { from: PathBuf, to: PathBuf },
}

/// Calls `on` on the main thread each time a disk is mounted, unmounted or renamed, for as long as the app runs.
pub fn observe_volumes(on: impl Fn(VolumeEvent) + 'static) {
    let on = Rc::new(on);
    let center = NSWorkspace::sharedWorkspace().notificationCenter();
    // SAFETY: the names are process-lifetime constants.
    let names = unsafe { [NSWorkspaceDidMountNotification, NSWorkspaceDidUnmountNotification, NSWorkspaceDidRenameVolumeNotification] };
    for (i, name) in names.into_iter().enumerate() {
        let on = on.clone();
        let block = RcBlock::new(move |note: NonNull<NSNotification>| {
            // SAFETY: the centre hands the block a notification that lives for the call; the keys are process-lifetime
            // constants.
            let (note, key, old_key) = unsafe { (note.as_ref(), NSWorkspaceVolumeURLKey, NSWorkspaceVolumeOldURLKey) };
            let Some(path) = path_in(note, key) else { return };
            on(match (i, path_in(note, old_key)) {
                (0, _) => VolumeEvent::Mounted(path),
                (1, _) => VolumeEvent::Unmounted(path),
                (_, Some(from)) => VolumeEvent::Renamed { from, to: path },
                (_, None) => return,
            });
        });
        // SAFETY: the block takes what the centre calls it with, on the main queue, where the app's own work runs.
        let observer = unsafe { center.addObserverForName_object_queue_usingBlock(Some(name), None, Some(&NSOperationQueue::mainQueue()), &block) };
        // The observers stay for the life of the app.
        std::mem::forget(observer);
    }
}

/// The path of the volume's URL under `key` in a notification of NSWorkspace.
fn path_in(note: &NSNotification, key: &NSString) -> Option<PathBuf> {
    let url = note.userInfo()?.objectForKey(key.as_ref())?.downcast::<NSURL>().ok()?;
    url.path().map(|p| PathBuf::from(p.to_string()))
}

/// What DiskArbitration says of the disk a volume is on.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Disk {
    /// The way it is attached: "USB", "Thunderbolt", "PCI-Express", "Secure Digital", "Disk Image", "Apple Fabric".
    pub protocol: String,
    pub internal: bool,
    pub network: bool,
    /// The BSD name of the volume's device ("disk4s1").
    pub bsd: String,
}

/// The disk of the volume mounted at `volume`; None for a file system with no disk under it.
pub fn disk_of(volume: &Path) -> Option<Disk> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&volume.to_string_lossy()));
    // SAFETY: what is made here is released once; the description is a CFDictionary, which is the same object as an
    // NSDictionary, taken over with the reference it comes with.
    let info: Retained<NSDictionary> = unsafe {
        let session = DASessionCreate(ptr::null());
        if session.is_null() {
            return None;
        }
        let disk = DADiskCreateFromVolumePath(ptr::null(), session, Retained::as_ptr(&url).cast());
        let description = if disk.is_null() { ptr::null_mut() } else { DADiskCopyDescription(disk) };
        if !disk.is_null() {
            CFRelease(disk);
        }
        CFRelease(session);
        Retained::from_raw(description.cast())?
    };
    let value = |key: &str| info.objectForKey(NSString::from_str(key).as_ref()).map(|v| json_of(&v)).unwrap_or(Value::Null);
    let text = |key: &str| value(key).as_str().unwrap_or_default().to_owned();
    Some(Disk { protocol: text("DADeviceProtocol"), internal: value("DADeviceInternal") == true, network: value("DAVolumeNetwork") == true, bsd: text("DAMediaBSDName") })
}

/// The file of the disk image mounted at `mount`, as `hdiutil info` lists the images attached; None for a disk that is
/// not an image.
pub fn disk_image(mount: &Path) -> Option<PathBuf> {
    let out = Command::new("/usr/bin/hdiutil").args(["info", "-plist"]).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    image_of(&plist(&out.stdout)?, mount)
}

/// The image in `hdiutil info -plist` (as JSON) that has a volume mounted at `mount`.
pub fn image_of(info: &Value, mount: &Path) -> Option<PathBuf> {
    let mounted_here = |image: &&Value| image["system-entities"].as_array().into_iter().flatten().any(|e| e["mount-point"].as_str().is_some_and(|m| Path::new(m) == mount));
    info["images"].as_array()?.iter().find(mounted_here)?["image-path"].as_str().map(PathBuf::from)
}

/// The version an app shows, CFBundleShortVersionString or else CFBundleVersion, read from its Info.plist each time:
/// NSBundle would keep what it read first for the life of the app, and an update replaces an app where it is.
pub fn app_version(app: &Path) -> Option<String> {
    let info = plist(&std::fs::read(app.join("Contents/Info.plist")).ok()?)?;
    let text = |key: &str| info[key].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned);
    text("CFBundleShortVersionString").or_else(|| text("CFBundleVersion"))
}

/// A property list, XML or binary, as JSON: its dictionaries, arrays, strings, numbers and booleans; anything else
/// (data, a date) is null.
pub fn plist(bytes: &[u8]) -> Option<Value> {
    let data = NSData::with_bytes(bytes);
    // SAFETY: the data is read as a whole property list, or the call fails.
    let list = unsafe { NSPropertyListSerialization::propertyListWithData_options_format_error(&data, NSPropertyListMutabilityOptions::Immutable, ptr::null_mut()) }.ok()?;
    Some(json_of(&list))
}

fn json_of(object: &AnyObject) -> Value {
    if let Some(text) = object.downcast_ref::<NSString>() {
        return Value::String(text.to_string());
    }
    if let Some(number) = object.downcast_ref::<NSNumber>() {
        // A boolean of a property list is an NSNumber of a char.
        // SAFETY: the type is a C string that lives as long as the number.
        return match unsafe { CStr::from_ptr(number.objCType().as_ptr()) }.to_bytes() {
            b"c" | b"B" => Value::Bool(number.boolValue()),
            b"f" | b"d" => serde_json::Number::from_f64(number.doubleValue()).map_or(Value::Null, Value::Number),
            _ => Value::from(number.longLongValue()),
        };
    }
    if let Some(list) = object.downcast_ref::<NSArray>() {
        return Value::Array(list.to_vec().iter().map(|item| json_of(item)).collect());
    }
    if let Some(map) = object.downcast_ref::<NSDictionary>() {
        let (keys, values) = map.to_vecs();
        return Value::Object(keys.iter().zip(&values).filter_map(|(k, v)| Some((k.downcast_ref::<NSString>()?.to_string(), json_of(v)))).collect());
    }
    Value::Null
}

/// A phone or a camera plugged in over USB.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Device {
    /// The device's id in the I/O registry, the same until it is unplugged.
    pub id: u64,
    /// "apple" (an iPhone, iPad or iPod), "camera" (whatever sends pictures over PTP: a camera, a phone set to it) or
    /// "mtp" (an Android phone that shares its files over MTP).
    pub kind: &'static str,
    pub name: String,
    pub vendor: String,
    /// Where it is plugged in (the USB location id), which ImageCaptureCore gives its devices too; 0 when unknown.
    pub location: u32,
    /// The USB vendor and product ids.
    #[serde(skip)]
    pub ids: (u16, u16),
}

/// What a USB device is, from its vendor and product and one of its interfaces; None for the rest (a keyboard, a hub,
/// a drive, which comes as a disk).
pub fn classify(vendor_id: i64, product: &str, interface_class: i64, interface_name: &str) -> Option<&'static str> {
    const APPLE: i64 = 0x05AC;
    const STILL_IMAGE: i64 = 6;
    let product = product.trim().to_ascii_lowercase();
    if vendor_id == APPLE && ["iphone", "ipad", "ipod"].iter().any(|p| product.starts_with(p)) {
        Some("apple")
    } else if interface_name.trim().eq_ignore_ascii_case("mtp") {
        Some("mtp")
    } else if interface_class == STILL_IMAGE {
        Some("camera")
    } else {
        None
    }
}

struct Usb {
    /// Called with whether the device was there before the watch began, which is no news to tell of.
    added: Box<dyn Fn(Device, bool) + Send>,
    removed: Box<dyn Fn(u64) + Send>,
    /// The devices announced: a device matches once for each of its interfaces and is announced once, and its going
    /// is told only when its coming was.
    seen: Mutex<HashSet<u64>>,
}

/// Calls `added` with each phone or camera plugged in, those already there first (with `true`), then those plugged in
/// from now on, and `removed` with its id once it is unplugged, from a thread of its own that waits on IOKit for the
/// life of the app.
pub fn watch_usb(added: impl Fn(Device, bool) + Send + 'static, removed: impl Fn(u64) + Send + 'static) {
    let usb = Usb { added: Box::new(added), removed: Box::new(removed), seen: Mutex::new(HashSet::new()) };
    let spawned = thread::Builder::new().name("usb".into()).spawn(move || {
        let usb: *mut c_void = Box::into_raw(Box::new(usb)).cast();
        // SAFETY: the port, its source and the iterators live as long as this thread, which is as long as the app; the
        // callbacks get `usb` back, which is never freed. Each matching dictionary is consumed by its call.
        unsafe {
            let port = IONotificationPortCreate(0);
            if port.is_null() {
                return;
            }
            CFRunLoopAddSource(CFRunLoopGetCurrent(), IONotificationPortGetRunLoopSource(port), kCFRunLoopDefaultMode);
            let (mut interfaces, mut gone) = (0, 0);
            if IOServiceAddMatchingNotification(port, c"IOServiceFirstMatch".as_ptr(), IOServiceMatching(c"IOUSBHostInterface".as_ptr()), interface_matched, usb, &mut interfaces) != 0
                || IOServiceAddMatchingNotification(port, c"IOServiceTerminate".as_ptr(), IOServiceMatching(c"IOUSBHostDevice".as_ptr()), device_terminated, usb, &mut gone) != 0
            {
                return;
            }
            // Going through what is there arms the notifications of what comes next. What was plugged in before is told
            // as already there: the sidebar shows it, but no note says it came.
            announce(&*usb.cast::<Usb>(), interfaces, true);
            each(gone, |_| {});
            CFRunLoopRun();
        }
    });
    if let Err(e) = spawned {
        eprintln!("usb: {e}");
    }
}

fn each(iterator: IoObject, mut f: impl FnMut(IoObject)) {
    loop {
        // SAFETY: the iterator is IOKit's; each object it gives is released after use.
        let object = unsafe { IOIteratorNext(iterator) };
        if object == 0 {
            break;
        }
        f(object);
        unsafe { IOObjectRelease(object) };
    }
}

extern "C" fn interface_matched(usb: *mut c_void, iterator: IoObject) {
    // SAFETY: `usb` is the one watch_usb leaked.
    announce(unsafe { &*usb.cast::<Usb>() }, iterator, false);
}

fn announce(usb: &Usb, iterator: IoObject, before: bool) {
    each(iterator, |interface| {
        let Some(device) = device_of(interface) else { return };
        if usb.seen.lock().is_ok_and(|mut seen| seen.insert(device.id)) {
            (usb.added)(device, before);
        }
    });
}

extern "C" fn device_terminated(usb: *mut c_void, iterator: IoObject) {
    // SAFETY: `usb` is the one watch_usb leaked.
    let usb = unsafe { &*usb.cast::<Usb>() };
    each(iterator, |device| {
        let id = registry_id(device);
        if usb.seen.lock().is_ok_and(|mut seen| seen.remove(&id)) {
            (usb.removed)(id);
        }
    });
}

/// The phone or camera a USB interface belongs to, when it is one.
fn device_of(interface: IoObject) -> Option<Device> {
    let class = property(interface, "bInterfaceClass").as_i64().unwrap_or(-1);
    // An interface with a string of its own ("MTP") is named by it in the registry.
    let interface_name = property(interface, "USB Interface Name").as_str().map(str::to_owned).unwrap_or_else(|| name_of(interface));
    let mut device = 0;
    // SAFETY: the parent is released below.
    if unsafe { IORegistryEntryGetParentEntry(interface, c"IOService".as_ptr(), &mut device) } != 0 {
        return None;
    }
    let text = |key: &str| property(device, key).as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned);
    let name = text("USB Product Name").or_else(|| text("kUSBProductString")).unwrap_or_else(|| name_of(device));
    let vendor = text("USB Vendor Name").or_else(|| text("kUSBVendorString")).unwrap_or_default();
    let vendor_id = property(device, "idVendor").as_i64().unwrap_or(0);
    let location = property(device, "locationID").as_i64().unwrap_or(0) as u32;
    let ids = (vendor_id as u16, property(device, "idProduct").as_i64().unwrap_or(0) as u16);
    let id = registry_id(device);
    // SAFETY: the parent was got above.
    unsafe { IOObjectRelease(device) };
    let kind = classify(vendor_id, &name, class, &interface_name)?;
    Some(Device { id, kind, name, vendor, location, ids })
}

/// A property of an object of the registry as JSON; null when it has none.
fn property(entry: IoObject, key: &str) -> Value {
    let key = NSString::from_str(key);
    // SAFETY: the property comes with a reference of its own, taken over here; a CF object is the same as its NS one.
    let value: Option<Retained<AnyObject>> = unsafe { Retained::from_raw(IORegistryEntryCreateCFProperty(entry, Retained::as_ptr(&key).cast(), ptr::null(), 0).cast()) };
    value.map_or(Value::Null, |v| json_of(&v))
}

fn name_of(entry: IoObject) -> String {
    let mut name = [0 as c_char; 128];
    // SAFETY: a name of the registry fits in 128 bytes with its NUL (io_name_t).
    if unsafe { IORegistryEntryGetName(entry, name.as_mut_ptr()) } != 0 {
        return String::new();
    }
    unsafe { CStr::from_ptr(name.as_ptr()) }.to_string_lossy().trim().to_owned()
}

fn registry_id(entry: IoObject) -> u64 {
    let mut id = 0;
    // SAFETY: the id is written to a u64 of ours.
    unsafe { IORegistryEntryGetRegistryEntryID(entry, &mut id) };
    id
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phones_and_cameras_are_told_from_the_rest_of_usb() {
        assert_eq!(classify(0x05AC, "iPhone", 255, ""), Some("apple"), "any interface of an iPhone");
        assert_eq!(classify(0x05AC, "iPad", 6, ""), Some("apple"));
        assert_eq!(classify(0x05AC, "Magic Keyboard", 3, ""), None, "Apple makes keyboards too");
        assert_eq!(classify(0x18D1, "Pixel 8", 255, "MTP"), Some("mtp"));
        assert_eq!(classify(0x04E8, "SAMSUNG_Android", 6, "MTP"), Some("mtp"), "MTP over the still image class is still MTP");
        assert_eq!(classify(0x04A9, "Canon Digital Camera", 6, "IOUSBHostInterface"), Some("camera"));
        assert_eq!(classify(0x18D1, "Pixel 8", 255, "ADB Interface"), None, "the debugging interface of a phone");
        assert_eq!(classify(0x0781, "Ultra", 8, ""), None, "a drive comes as a disk");
        assert_eq!(classify(0x046D, "USB Receiver", 3, ""), None);
    }

    #[test]
    fn a_property_list_reads_as_json() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>name</key><string>Tên ứng dụng</string>
  <key>count</key><integer>3</integer>
  <key>ratio</key><real>0.5</real>
  <key>on</key><true/>
  <key>off</key><false/>
  <key>list</key><array><string>a</string><integer>1</integer></array>
  <key>blob</key><data>AAE=</data>
</dict></plist>"#;
        let v = plist(xml.as_bytes()).unwrap();
        assert_eq!(v["name"], "Tên ứng dụng");
        assert_eq!((v["count"].as_i64(), v["ratio"].as_f64()), (Some(3), Some(0.5)));
        assert_eq!((v["on"].as_bool(), v["off"].as_bool()), (Some(true), Some(false)));
        assert_eq!(v["list"], serde_json::json!(["a", 1]));
        assert!(v["blob"].is_null());
        assert!(plist(b"not a plist").is_none());
    }

    #[test]
    fn the_image_of_a_volume_is_found_in_what_hdiutil_lists() {
        let info = plist(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>framework</key><string>710</string>
  <key>images</key><array>
    <dict>
      <key>image-path</key><string>/Users/me/Downloads/Other.dmg</string>
      <key>system-entities</key><array>
        <dict><key>dev-entry</key><string>/dev/disk5</string></dict>
        <dict><key>dev-entry</key><string>/dev/disk5s1</string><key>mount-point</key><string>/Volumes/Other</string></dict>
      </array>
    </dict>
    <dict>
      <key>image-path</key><string>/Users/me/Downloads/App 2.1.dmg</string>
      <key>system-entities</key><array>
        <dict><key>dev-entry</key><string>/dev/disk4</string><key>content-hint</key><string>GUID_partition_scheme</string></dict>
        <dict><key>dev-entry</key><string>/dev/disk4s1</string><key>mount-point</key><string>/Volumes/App</string></dict>
      </array>
    </dict>
  </array>
</dict></plist>"#,
        )
        .unwrap();
        assert_eq!(image_of(&info, Path::new("/Volumes/App")), Some(PathBuf::from("/Users/me/Downloads/App 2.1.dmg")));
        assert_eq!(image_of(&info, Path::new("/Volumes/Other")), Some(PathBuf::from("/Users/me/Downloads/Other.dmg")));
        assert_eq!(image_of(&info, Path::new("/Volumes/USB")), None, "a drive is no image");
        assert_eq!(image_of(&serde_json::json!({ "framework": "710" }), Path::new("/Volumes/App")), None, "no image attached");
    }

    #[test]
    fn an_app_shows_the_version_in_its_info_plist() {
        let t = crate::vfs::local::tests::Temp::new("app-version");
        let plist = |body: &str| format!(r#"<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>{body}</dict></plist>"#);
        t.file("A.app/Contents/Info.plist", &plist("<key>CFBundleShortVersionString</key><string>2.1.0</string><key>CFBundleVersion</key><string>210</string>"));
        t.file("B.app/Contents/Info.plist", &plist("<key>CFBundleVersion</key><string>57</string>"));
        t.file("C.app/Contents/Info.plist", "broken");
        assert_eq!(app_version(&t.0.join("A.app")).as_deref(), Some("2.1.0"));
        assert_eq!(app_version(&t.0.join("B.app")).as_deref(), Some("57"));
        assert_eq!(app_version(&t.0.join("C.app")), None);
        assert_eq!(app_version(&t.0.join("D.app")), None);
    }

    #[test]
    fn the_startup_disk_is_internal_with_a_device() {
        let disk = disk_of(Path::new("/")).expect("the startup disk has one");
        assert!(disk.internal && !disk.network);
        assert!(disk.bsd.starts_with("disk"), "{}", disk.bsd);
        assert_eq!(disk_image(Path::new("/")), None);
    }
}
