//! The Stash Shelf (W7): a basket of files gathered from anywhere (Finder, a pane, a browser, the clipboard) to drag
//! out or work on together later. A file from the disk is kept by reference; text, a link or a picture that is not a
//! file yet is saved as one in the stash folder. `stash://` lists the basket as a folder whose items are the real
//! files, so every action of the core applies to them; removing an item from the shelf never touches a file it only
//! refers to.

use crate::{
    App, Role, SurfaceOptions,
    features::data_file,
    ipc::{Dispatcher, args, event},
    tr,
    vfs::{self, Capabilities, Commit, Entry, Provider, Uri, local, registry},
};
use base64::Engine as _;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSPasteboard, NSPasteboardTypePNG, NSPasteboardTypeString, NSPasteboardTypeTIFF};
use objc2_foundation::NSDictionary;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, atomic::AtomicBool},
};

/// The most items the shelf keeps.
const MAX: usize = 500;
/// The largest item saved from data (a picture dragged from a browser).
const DATA_MAX: usize = 64 << 20;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Item {
    pub path: String,
    pub added: i64,
    /// The file is the shelf's own copy (text, a link, a picture from data), removed with the item.
    #[serde(default)]
    pub saved: bool,
}

fn list_path() -> PathBuf {
    data_file("stash.json")
}

/// The folder of the files the shelf saves itself.
pub fn folder() -> PathBuf {
    data_file("stash")
}

fn lock() -> &'static Mutex<()> {
    static L: OnceLock<Mutex<()>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(()))
}

pub fn load(path: &Path) -> Vec<Item> {
    fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(path: &Path, items: &[Item]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_string_pretty(items).map_err(|e| e.to_string())?).and_then(|()| fs::rename(&temp, path)).map_err(|e| e.to_string())
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// Adds paths to the shelf, newest first, without the ones already on it; returns how many were added.
pub fn add(items: &mut Vec<Item>, paths: &[PathBuf], saved: bool) -> usize {
    let mut added = 0;
    for path in paths {
        let text = path.to_string_lossy().into_owned();
        if items.iter().any(|i| i.path == text) {
            continue;
        }
        items.insert(0, Item { path: text, added: now(), saved });
        added += 1;
    }
    items.truncate(MAX);
    added
}

/// Removes paths from the shelf, deleting the copies it saved itself.
pub fn remove(items: &mut Vec<Item>, paths: &[PathBuf]) {
    items.retain(|item| {
        let gone = paths.iter().any(|p| p.to_string_lossy() == item.path);
        if gone && item.saved && Path::new(&item.path).starts_with(folder()) {
            let _ = fs::remove_file(&item.path);
        }
        !gone
    });
}

/// A name for a file the shelf saves, free in its folder.
fn free_name(dir: &Path, name: &str) -> PathBuf {
    let name = if vfs::valid_name(name).is_ok() { name.to_owned() } else { tr("Mục", "Item").to_owned() };
    if !dir.join(&name).exists() {
        return dir.join(name);
    }
    dir.join(vfs::copy::unique_name(&name, false, false, |n| dir.join(n).exists()))
}

/// Saves data dropped or pasted that is not a file yet (text, a link, a picture) as a file in the stash folder.
pub fn save_data(dir: &Path, name: Option<&str>, text: Option<&str>, url: Option<&str>, bytes: Option<&[u8]>) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| local::error(dir, &e))?;
    let stamp = chrono_like(now());
    let (path, data): (PathBuf, Vec<u8>) = if let Some(bytes) = bytes {
        if bytes.len() > DATA_MAX {
            return Err(tr("Mục quá lớn", "The item is too large").into());
        }
        (free_name(dir, name.unwrap_or(&format!("{} {stamp}.png", tr("Ảnh", "Picture")))), bytes.to_vec())
    } else if let Some(url) = url {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(tr("Chỉ lưu được liên kết http và https", "Only http and https links can be kept").into());
        }
        let host = url.split("://").nth(1).and_then(|r| r.split('/').next()).filter(|h| !h.is_empty()).unwrap_or("link");
        let plist = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict><key>URL</key><string>{}</string></dict></plist>\n",
            url.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
        );
        (free_name(dir, &format!("{host}.webloc")), plist.into_bytes())
    } else if let Some(text) = text {
        (free_name(dir, name.unwrap_or(&format!("{} {stamp}.txt", tr("Văn bản", "Text")))), text.as_bytes().to_vec())
    } else {
        return Err(tr("Không có gì để lưu", "There is nothing to keep").into());
    };
    fs::write(&path, data).map_err(|e| local::error(&path, &e))?;
    Ok(path)
}

