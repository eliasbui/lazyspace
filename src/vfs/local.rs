//! The provider of `file://`: this Mac's disks, read and changed with std and two calls of the system (`renamex_np`, so
//! a rename never replaces what is already there).

use super::{Capabilities, Commit, Entry, Provider, Uri};
use crate::tr;
use std::{
    ffi::CString,
    fs::{self, File, Metadata},
    io::{self, Write},
    os::{macos::fs::MetadataExt as _, unix::ffi::OsStrExt, unix::fs::PermissionsExt},
    path::{Path, PathBuf},
    sync::{
        OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};

/// A file of a folder Finder hides: the `UF_HIDDEN` flag of `chflags` (`~/Library` has it).
const UF_HIDDEN: u32 = 0x8000;
/// `renamex_np`: fail rather than replace an item already at the target.
const RENAME_EXCL: u32 = 0x4;

unsafe extern "C" {
    fn renamex_np(from: *const std::ffi::c_char, to: *const std::ffi::c_char, flags: u32) -> i32;
}

/// Folders Finder shows as one item, by extension. Opening one opens it; it is not browsed into.
const PACKAGES: &[&str] = &[
    "app", "appex", "bundle", "framework", "plugin", "kext", "prefpane", "xpc", "qlgenerator", "mdimporter", "saver",
    "photoslibrary", "musiclibrary", "tvlibrary", "imovielibrary", "rtfd", "pages", "numbers", "key", "xcodeproj",
    "xcworkspace", "playground", "xcarchive", "dsym", "pkg", "mpkg", "sparsebundle", "scptd", "docset", "fcpbundle",
    "logicx", "band", "workflow", "action", "lpdf",
];

pub struct Local;

impl Provider for Local {
    fn capabilities(&self, _uri: &Uri) -> Capabilities {
        Capabilities { write: true, rename: true, trash: true, watch: true, sizes: true, local_path: true }
    }

    fn list(&self, uri: &Uri, cancel: &AtomicBool) -> Result<Vec<Entry>, String> {
        list(Path::new(&uri.path), uri, cancel)
    }

    fn stat(&self, uri: &Uri) -> Result<Entry, String> {
        let path = Path::new(&uri.path);
        let meta = fs::symlink_metadata(path).map_err(|e| error(path, &e))?;
        let parent = uri.parent().unwrap_or_else(|| uri.clone());
        Ok(entry(&parent, &uri.name(), path, &meta))
    }

    fn read(&self, uri: &Uri) -> Result<Box<dyn io::Read + Send>, String> {
        let path = Path::new(&uri.path);
        Ok(Box::new(File::open(path).map_err(|e| error(path, &e))?))
    }

    fn write(&self, uri: &Uri) -> Result<Box<dyn Commit>, String> {
        let target = PathBuf::from(&uri.path);
        let partial = partial_of(&target);
        let file = File::create(&partial).map_err(|e| error(&partial, &e))?;
        Ok(Box::new(Partial { file: Some(file), partial, target }))
    }

    fn mkdir(&self, uri: &Uri) -> Result<(), String> {
        let path = Path::new(&uri.path);
        fs::create_dir(path).map_err(|e| error(path, &e))
    }

    fn rename(&self, from: &Uri, to: &Uri) -> Result<(), String> {
        rename(Path::new(&from.path), Path::new(&to.path))
    }

    fn delete(&self, uri: &Uri, cancel: &AtomicBool) -> Result<(), String> {
        delete(Path::new(&uri.path), cancel)
    }
}

/// The items of the folder `path`, whose URI is `uri`. An item whose name is not UTF-8 is left out (APFS and HFS+
/// keep names in UTF-8, so only a foreign disk could have one).
pub fn list(path: &Path, uri: &Uri, cancel: &AtomicBool) -> Result<Vec<Entry>, String> {
    let dir = fs::read_dir(path).map_err(|e| error(path, &e))?;
    let mut entries = Vec::new();
    for item in dir {
        if entries.len() % 256 == 0 && cancel.load(Ordering::Relaxed) {
            return Err(tr("Đã hủy", "Cancelled").into());
        }
        let Ok(item) = item else { continue };
        let Ok(name) = item.file_name().into_string() else { continue };
        // DirEntry::metadata does not follow a link, so a link is listed as one.
        let Ok(meta) = item.metadata() else { continue };
        entries.push(entry(uri, &name, &item.path(), &meta));
    }
    Ok(entries)
}

/// The entry of `name` in the folder `dir`, from the item's own metadata (a link's, not its target's).
pub fn entry(dir: &Uri, name: &str, path: &Path, meta: &Metadata) -> Entry {
    let file_type = meta.file_type();
    let ext = Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let target = file_type.is_symlink().then(|| fs::metadata(path).ok()).flatten();
    let package = |is_dir: bool| is_dir && PACKAGES.contains(&ext.as_str());
    let (kind, is_dir) = if file_type.is_symlink() {
        ("link", target.as_ref().is_some_and(|t| t.is_dir() && !package(true)))
    } else if package(file_type.is_dir()) {
        (if ext == "app" { "app" } else { "package" }, false)
    } else if file_type.is_dir() {
        ("dir", true)
    } else {
        ("file", false)
    };
    let icon = match kind {
        "dir" if special(path) => format!("path:{}", path.display()),
        "dir" => "type:public.folder".into(),
        "file" if !ext.is_empty() => format!("ext:{ext}"),
        "file" if meta.permissions().mode() & 0o111 != 0 => "type:public.unix-executable".into(),
        "file" => "type:public.data".into(),
        _ => format!("path:{}", path.display()),
    };
    Entry {
        name: name.into(),
        uri: dir.join(name).to_string(),
        kind,
        is_dir,
        size: if kind == "file" { meta.len() } else { 0 },
        mtime: meta.st_mtime(),
        ctime: meta.st_birthtime(),
        hidden: name.starts_with('.') || meta.st_flags() & UF_HIDDEN != 0,
        ext,
        icon,
    }
}

/// Whether a folder has an icon of its own: the home and its well-known folders, the folders of the system, a disk,
/// or a folder given a custom icon (it holds a file named "Icon\r").
fn special(path: &Path) -> bool {
    static KNOWN: OnceLock<Vec<PathBuf>> = OnceLock::new();
    let known = KNOWN.get_or_init(|| {
        let mut known: Vec<PathBuf> = ["/", "/Applications", "/Library", "/System", "/Users", "/Volumes"].iter().map(PathBuf::from).collect();
        if let Some(home) = dirs::home_dir() {
            for sub in ["", "Desktop", "Documents", "Downloads", "Movies", "Music", "Pictures", "Public", "Library", "Applications", "Sites"] {
                known.push(home.join(sub));
            }
        }
        known
    });
    known.iter().any(|k| k == path) || path.parent() == Some(Path::new("/Volumes")) || path.join("Icon\r").exists()
}

/// Renames without ever replacing what is at `to`; a name that differs only in case is allowed, as Finder allows it on
/// a disk that ignores case.
pub fn rename(from: &Path, to: &Path) -> Result<(), String> {
    rename_io(from, to).map_err(|e| if e.kind() == io::ErrorKind::AlreadyExists { exists(to) } else { error(from, &e) })
}

/// `rename` with the system's error, so a caller can tell a move across disks (`CrossesDevices`).
pub fn rename_io(from: &Path, to: &Path) -> io::Result<()> {
    let same_file = |a: &Path, b: &Path| match (fs::symlink_metadata(a), fs::symlink_metadata(b)) {
        (Ok(a), Ok(b)) => a.st_ino() == b.st_ino() && a.st_dev() == b.st_dev(),
        _ => false,
    };
    let c = |p: &Path| CString::new(p.as_os_str().as_bytes()).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput));
    let (cf, ct) = (c(from)?, c(to)?);
    let flags = if same_file(from, to) { 0 } else { RENAME_EXCL };
    // SAFETY: both strings are NUL-terminated and live for the call.
    if unsafe { renamex_np(cf.as_ptr(), ct.as_ptr(), flags) } == 0 { Ok(()) } else { Err(io::Error::last_os_error()) }
}

