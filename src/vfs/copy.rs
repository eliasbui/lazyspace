//! Copying and moving between any two places. Within this Mac, a move is a rename and a copy is the system's own
//! (`fs::copy`, which clones on APFS and keeps extended attributes); between providers, bytes go through in blocks.
//! An item already at the target is never replaced without the user's answer, a replacement is written beside the
//! old item and swapped in only once whole, and a cut-short copy removes what it had written.

use super::{Entry, Provider, Uri, local, registry};
use crate::{
    jobs::{Answer, Ctx, Question},
    tr,
};
use serde_json::{Value, json};
use std::{
    fs, io,
    io::{Read, Write},
    path::Path,
};

/// How much is read and written at once between providers.
const BLOCK: usize = 1 << 20;

/// Where each item went, and how many were skipped.
#[derive(Debug, Default)]
pub struct Done {
    pub pairs: Vec<(Uri, Uri)>,
    pub skipped: usize,
}

struct Run<'a> {
    ctx: &'a Ctx,
    done: u64,
    total: u64,
    out: Done,
}

impl Run<'_> {
    fn step(&mut self, bytes: u64, name: &str) {
        self.done += bytes.max(1);
        self.ctx.progress(self.done.min(self.total), self.total, name);
    }

    fn check(&self) -> Result<(), String> {
        if self.ctx.cancelled() { Err(cancelled()) } else { Ok(()) }
    }
}

fn cancelled() -> String {
    tr("Đã hủy", "Cancelled").into()
}

/// Copies, or moves when `mv`, each of `from` into the folder `to`.
pub fn transfer(ctx: &Ctx, from: &[Uri], to: &Uri, mv: bool) -> Result<Done, String> {
    for src in from {
        if src.scheme == to.scheme && src.authority == to.authority && (to.path == src.path || to.path.starts_with(&format!("{}/", src.path))) {
            return Err(format!("\"{}\": {}", src.name(), tr("không thể chép hay chuyển một thư mục vào chính nó", "a folder cannot be copied or moved into itself")));
        }
    }
    let total = from.iter().map(tree_size).sum::<u64>().max(from.len() as u64);
    let mut run = Run { ctx, done: 0, total, out: Done::default() };
    for src in from {
        run.check()?;
        transfer_item(&mut run, src, &to.join(&src.name()), mv)?;
    }
    ctx.progress(run.total, run.total, "");
    Ok(run.out)
}

fn same_place(a: &Uri, b: &Uri) -> bool {
    a == b
}

/// Whether two places are on one server or in one cloud account: the same provider and the same connection or remote.
fn same_account(a: &Uri, b: &Uri) -> bool {
    a.scheme == b.scheme && a.authority == b.authority
}

fn summary(entry: &Entry) -> Value {
    json!({ "size": entry.size, "mtime": entry.mtime, "isDir": entry.is_dir })
}

/// A folder on disk, whatever Finder shows it as.
fn physical_dir(entry: &Entry) -> bool {
    matches!(entry.kind, "dir" | "app" | "package")
}

fn transfer_item(run: &mut Run, src: &Uri, target: &Uri, mv: bool) -> Result<(), String> {
    let (sp, dp) = (registry().get(src)?, registry().get(target)?);
    let entry = sp.stat(src)?;
    let mut target = target.clone();
    let mut replace = None;
    if let Ok(existing) = dp.stat(&target) {
        if same_place(src, &target) {
            if mv {
                run.out.skipped += 1;
                return Ok(());
            }
            target = unique(&*dp, &target, true, physical_dir(&entry))?;
        } else {
            let folders = entry.kind == "dir" && existing.kind == "dir";
            let question = Question::Conflict { name: entry.name.clone(), folder: folders, source: summary(&entry), target: summary(&existing) };
            match run.ctx.ask(question) {
                Answer::Replace => replace = Some(existing),
                Answer::KeepBoth => target = unique(&*dp, &target, false, physical_dir(&entry))?,
                Answer::Merge if folders => return merge(run, &*sp, src, &target, mv),
                Answer::Stop => return Err(cancelled()),
                _ => {
                    run.out.skipped += 1;
                    run.step(tree_size(src), &entry.name);
                    return Ok(());
                }
            }
        }
    }
    // A move within this Mac is a rename, unless it crosses disks.
    if mv && replace.is_none() && src.scheme == "file" && target.scheme == "file" {
        match local::rename_io(Path::new(&src.path), Path::new(&target.path)) {
            Ok(()) => {
                run.step(tree_size(&target), &entry.name);
                run.out.pairs.push((src.clone(), target));
                return Ok(());
            }
            Err(e) if e.kind() == io::ErrorKind::CrossesDevices => {}
            Err(e) => return Err(local::error(Path::new(&src.path), &e)),
        }
    }
    // A move within one server or one cloud account is its own rename (rclone's `moveto`, done by the cloud itself),
    // so nothing goes through this Mac; where that fails, the copy below does it.
    if mv && replace.is_none() && src.scheme != "file" && same_account(src, &target) && sp.capabilities(src).rename && dp.rename(src, &target).is_ok() {
        run.step(entry.size, &entry.name);
        run.out.pairs.push((src.clone(), target));
        return Ok(());
    }
    let write_to = match &replace {
        Some(_) => unique(&*dp, &target.parent().unwrap_or_else(|| target.clone()).join(&format!(".lazyspace-replace-{}", entry.name)), false, false)?,
        None => target.clone(),
    };
    copy_tree(run, &*sp, &*dp, src, &entry, &write_to)?;
    if replace.is_some() {
        dp.delete(&target, run.ctx.cancel_flag())?;
        dp.rename(&write_to, &target)?;
    }
    if mv {
        sp.delete(src, run.ctx.cancel_flag())?;
    }
    run.out.pairs.push((src.clone(), target));
    Ok(())
}

