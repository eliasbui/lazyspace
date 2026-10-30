//! What a folder holds by size, and the files in it that are the same, as jobs. The map is two levels of the folder,
//! each item with the bytes of everything under it, for the page to draw as rectangles (as DaisyDisk does); a folder
//! of the map can be mapped in turn. Twins are found as the tools for it find them: files of one size, then the same
//! first 64 KiB, then the same SHA-256 of the whole, so only files that may be twins are read through.

use crate::{
    ipc::{Dispatcher, args},
    jobs::Ctx,
    tr,
    vfs::{Uri, local},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

/// The most items of one level of the map; the rest are one item, "other items".
const MAP_ITEMS: usize = 60;
/// The bytes read of each file of one size before the whole of it.
const HEAD: usize = 64 * 1024;
/// The most groups of twins given back.
const TWIN_GROUPS: usize = 500;

/// One item of the map: its name, its path, its bytes, and for a folder the items in it down to the depth asked for.
struct Node {
    name: String,
    path: PathBuf,
    size: u64,
    dir: bool,
    children: Vec<Node>,
}

impl Node {
    fn json(&self, other: &str) -> Value {
        let mut children: Vec<&Node> = self.children.iter().collect();
        children.sort_by(|a, b| b.size.cmp(&a.size));
        let rest: u64 = children.iter().skip(MAP_ITEMS).map(|c| c.size).sum();
        let mut out: Vec<Value> = children.iter().take(MAP_ITEMS).map(|c| c.json(other)).collect();
        if rest > 0 {
            out.push(json!({ "name": other, "size": rest, "other": true }));
        }
        json!({ "name": self.name, "path": self.path, "size": self.size, "dir": self.dir, "children": out })
    }
}

/// The bytes under `path`, keeping its items down to `depth` levels; None when the job is cancelled. Links are not
/// followed, and a package (an app) counts as one item.
fn measure(path: &Path, depth: u32, ctx: &Ctx, seen: &mut u64) -> Option<Node> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned());
    let mut node = Node { name, path: path.to_path_buf(), size: 0, dir: true, children: Vec::new() };
    let Ok(items) = fs::read_dir(path) else { return Some(node) };
    for item in items.flatten() {
        *seen += 1;
        if *seen % 512 == 0 {
            if ctx.cancelled() {
                return None;
            }
            ctx.progress(*seen, 0, &item.path().to_string_lossy());
        }
        let Ok(meta) = item.metadata() else { continue };
        let child = if meta.is_dir() {
            let inner = measure(&item.path(), depth.saturating_sub(1), ctx, seen)?;
            let package = Path::new(&inner.name).extension().is_some_and(|e| local::is_package(&e.to_string_lossy()));
            Node { children: if depth > 1 && !package { inner.children } else { Vec::new() }, dir: !package, ..inner }
        } else {
            Node { name: item.file_name().to_string_lossy().into_owned(), path: item.path(), size: meta.len(), dir: false, children: Vec::new() }
        };
        node.size += child.size;
        if depth > 0 {
            node.children.push(child);
        }
    }
    Some(node)
}

/// The files under `folder` worth comparing: not hidden, not empty, not inside a package, links left out.
fn files(folder: &Path, ctx: &Ctx) -> Vec<(PathBuf, u64)> {
    let mut out = Vec::new();
    let mut stack = vec![folder.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(items) = fs::read_dir(&dir) else { continue };
        for item in items.flatten() {
            if ctx.cancelled() {
                return out;
            }
            let name = item.file_name().to_string_lossy().into_owned();
            let Ok(meta) = item.metadata() else { continue };
            if name.starts_with('.') || meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                if !Path::new(&name).extension().is_some_and(|e| local::is_package(&e.to_string_lossy())) {
                    stack.push(item.path());
                }
            } else if meta.len() > 0 {
                out.push((item.path(), meta.len()));
            }
        }
    }
    out
}

/// The SHA-256 of the first `limit` bytes of a file (all of it with None).
pub(crate) fn digest(path: &Path, limit: Option<usize>) -> Option<[u8; 32]> {
    let mut file = fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut left = limit.unwrap_or(usize::MAX);
    while left > 0 {
        let take = buf.len().min(left);
        let n = file.read(&mut buf[..take]).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        left -= n;
    }
    Some(hasher.finalize().into())
}