/// A time as a file name may hold it: year-month-day at hour.minute, in UTC.
fn chrono_like(secs: i64) -> String {
    let (year, month, day, hour, minute, _) = super::civil(secs);
    format!("{year:04}-{month:02}-{day:02} {hour:02}.{minute:02}")
}

/// What the clipboard holds as files on the shelf: its files, else a picture, else text.
fn from_clipboard(dir: &Path) -> Result<Vec<(PathBuf, bool)>, String> {
    let files = crate::clipboard::read();
    if !files.is_empty() {
        return Ok(files.into_iter().map(|f| (f, false)).collect());
    }
    let pasteboard = NSPasteboard::generalPasteboard();
    // SAFETY: the types are process-lifetime constants of AppKit.
    let png = unsafe { pasteboard.dataForType(NSPasteboardTypePNG) }.map(|d| d.to_vec()).or_else(|| {
        // SAFETY: as above; a TIFF picture is turned into PNG.
        let tiff = unsafe { pasteboard.dataForType(NSPasteboardTypeTIFF) }?;
        let rep = NSBitmapImageRep::imageRepWithData(&tiff)?;
        // SAFETY: an empty properties dictionary is valid for PNG output.
        unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }.map(|d| d.to_vec())
    });
    if let Some(png) = png {
        return Ok(vec![(save_data(dir, None, None, None, Some(&png))?, true)]);
    }
    // SAFETY: as above.
    if let Some(text) = unsafe { pasteboard.stringForType(NSPasteboardTypeString) } {
        let text = text.to_string();
        let url = text.trim();
        let saved = if (url.starts_with("http://") || url.starts_with("https://")) && !url.contains(char::is_whitespace) { save_data(dir, None, None, Some(url), None)? } else { save_data(dir, None, Some(&text), None, None)? };
        return Ok(vec![(saved, true)]);
    }
    Err(tr("Bảng nhớ tạm không có gì để giữ", "There is nothing on the clipboard to keep").into())
}

/// The items of the shelf that still exist, as entries of the real files, under names unique on the shelf: the
/// folder's name is added to a name two items share.
pub fn entries_of(items: &[Item]) -> Vec<Entry> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut out = Vec::new();
    for item in items {
        let path = PathBuf::from(&item.path);
        let Ok(meta) = fs::symlink_metadata(&path) else { continue };
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let parent = Uri::file(path.parent().unwrap_or(Path::new("/")));
        let mut entry = local::entry(&parent, &name, &path, &meta);
        let count = seen.entry(name.to_lowercase()).or_insert(0);
        *count += 1;
        if *count > 1 {
            entry.name = format!("{name} ({})", parent.name());
        }
        entry.hidden = false;
        out.push(entry);
    }
    out
}

/// The shelf as a folder.
pub struct StashProvider;

impl Provider for StashProvider {
    fn capabilities(&self, _: &Uri) -> Capabilities {
        Capabilities { write: false, rename: false, trash: false, watch: false, sizes: false, local_path: false }
    }

    fn list(&self, _uri: &Uri, _cancel: &AtomicBool) -> Result<Vec<Entry>, String> {
        Ok(entries_of(&load(&list_path())))
    }

