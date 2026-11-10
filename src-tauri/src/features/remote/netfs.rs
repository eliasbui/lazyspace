//! Shares the system mounts as disks, SMB, AFP, NFS and WebDAV, through NetFS as Finder's "Connect to Server" does; the
//! share is then a folder under /Volumes like any disk. With no password saved, the system asks for one itself and
//! may keep it in the Keychain.

use super::Connection;
use crate::tr;
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_foundation::{NSArray, NSMutableDictionary, NSNumber, NSString, NSURL};
use std::{ffi::c_void, path::PathBuf};

#[link(name = "NetFS", kind = "framework")]
unsafe extern "C" {
    fn NetFSMountURLSync(url: *const c_void, mount_path: *const c_void, user: *const c_void, password: *const c_void, open_options: *const c_void, mount_options: *const c_void, mount_points: *mut *const c_void) -> i32;
}

/// `EEXIST`: the share is mounted already.
const EEXIST: i32 = 17;
/// What NetFS answers when the user closes its sign-in window: `ECANCELED`, or `userCanceledErr`.
const CANCELLED: [i32; 2] = [89, -128];

/// Every byte but the unreserved ones of RFC 3986 percent-encoded.
fn encode(text: &str) -> String {
    text.bytes().map(|b| if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

/// The URL NetFS mounts, with the user in it but never the password: `smb://me@nas.local/Share`. SMB and AFP mount the
/// share, the first folder of the path, and the rest of the path is opened inside it; NFS and WebDAV mount the whole
/// path.
pub fn share_url(c: &Connection) -> Result<(String, String), String> {
    let scheme = match c.scheme.as_str() {
        "dav" => "http",
        "davs" => "https",
        other => other,
    };
    let parts: Vec<&str> = c.path.split('/').filter(|p| !p.is_empty()).collect();
    let whole = matches!(c.scheme.as_str(), "nfs" | "dav" | "davs");
    if !whole && parts.is_empty() {
        return Err(tr("Hãy nhập tên thư mục chia sẻ vào ô Thư mục", "Type the name of the shared folder in the Folder box").into());
    }
    let (mounted, inside) = if whole { (&parts[..], &[][..]) } else { parts.split_at(1) };
    let user = if c.user.is_empty() || c.guest { String::new() } else { format!("{}@", encode(&c.user)) };
    let host = if c.host.contains(':') && !c.host.starts_with('[') { format!("[{}]", c.host) } else { c.host.clone() };
    let port = c.port.map(|p| format!(":{p}")).unwrap_or_default();
    let path: String = mounted.iter().map(|p| format!("/{}", encode(p))).collect();
    Ok((format!("{scheme}://{user}{host}{port}{path}"), inside.join("/")))
}

fn ns(text: &str) -> Retained<NSString> {
    NSString::from_str(text)
}

/// Mounts the share and gives back its mount point and the folder to open: the mount point, or the folder the path
/// names inside it.
pub fn mount(c: &Connection, password: Option<&str>) -> Result<(PathBuf, PathBuf), String> {
    let (url, inside) = share_url(c)?;
    let ns_url = NSURL::URLWithString(&ns(&url)).ok_or_else(|| format!("{}: {url}", tr("Địa chỉ không hợp lệ", "Not a valid address")))?;
    let open = NSMutableDictionary::<NSString, AnyObject>::new();
    // With a password or as a guest NetFS needs no window; otherwise the system's own sign-in window asks.
    let ui = if password.is_some() || c.guest { "NoUI" } else { "AllowUI" };
    open.insert(&*ns("UIOption"), &*ns(ui));
    if c.guest {
        open.insert(&*ns("Guest"), &*NSNumber::new_bool(true));
    }
    let user = (!c.user.is_empty() && !c.guest).then(|| ns(&c.user));
    let password = password.map(ns);
    let ptr = |s: &Option<Retained<NSString>>| s.as_ref().map_or(std::ptr::null(), |s| Retained::as_ptr(s).cast::<c_void>());
    let mut points: *const c_void = std::ptr::null();
    // SAFETY: every pointer is a live Foundation object toll-free bridged to the CF type NetFS takes, or null where
    // NetFS allows null; `points` is an out value NetFS fills with an array we then own (the Create rule).
    let status = unsafe { NetFSMountURLSync(Retained::as_ptr(&ns_url).cast(), std::ptr::null(), ptr(&user), ptr(&password), Retained::as_ptr(&open).cast(), std::ptr::null(), &mut points) };
    // SAFETY: when set, `points` is a CFArray of CFStrings that we own.
    let points: Option<Retained<NSArray<NSString>>> = unsafe { Retained::from_raw(points.cast_mut().cast()) };
    let point = points.and_then(|p| p.firstObject()).map(|p| PathBuf::from(p.to_string()));
    let root = match (status, point) {
        (0, Some(point)) => point,
        (EEXIST, _) | (0, None) => mounted_already(&url).ok_or_else(|| tr("Ổ chia sẻ đã được mở nhưng không tìm thấy trong /Volumes", "The share is mounted but was not found in /Volumes").to_owned())?,
        (status, _) if CANCELLED.contains(&status) => return Err(tr("Đã hủy", "Cancelled").into()),
        (status, _) => {
            let why = if status > 0 { std::io::Error::from_raw_os_error(status).to_string() } else { format!("NetFS {status}") };
            return Err(format!("{} \"{}\": {why}", tr("Không mở được ổ chia sẻ", "Could not mount"), c.name));
        }
    };
    let open = if inside.is_empty() { root.clone() } else { root.join(inside) };
    Ok((root, open))
}

/// The folder in /Volumes of a share mounted before: the one whose name is the share's last folder.
fn mounted_already(url: &str) -> Option<PathBuf> {
    let name = url.rsplit('/').next()?;
    let name = crate::vfs::Uri::parse(&format!("file:///{name}")).ok()?.name();
    let path = PathBuf::from("/Volumes").join(name);
    path.is_dir().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn netfs_url_builds_with_share_and_without_password() {
        let smb = Connection { scheme: "smb".into(), host: "nas.local".into(), user: "an@home".into(), path: "/Phim ảnh/2024/Hè".into(), ..Default::default() };
        let (url, inside) = share_url(&smb).unwrap();
        assert_eq!(url, "smb://an%40home@nas.local/Phim%20%E1%BA%A3nh");
        assert_eq!(inside, "2024/Hè");
        let guest = Connection { guest: true, port: Some(1445), ..smb.clone() };
        assert_eq!(share_url(&guest).unwrap().0, "smb://nas.local:1445/Phim%20%E1%BA%A3nh", "a guest has no user in the URL");
        let dav = Connection { scheme: "davs".into(), host: "cloud.example.com".into(), user: String::new(), path: "/remote.php/dav".into(), ..Default::default() };
        assert_eq!(share_url(&dav).unwrap(), ("https://cloud.example.com/remote.php/dav".into(), String::new()), "WebDAV mounts the whole path");
        let v6 = Connection { scheme: "afp".into(), host: "fe80::1".into(), user: String::new(), path: "/Share".into(), ..Default::default() };
        assert_eq!(share_url(&v6).unwrap().0, "afp://[fe80::1]/Share");
        assert!(share_url(&Connection { path: String::new(), ..smb }).is_err(), "SMB needs a share");
    }
}