/// The groups of files that are the same, the most space they waste first: by size, then by their first bytes, then
/// by the whole of them.
pub fn twins(candidates: Vec<(PathBuf, u64)>, ctx: &Ctx) -> Vec<(u64, Vec<PathBuf>)> {
    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    for (path, size) in candidates {
        by_size.entry(size).or_default().push(path);
    }
    let sizes: Vec<(u64, Vec<PathBuf>)> = by_size.into_iter().filter(|(_, p)| p.len() > 1).collect();
    let total: u64 = sizes.iter().map(|(_, p)| p.len() as u64).sum();
    let mut done = 0u64;
    let mut groups = Vec::new();
    for (size, paths) in sizes {
        let mut by_head: HashMap<[u8; 32], Vec<PathBuf>> = HashMap::new();
        for path in paths {
            done += 1;
            if ctx.cancelled() {
                return Vec::new();
            }
            ctx.progress(done, total, &path.to_string_lossy());
            if let Some(head) = digest(&path, Some(HEAD)) {
                by_head.entry(head).or_default().push(path);
            }
        }
        for (_, same_head) in by_head.into_iter().filter(|(_, p)| p.len() > 1) {
            // A file no longer than the head was read whole already.
            if size as usize <= HEAD {
                groups.push((size, same_head));
                continue;
            }
            let mut by_whole: HashMap<[u8; 32], Vec<PathBuf>> = HashMap::new();
            for path in same_head {
                if let Some(whole) = digest(&path, None) {
                    by_whole.entry(whole).or_default().push(path);
                }
            }
            groups.extend(by_whole.into_values().filter(|p| p.len() > 1).map(|p| (size, p)));
        }
    }
    for (_, paths) in &mut groups {
        paths.sort();
    }
    groups.sort_by(|a, b| (b.0 * (b.1.len() as u64 - 1)).cmp(&(a.0 * (a.1.len() as u64 - 1))).then_with(|| a.1.cmp(&b.1)));
    groups.truncate(TWIN_GROUPS);
    groups
}

fn local_folder(uri: &str) -> Result<PathBuf, String> {
    Uri::parse(uri)?.local_path().filter(|p| p.is_dir()).ok_or_else(|| tr("Chỉ với thư mục trên máy", "Only folders of this Mac").to_owned())
}

pub fn register(d: &mut Dispatcher) {
    #[derive(Deserialize)]
    struct Folder {
        uri: String,
    }
    d.on("disk.map", |app, window, a| {
        let folder = local_folder(&args::<Folder>(a)?.uri)?;
        let title = format!("{} \"{}\"", tr("Đo dung lượng", "Measure"), folder.file_name().map(|n| n.to_string_lossy()).unwrap_or_default());
        let job = app.jobs.spawn(&app.proxy, Some(window), "disk", title, move |ctx| {
            let mut seen = 0;
            let node = measure(&folder, 2, ctx, &mut seen).ok_or("cancelled")?;
            Ok(json!({ "map": node.json(tr("Các mục khác", "Other items")) }))
        }, None);
        Ok(json!({ "job": job }))
    });
    d.on("disk.twins", |app, window, a| {
        let folder = local_folder(&args::<Folder>(a)?.uri)?;
        let title = format!("{} \"{}\"", tr("Tìm tệp trùng trong", "Find twins in"), folder.file_name().map(|n| n.to_string_lossy()).unwrap_or_default());
        let job = app.jobs.spawn(&app.proxy, Some(window), "twins", title, move |ctx| {
            let found = twins(files(&folder, ctx), ctx);
            if ctx.cancelled() {
                return Err("cancelled".into());
            }
            let groups: Vec<Value> = found.iter().map(|(size, paths)| json!({ "size": size, "uris": paths.iter().map(|p| Uri::file(p).to_string()).collect::<Vec<_>>() })).collect();
            Ok(json!({ "twins": groups, "folder": Uri::file(&folder).to_string() }))
        }, None);
        Ok(json!({ "job": job }))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{jobs::test_ctx, vfs::local::tests::Temp};

    #[test]
    fn the_map_adds_up_what_is_under_each_item_two_levels_down() {
        let t = Temp::new("disk-map");
        t.file("a/b/c.bin", &"x".repeat(300));
        t.file("a/d.bin", &"x".repeat(100));
        t.file("e.bin", &"x".repeat(50));
        t.file("App.app/Contents/big", &"x".repeat(1000));
        let (ctx, _answers, _cancel) = test_ctx();
        let node = measure(&t.0, 2, &ctx, &mut 0).unwrap();
        assert_eq!(node.size, 1450);
        let map = node.json("other");
        let children = map["children"].as_array().unwrap();
        assert_eq!(children.iter().map(|c| (c["name"].as_str().unwrap(), c["size"].as_u64().unwrap())).collect::<Vec<_>>(), [("App.app", 1000), ("a", 400), ("e.bin", 50)]);
        assert_eq!(children[0]["dir"], false, "an app is one item");
        let a = &children[1]["children"];
        assert_eq!(a.as_array().unwrap().iter().map(|c| c["size"].as_u64().unwrap()).collect::<Vec<_>>(), [300, 100]);
        assert!(a[0]["children"].as_array().unwrap().is_empty(), "two levels and no more");
    }

    #[test]
    fn twins_are_the_same_bytes_not_only_the_same_size() {
        let t = Temp::new("disk-twins");
        let big = "y".repeat(HEAD + 10);
        let mut other = big.clone();
        other.push('z');
        other.remove(0);
        t.file("one/a.txt", "same");
        t.file("two/b.txt", "same");
        t.file("c.txt", "diff");
        t.file("big1", &big);
        t.file("big2", &big);
        t.file("big3", &other);
        t.file(".hidden", "same");
        let (ctx, _answers, _cancel) = test_ctx();
        let found = twins(files(&t.0, &ctx), &ctx);
        let names: Vec<Vec<String>> = found.iter().map(|(_, p)| p.iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect()).collect();
        assert_eq!(names, [vec!["big1", "big2"], vec!["a.txt", "b.txt"]], "the most wasted first; same size, other bytes are not twins");
    }
}