    fn stat(&self, uri: &Uri) -> Result<Entry, String> {
        Ok(Entry { name: tr("Khay tạm", "Stash").into(), uri: uri.to_string(), kind: "dir", is_dir: true, size: 0, mtime: now(), ctime: now(), hidden: false, ext: String::new(), icon: "type:public.folder".into() })
    }

    fn read(&self, _: &Uri) -> Result<Box<dyn Read + Send>, String> {
        Err(tr("Hãy mở mục từ khay", "Open the item from the shelf").into())
    }
    fn write(&self, _: &Uri) -> Result<Box<dyn Commit>, String> {
        Err(tr("Thả tệp vào khay để thêm", "Drop files on the shelf to add them").into())
    }
    fn mkdir(&self, _: &Uri) -> Result<(), String> {
        Err(tr("Khay tạm không có thư mục con", "The shelf has no folders of its own").into())
    }
    fn rename(&self, _: &Uri, _: &Uri) -> Result<(), String> {
        Err(tr("Không đổi tên trên khay", "Items are not renamed on the shelf").into())
    }
    fn delete(&self, _: &Uri, _: &AtomicBool) -> Result<(), String> {
        Err(tr("Dùng \"Bỏ khỏi khay\"", "Use \"Remove from Shelf\"").into())
    }
}

/// Changes the shelf under its lock and tells every window.
fn change(app: &mut App, f: impl FnOnce(&mut Vec<Item>) -> Result<Value, String>) -> Result<Value, String> {
    let result = {
        let _guard = lock().lock().map_err(|e| e.to_string())?;
        let mut items = load(&list_path());
        let result = f(&mut items)?;
        save(&list_path(), &items)?;
        result
    };
    let count = load(&list_path()).len();
    app.post_all(event("stash.changed", json!({ "count": count })));
    Ok(result)
}

fn local_paths(uris: &[String]) -> Result<Vec<PathBuf>, String> {
    uris.iter().map(|u| Uri::parse(u)?.local_path().ok_or_else(|| tr("Chỉ với tệp trên máy", "Only files on this Mac").to_owned())).collect()
}

/// The shelf window: on the right of the main screen, above other windows, on every Space.
fn show(app: &mut App, on: bool) {
    let open = app.surfaces.values().find(|s| s.role == Role::Shelf).map(|s| s.id);
    match (open, on) {
        (Some(id), false) => app.close_surface(id),
        (None, true) => {
            app.open_surface(Role::Shelf, SurfaceOptions { uri: Some("stash://".into()), frame: None, transparent: true, always_on_top: true, decorations: false });
        }
        _ => {}
    }
}