/// Puts what the folder `src` holds into the folder `target`, asking about each item already there.
fn merge(run: &mut Run, sp: &dyn Provider, src: &Uri, target: &Uri, mv: bool) -> Result<(), String> {
    for child in sp.list(src, run.ctx.cancel_flag())? {
        run.check()?;
        if !safe_child(run, &child) {
            continue;
        }
        transfer_item(run, &Uri::parse(&child.uri)?, &target.join(&child.name), mv)?;
    }
    if mv && sp.list(src, run.ctx.cancel_flag()).is_ok_and(|rest| rest.is_empty()) {
        sp.delete(src, run.ctx.cancel_flag())?;
    }
    run.out.pairs.push((src.clone(), target.clone()));
    Ok(())
}

/// Copies one item, a folder with all it holds, to `target`, which is not there yet. What was written is removed if
/// the copy fails or is cancelled.
fn copy_tree(run: &mut Run, sp: &dyn Provider, dp: &dyn Provider, src: &Uri, entry: &Entry, target: &Uri) -> Result<(), String> {
    run.check()?;
    let local = src.scheme == "file" && target.scheme == "file";
    if entry.kind == "link" && local {
        let link = fs::read_link(&src.path).map_err(|e| local::error(Path::new(&src.path), &e))?;
        std::os::unix::fs::symlink(&link, &target.path).map_err(|e| local::error(Path::new(&target.path), &e))?;
        run.step(0, &entry.name);
        return Ok(());
    }
    if physical_dir(entry) || (entry.kind == "link" && entry.is_dir) {
        dp.mkdir(target)?;
        let copied = (|| {
            for child in sp.list(src, run.ctx.cancel_flag())? {
                if !safe_child(run, &child) {
                    continue;
                }
                let child_src = Uri::parse(&child.uri)?;
                copy_tree(run, sp, dp, &child_src, &child, &target.join(&child.name))?;
            }
            Ok(())
        })();
        if copied.is_err() {
            let _ = dp.delete(target, &std::sync::atomic::AtomicBool::new(false));
        }
        return copied;
    }
    if local {
        let partial = local::partial_of(Path::new(&target.path));
        let copied = fs::copy(&src.path, &partial).map_err(|e| local::error(Path::new(&src.path), &e)).and_then(|_| {
            run.check()?;
            fs::rename(&partial, &target.path).map_err(|e| local::error(Path::new(&target.path), &e))
        });
        if copied.is_err() {
            let _ = fs::remove_file(&partial);
        }
        copied?;
        run.step(entry.size, &entry.name);
        return Ok(());
    }
    let mut reader = sp.read(src)?;
    let mut writer = dp.write(target)?;
    let mut buf = vec![0u8; BLOCK];
    loop {
        run.check()?;
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        run.done += n as u64;
        run.ctx.progress(run.done.min(run.total), run.total, &entry.name);
    }
    writer.commit()?;
    run.step(0, &entry.name);
    Ok(())
}