/// Removes a file, or a folder and all it holds, looking at `cancel` between items.
pub fn delete(path: &Path, cancel: &AtomicBool) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| error(path, &e))?;
    if meta.is_dir() {
        for item in fs::read_dir(path).map_err(|e| error(path, &e))? {
            if cancel.load(Ordering::Relaxed) {
                return Err(tr("Đã hủy", "Cancelled").into());
            }
            let item = item.map_err(|e| error(path, &e))?;
            delete(&item.path(), cancel)?;
        }
        fs::remove_dir(path).map_err(|e| error(path, &e))
    } else {
        fs::remove_file(path).map_err(|e| error(path, &e))
    }
}

/// The name a file has while it is being written, beside where it goes.
pub fn partial_of(target: &Path) -> PathBuf {
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    target.with_file_name(format!(".lazyspace-partial-{name}"))
}

struct Partial {
    file: Option<File>,
    partial: PathBuf,
    target: PathBuf,
}

impl Write for Partial {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.file.as_mut().map_or(Ok(0), |f| f.write(buf))
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.as_mut().map_or(Ok(()), |f| f.flush())
    }
}

impl Commit for Partial {
    fn commit(mut self: Box<Self>) -> Result<(), String> {
        if let Some(file) = self.file.take() {
            file.sync_all().map_err(|e| error(&self.partial, &e))?;
        }
        fs::rename(&self.partial, &self.target).map_err(|e| error(&self.target, &e))
    }
}

impl Drop for Partial {
    /// A writer dropped without `commit` leaves nothing behind.
    fn drop(&mut self) {
        if self.file.take().is_some() {
            let _ = fs::remove_file(&self.partial);
        }
    }
}