pub fn register(d: &mut Dispatcher) {
    registry().add("stash", Arc::new(StashProvider));
    d.on("stash.add", |app, _, a| {
        #[derive(Deserialize)]
        struct Add {
            uris: Vec<String>,
        }
        let paths = local_paths(&args::<Add>(a)?.uris)?;
        change(app, |items| Ok(json!({ "added": add(items, &paths, false) })))
    });
    d.on("stash.add_data", |app, _, a| {
        #[derive(Deserialize)]
        struct Data {
            name: Option<String>,
            text: Option<String>,
            url: Option<String>,
            base64: Option<String>,
        }
        let a: Data = args(a)?;
        let bytes = a.base64.map(|b| base64::engine::general_purpose::STANDARD.decode(b.as_bytes()).map_err(|e| e.to_string())).transpose()?;
        let path = save_data(&folder(), a.name.as_deref(), a.text.as_deref(), a.url.as_deref(), bytes.as_deref())?;
        change(app, |items| Ok(json!({ "added": add(items, &[path], true) })))
    });
    d.on("stash.add_clipboard", |app, _, _| {
        let found = from_clipboard(&folder())?;
        change(app, |items| {
            let mut added = 0;
            for (path, saved) in &found {
                added += add(items, std::slice::from_ref(path), *saved);
            }
            Ok(json!({ "added": added }))
        })
    });
    d.on("stash.remove", |app, _, a| {
        #[derive(Deserialize)]
        struct Remove {
            uris: Vec<String>,
        }
        let paths = local_paths(&args::<Remove>(a)?.uris)?;
        change(app, |items| {
            remove(items, &paths);
            Ok(Value::Null)
        })
    });
    d.on("stash.clear", |app, _, _| {
        change(app, |items| {
            let all: Vec<PathBuf> = items.iter().map(|i| PathBuf::from(&i.path)).collect();
            remove(items, &all);
            Ok(Value::Null)
        })
    });
    d.on("stash.count", |_, _, _| Ok(json!(load(&list_path()).len())));
    d.on("stash.items", |_, _, _| serde_json::to_value(entries_of(&load(&list_path()))).map_err(|e| e.to_string()));
    d.on("stash.show", |app, _, a| {
        #[derive(Deserialize)]
        struct Show {
            on: Option<bool>,
        }
        let open = app.surfaces.values().any(|s| s.role == Role::Shelf);
        show(app, args::<Show>(a)?.on.unwrap_or(!open));
        Ok(Value::Null)
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;

    #[test]
    fn add_dedupes_and_keeps_order() {
        let mut items = Vec::new();
        assert_eq!(add(&mut items, &[PathBuf::from("/a"), PathBuf::from("/b")], false), 2);
        assert_eq!(add(&mut items, &[PathBuf::from("/a"), PathBuf::from("/c")], false), 1);
        assert_eq!(items.iter().map(|i| i.path.as_str()).collect::<Vec<_>>(), ["/c", "/b", "/a"], "newest first");
        remove(&mut items, &[PathBuf::from("/b")]);
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn clipboard_text_becomes_a_file_in_stash_dir() {
        let t = Temp::new("stash-data");
        let text = save_data(&t.0, None, Some("ghi chú"), None, None).unwrap();
        assert!(text.starts_with(&t.0) && text.extension().unwrap() == "txt");
        assert_eq!(fs::read_to_string(&text).unwrap(), "ghi chú");
        let link = save_data(&t.0, None, None, Some("https://example.com/a?b=1&c=2"), None).unwrap();
        assert_eq!(link.file_name().unwrap(), "example.com.webloc");
        assert!(fs::read_to_string(&link).unwrap().contains("&amp;c=2"));
        assert!(save_data(&t.0, None, None, Some("file:///etc/passwd"), None).is_err());
        let png = save_data(&t.0, Some("shot.png"), None, None, Some(b"\x89PNG")).unwrap();
        assert_eq!(png.file_name().unwrap(), "shot.png");
        assert_eq!(save_data(&t.0, Some("shot.png"), None, None, Some(b"x")).unwrap().file_name().unwrap(), "shot 2.png");
        assert_eq!(chrono_like(0), "1970-01-01 00.00");
        assert_eq!(chrono_like(1_704_067_200 + 3_660), "2024-01-01 01.01");
    }

    #[test]
    fn stash_provider_lists_items_as_entries() {
        let t = Temp::new("stash-provider");
        let a = t.file("one/same.txt", "1");
        let b = t.file("two/same.txt", "2");
        let gone = t.0.join("gone.txt");
        let items: Vec<Item> = [&a, &b, &gone].iter().map(|p| Item { path: p.to_string_lossy().into(), added: 0, saved: false }).collect();
        let entries = entries_of(&items);
        assert_eq!(entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["same.txt", "same.txt (two)"], "a missing file is left out");
        assert_eq!(Uri::parse(&entries[1].uri).unwrap().local_path().unwrap(), b, "the entry is the real file");
        // A saved copy goes with its item; a file referred to stays.
        let mut list = items.clone();
        remove(&mut list, &[a.clone()]);
        assert!(a.exists());
    }
}