/// Whether an item a folder lists may be copied by its name: a server could name one "..", or put a slash in it, to
/// write outside the folder the copy goes to. Such an item is skipped.
fn safe_child(run: &mut Run, child: &Entry) -> bool {
    let safe = super::valid_name(&child.name).is_ok();
    if !safe {
        run.out.skipped += 1;
    }
    safe
}

/// The bytes of an item and all it holds, for the progress bar; a place that is not on this Mac counts its own size.
fn tree_size(uri: &Uri) -> u64 {
    fn walk(path: &Path) -> u64 {
        match fs::symlink_metadata(path) {
            Ok(meta) if meta.is_dir() => fs::read_dir(path).map(|d| d.flatten().map(|e| walk(&e.path())).sum()).unwrap_or(0),
            Ok(meta) => meta.len().max(1),
            Err(_) => 0,
        }
    }
    match uri.local_path() {
        Some(path) => walk(&path),
        None => registry().get(uri).and_then(|p| p.stat(uri)).map(|e| e.size).unwrap_or(0),
    }
}

/// A name for `target` that nothing in its folder has: "a 2.txt", "a 3.txt" as Finder keeps both, or "a copy.txt",
/// "a copy 2.txt" for a copy into the folder the item is already in.
fn unique(provider: &dyn Provider, target: &Uri, copy: bool, folder: bool) -> Result<Uri, String> {
    let parent = target.parent().ok_or_else(|| tr("Không có thư mục chứa", "There is no enclosing folder").to_owned())?;
    let name = unique_name(&target.name(), copy, folder, |n| provider.stat(&parent.join(n)).is_ok());
    Ok(parent.join(&name))
}