/// An error of the file system in words, with the item it concerns.
pub fn error(path: &Path, e: &io::Error) -> String {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
    let why = match e.kind() {
        io::ErrorKind::NotFound => tr("không còn ở đó", "is not there any more").to_owned(),
        io::ErrorKind::PermissionDenied => tr("không có quyền truy cập (macOS có thể cần bạn cho phép trong Cài đặt hệ thống > Quyền riêng tư)", "access is not allowed (macOS may need you to allow it in System Settings > Privacy)").to_owned(),
        io::ErrorKind::AlreadyExists => tr("đã có một mục cùng tên", "an item with that name is already there").to_owned(),
        io::ErrorKind::StorageFull => tr("ổ đĩa đã đầy", "the disk is full").to_owned(),
        io::ErrorKind::DirectoryNotEmpty => tr("thư mục không trống", "the folder is not empty").to_owned(),
        _ => e.to_string(),
    };
    format!("\"{name}\": {why}")
}

fn exists(path: &Path) -> String {
    error(path, &io::Error::from(io::ErrorKind::AlreadyExists))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A fresh folder for one test, removed when the value drops.
    pub struct Temp(pub PathBuf);

    impl Temp {
        pub fn new(name: &str) -> Temp {
            let dir = std::env::temp_dir().join(format!("lazyspace-test-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Temp(dir.canonicalize().unwrap())
        }

        pub fn file(&self, rel: &str, text: &str) -> PathBuf {
            let path = self.0.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, text).unwrap();
            path
        }

        pub fn uri(&self) -> Uri {
            Uri::file(&self.0)
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn names(entries: &[Entry]) -> Vec<String> {
        let mut names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
        names.sort();
        names
    }

    #[test]
    fn list_tells_folders_packages_links_and_hidden_items() {
        let t = Temp::new("list");
        t.file("a.TXT", "hello");
        t.file(".secret", "");
        t.file("Folder/inner", "");
        t.file("Tool.app/Contents/Info.plist", "");
        std::os::unix::fs::symlink(t.0.join("Folder"), t.0.join("link")).unwrap();
        let entries = list(&t.0, &t.uri(), &AtomicBool::new(false)).unwrap();
        assert_eq!(names(&entries), [".secret", "Folder", "Tool.app", "a.TXT", "link"]);
        let get = |n: &str| entries.iter().find(|e| e.name == n).unwrap();
        assert_eq!((get("a.TXT").kind, get("a.TXT").size, get("a.TXT").ext.as_str(), get("a.TXT").icon.as_str()), ("file", 5, "txt", "ext:txt"));
        assert!(get(".secret").hidden && !get("a.TXT").hidden);
        assert_eq!((get("Folder").kind, get("Folder").is_dir, get("Folder").icon.as_str()), ("dir", true, "type:public.folder"));
        assert_eq!((get("Tool.app").kind, get("Tool.app").is_dir), ("app", false));
        assert!(get("Tool.app").icon.starts_with("path:"));
        assert_eq!((get("link").kind, get("link").is_dir), ("link", true));
        assert_eq!(Uri::parse(&get("a.TXT").uri).unwrap().local_path().unwrap(), t.0.join("a.TXT"));
    }

    #[test]
    fn a_missing_folder_is_an_error_in_words() {
        let t = Temp::new("missing");
        let err = list(&t.0.join("nope"), &t.uri(), &AtomicBool::new(false)).unwrap_err();
        assert!(err.contains("nope"), "{err}");
    }

    #[test]
    fn rename_never_replaces_but_allows_a_change_of_case() {
        let t = Temp::new("rename");
        let a = t.file("a.txt", "a");
        let b = t.file("b.txt", "b");
        assert!(rename(&a, &b).is_err());
        assert_eq!(fs::read_to_string(&b).unwrap(), "b", "the target is untouched");
        rename(&a, &t.0.join("c.txt")).unwrap();
        assert!(!a.exists() && t.0.join("c.txt").exists());
        rename(&t.0.join("c.txt"), &t.0.join("C.txt")).unwrap();
        assert!(fs::read_dir(&t.0).unwrap().any(|e| e.unwrap().file_name() == "C.txt"));
    }

    #[test]
    fn a_write_appears_only_when_committed() {
        let t = Temp::new("write");
        let target = t.0.join("out.txt");
        let mut w = Local.write(&Uri::file(&target)).unwrap();
        w.write_all(b"data").unwrap();
        drop(w);
        assert!(!target.exists() && !partial_of(&target).exists(), "a dropped write leaves nothing");
        let mut w = Local.write(&Uri::file(&target)).unwrap();
        w.write_all(b"data").unwrap();
        w.commit().unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "data");
        assert!(!partial_of(&target).exists());
    }

    #[test]
    fn delete_removes_a_tree_and_stops_when_cancelled() {
        let t = Temp::new("delete");
        t.file("d/e/f.txt", "x");
        assert!(delete(&t.0.join("d"), &AtomicBool::new(true)).is_err());
        assert!(t.0.join("d").exists());
        delete(&t.0.join("d"), &AtomicBool::new(false)).unwrap();
        assert!(!t.0.join("d").exists());
    }
}