pub fn unique_name(name: &str, copy: bool, folder: bool, taken: impl Fn(&str) -> bool) -> String {
    let (stem, ext) = match name.rfind('.') {
        Some(dot) if !folder && dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name, ""),
    };
    if copy {
        let word = tr("bản sao", "copy");
        let first = format!("{stem} {word}{ext}");
        if !taken(&first) {
            return first;
        }
        return (2..).map(|n| format!("{stem} {word} {n}{ext}")).find(|n| !taken(n)).expect("a free name");
    }
    // "a 2" goes on to "a 3", not "a 2 2".
    let base = match stem.rsplit_once(' ') {
        Some((head, tail)) if !head.is_empty() && !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit()) => head,
        _ => stem,
    };
    (2..).map(|n| format!("{base} {n}{ext}")).find(|n| !taken(n)).expect("a free name")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{jobs::test_ctx, vfs::Commit, vfs::Capabilities, vfs::local::tests::Temp};
    use std::{
        sync::{Arc, atomic::AtomicBool},
        thread,
        time::Duration,
    };

    #[test]
    fn names_are_kept_unique_like_finder() {
        let taken = |set: &'static [&'static str]| move |n: &str| set.contains(&n);
        assert_eq!(unique_name("a.txt", false, false, taken(&["a.txt"])), "a 2.txt");
        assert_eq!(unique_name("a.txt", false, false, taken(&["a.txt", "a 2.txt"])), "a 3.txt");
        assert_eq!(unique_name("a 2.txt", false, false, taken(&["a 2.txt"])), "a 3.txt");
        assert_eq!(unique_name("My.Folder", false, true, taken(&[])), "My.Folder 2");
        assert_eq!(unique_name(".hidden", false, false, taken(&[])), ".hidden 2");
        let copy = unique_name("a.txt", true, false, taken(&[]));
        assert!(copy == "a bản sao.txt" || copy == "a copy.txt", "{copy}");
    }

    #[test]
    fn copy_asks_once_with_apply_all_and_keep_both_numbers_like_finder() {
        let t = Temp::new("copy-ask");
        let a = t.file("src/a.txt", "new a");
        let b = t.file("src/b.txt", "new b");
        t.file("dst/a.txt", "old a");
        t.file("dst/b.txt", "old b");
        let (ctx, answers, _) = test_ctx();
        answers.send((Answer::KeepBoth, true)).unwrap();
        let done = transfer(&ctx, &[Uri::file(&a), Uri::file(&b)], &Uri::file(&t.0.join("dst")), false).unwrap();
        assert_eq!(done.pairs.len(), 2);
        for (name, text) in [("a.txt", "old a"), ("a 2.txt", "new a"), ("b.txt", "old b"), ("b 2.txt", "new b")] {
            assert_eq!(fs::read_to_string(t.0.join("dst").join(name)).unwrap(), text, "{name}");
        }
        assert!(a.exists() && b.exists(), "a copy leaves the sources");
    }

    #[test]
    fn replace_and_skip_and_a_copy_into_its_own_folder() {
        let t = Temp::new("copy-replace");
        let a = t.file("src/a.txt", "new");
        t.file("dst/a.txt", "old");
        let (ctx, answers, _) = test_ctx();
        answers.send((Answer::Skip, false)).unwrap();
        let dst = Uri::file(&t.0.join("dst"));
        assert_eq!(transfer(&ctx, &[Uri::file(&a)], &dst, false).unwrap().skipped, 1);
        assert_eq!(fs::read_to_string(t.0.join("dst/a.txt")).unwrap(), "old");
        answers.send((Answer::Replace, false)).unwrap();
        transfer(&ctx, &[Uri::file(&a)], &dst, false).unwrap();
        assert_eq!(fs::read_to_string(t.0.join("dst/a.txt")).unwrap(), "new");
        assert_eq!(fs::read_dir(t.0.join("dst")).unwrap().count(), 1, "no replacement file is left beside it");
        let done = transfer(&ctx, &[Uri::file(&a)], &Uri::file(&t.0.join("src")), false).unwrap();
        assert!(done.pairs[0].1.name().ends_with(".txt") && done.pairs[0].1 != Uri::file(&a), "a duplicate gets a name of its own");
        assert_eq!(fs::read_dir(t.0.join("src")).unwrap().count(), 2);
    }

    #[test]
    fn folders_copy_whole_and_merge_when_asked() {
        let t = Temp::new("copy-folder");
        t.file("src/d/one.txt", "1");
        t.file("src/d/sub/two.txt", "2");
        t.file("dst/d/three.txt", "3");
        let (ctx, answers, _) = test_ctx();
        answers.send((Answer::Merge, false)).unwrap();
        transfer(&ctx, &[Uri::file(&t.0.join("src/d"))], &Uri::file(&t.0.join("dst")), false).unwrap();
        for rel in ["dst/d/one.txt", "dst/d/sub/two.txt", "dst/d/three.txt"] {
            assert!(t.0.join(rel).exists(), "{rel}");
        }
        let err = transfer(&ctx, &[Uri::file(&t.0.join("src"))], &Uri::file(&t.0.join("src/d")), false).unwrap_err();
        assert!(err.contains("src"), "{err}");
    }

    #[test]
    fn a_move_within_the_disk_renames() {
        let t = Temp::new("move");
        let a = t.file("src/a.txt", "a");
        t.file("dst/keep.txt", "");
        let (ctx, _answers, _) = test_ctx();
        let done = transfer(&ctx, &[Uri::file(&a)], &Uri::file(&t.0.join("dst")), true).unwrap();
        assert!(!a.exists() && t.0.join("dst/a.txt").exists());
        assert_eq!(done.pairs, vec![(Uri::file(&a), Uri::file(&t.0.join("dst/a.txt")))]);
    }

    /// The local disk under another scheme and without its shortcuts, so a copy between it and `file` goes through
    /// the readers and writers of the providers, as one with a server would.
    struct Elsewhere;

    impl Provider for Elsewhere {
        fn capabilities(&self, _: &Uri) -> Capabilities {
            Capabilities { write: true, rename: true, trash: false, watch: false, sizes: false, local_path: false }
        }
        fn list(&self, uri: &Uri, cancel: &AtomicBool) -> Result<Vec<Entry>, String> {
            local::list(Path::new(&uri.path), uri, cancel)
        }
        fn stat(&self, uri: &Uri) -> Result<Entry, String> {
            let mut entry = local::Local.stat(&Uri::file(Path::new(&uri.path)))?;
            entry.uri = uri.to_string();
            Ok(entry)
        }
        fn read(&self, uri: &Uri) -> Result<Box<dyn Read + Send>, String> {
            // Slow enough for a cancel to land in the middle.
            struct Slow(fs::File);
            impl Read for Slow {
                fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
                    thread::sleep(Duration::from_millis(5));
                    let n = buf.len().min(4096);
                    self.0.read(&mut buf[..n])
                }
            }
            Ok(Box::new(Slow(fs::File::open(&uri.path).map_err(|e| e.to_string())?)))
        }
        fn write(&self, uri: &Uri) -> Result<Box<dyn Commit>, String> {
            local::Local.write(&Uri::file(Path::new(&uri.path)))
        }
        fn mkdir(&self, uri: &Uri) -> Result<(), String> {
            local::Local.mkdir(&Uri::file(Path::new(&uri.path)))
        }
        fn rename(&self, from: &Uri, to: &Uri) -> Result<(), String> {
            local::rename(Path::new(&from.path), Path::new(&to.path))
        }
        fn delete(&self, uri: &Uri, cancel: &AtomicBool) -> Result<(), String> {
            local::delete(Path::new(&uri.path), cancel)
        }
    }

    fn elsewhere(path: &Path) -> Uri {
        registry().add("elsewhere", Arc::new(Elsewhere));
        Uri { scheme: "elsewhere".into(), ..Uri::file(path) }
    }

    #[test]
    fn move_across_providers_copies_then_deletes() {
        let t = Temp::new("move-across");
        t.file("src/d/a.txt", "a");
        fs::create_dir(t.0.join("dst")).unwrap();
        let (ctx, _answers, _) = test_ctx();
        transfer(&ctx, &[elsewhere(&t.0.join("src/d"))], &Uri::file(&t.0.join("dst")), true).unwrap();
        assert_eq!(fs::read_to_string(t.0.join("dst/d/a.txt")).unwrap(), "a");
        assert!(!t.0.join("src/d").exists());
    }

    /// A server that names an item of a folder "..", or puts a slash in a name.
    struct Hostile;

    impl Provider for Hostile {
        fn capabilities(&self, _: &Uri) -> Capabilities {
            Capabilities { write: false, rename: false, trash: false, watch: false, sizes: false, local_path: false }
        }
        fn list(&self, uri: &Uri, _: &AtomicBool) -> Result<Vec<Entry>, String> {
            let file = |name: &str| Entry { name: name.into(), uri: uri.join("x").to_string(), kind: "file", is_dir: false, size: 1, mtime: 0, ctime: 0, hidden: false, ext: String::new(), icon: String::new() };
            Ok(vec![file(".."), file("a/../../escaped"), file("fine.txt")])
        }
        fn stat(&self, uri: &Uri) -> Result<Entry, String> {
            Ok(Entry { name: uri.name(), uri: uri.to_string(), kind: if uri.path == "/d" { "dir" } else { "file" }, is_dir: uri.path == "/d", size: 1, mtime: 0, ctime: 0, hidden: false, ext: String::new(), icon: String::new() })
        }
        fn read(&self, _: &Uri) -> Result<Box<dyn Read + Send>, String> {
            Ok(Box::new(io::Cursor::new(b"x".to_vec())))
        }
        fn write(&self, _: &Uri) -> Result<Box<dyn Commit>, String> {
            Err("read only".into())
        }
        fn mkdir(&self, _: &Uri) -> Result<(), String> {
            Err("read only".into())
        }
        fn rename(&self, _: &Uri, _: &Uri) -> Result<(), String> {
            Err("read only".into())
        }
        fn delete(&self, _: &Uri, _: &AtomicBool) -> Result<(), String> {
            Err("read only".into())
        }
    }

    #[test]
    fn names_from_a_server_never_write_outside_the_target() {
        let t = Temp::new("copy-hostile");
        fs::create_dir(t.0.join("dst")).unwrap();
        registry().add("hostile", Arc::new(Hostile));
        let (ctx, _answers, _) = test_ctx();
        let done = transfer(&ctx, &[Uri::parse("hostile://srv/d").unwrap()], &Uri::file(&t.0.join("dst")), false).unwrap();
        assert_eq!(done.skipped, 2);
        assert_eq!(fs::read_dir(t.0.join("dst/d")).unwrap().count(), 1, "only fine.txt");
        assert!(!t.0.join("escaped").exists() && !t.0.join("x").exists());
    }

    #[test]
    fn cancelled_copy_removes_its_partial_file() {
        let t = Temp::new("copy-cancel");
        let big = t.0.join("big.bin");
        fs::write(&big, vec![7u8; 400 * 1024]).unwrap();
        fs::create_dir(t.0.join("dst")).unwrap();
        let (ctx, _answers, cancel) = test_ctx();
        let canceller = thread::spawn(move || {
            thread::sleep(Duration::from_millis(60));
            cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        });
        let err = transfer(&ctx, &[elsewhere(&big)], &Uri::file(&t.0.join("dst")), false).unwrap_err();
        canceller.join().unwrap();
        assert!(err.contains(&cancelled()), "{err}");
        assert_eq!(fs::read_dir(t.0.join("dst")).unwrap().count(), 0, "neither the file nor its partial is left");
    }
}
