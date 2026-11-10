//! The Enhanced Archiver (W6): archives browsed as folders (`archive:///path/a.zip!/inside`), extracted safely, and
//! made (zip, optionally AES-256; 7z, optionally with a password and an encrypted header; tar with gzip, xz or bzip2),
//! split into volumes when asked. libarchive reads and writes them all but 7z with a password, which sevenz-rust2 does.
//!
//! Extraction refuses what would leave the destination: absolute paths, `..`, and links that point outside; it never
//! restores set-user-id bits, and it writes into a folder of its own so nothing already there is replaced.

pub mod libarchive;

use crate::{
    browse,
    ipc::{Dispatcher, args},
    jobs::{Answer, Ctx, Question},
    tr,
    vfs::{self, Capabilities, Commit, Entry, Provider, Uri, copy, registry},
};
use libarchive::{Format, Header, Kind, Reader, Writer};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{Read, Write},
    os::unix::fs::PermissionsExt,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, atomic::AtomicBool},
    time::{Duration, SystemTime},
};

/// Extensions opened as archives.
pub const EXTENSIONS: &[&str] = &[
    "zip", "7z", "rar", "tar", "tgz", "gz", "tbz", "tbz2", "bz2", "txz", "xz", "lzma", "tlz", "iso", "cab", "cpio", "xar", "lha", "lzh", "jar", "war", "apk", "ipa", "cbz", "cbr", "z",
];

/// What starts an error that wants a password, for the page to ask for one.
pub const NEEDS_PASSWORD: &str = "LZ-PASSWORD:";

fn passwords() -> &'static Mutex<HashMap<PathBuf, String>> {
    static P: OnceLock<Mutex<HashMap<PathBuf, String>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(HashMap::new()))
}

fn password_of(archive: &Path) -> Option<String> {
    passwords().lock().ok()?.get(archive).cloned()
}

fn needs_password(archive: &Path) -> String {
    let name = archive.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    format!("{NEEDS_PASSWORD}{} \"{name}\"", tr("Cần mật khẩu để mở", "A password is needed to open"))
}

fn is_7z(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("7z"))
}

/// Whether a 7z needs sevenz-rust2: libarchive opens one with an encrypted header but fails at its first item.
fn via_sevenz(archive: &Path, password: Option<&str>) -> bool {
    is_7z(archive) && Reader::open(archive, password).and_then(|mut r| r.next().map(drop)).is_err()
}

/// A path inside an archive made safe: no leading slash, no `.` parts, and None when it has `..` or nothing left.
pub fn safe_path(raw: &str) -> Option<String> {
    let mut parts = Vec::new();
    for part in Path::new(raw.trim_start_matches('/')).components() {
        match part {
            Component::Normal(p) => parts.push(p.to_str()?.to_owned()),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// One item of an archive's table of contents.
#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    pub path: String,
    pub size: u64,
    pub mtime: i64,
    pub dir: bool,
}

/// The items of an archive, folders included even when the archive only names the files inside them.
#[derive(Debug, Default)]
pub struct Toc {
    pub items: BTreeMap<String, Item>,
}

impl Toc {
    fn add(&mut self, path: String, size: u64, mtime: i64, dir: bool) {
        let mut at = path.as_str();
        while let Some((parent, _)) = at.rsplit_once('/') {
            self.items.entry(parent.to_owned()).or_insert_with(|| Item { path: parent.to_owned(), size: 0, mtime, dir: true });
            at = parent;
        }
        self.items.insert(path.clone(), Item { path, size, mtime, dir });
    }

    /// The items directly inside `folder` ("" for the top).
    pub fn children(&self, folder: &str) -> Vec<&Item> {
        self.items
            .values()
            .filter(|i| match i.path.rsplit_once('/') {
                Some((parent, _)) => parent == folder,
                None => folder.is_empty(),
            })
            .collect()
    }
}

/// Reads the table of contents of an archive: libarchive, or sevenz-rust2 for a 7z libarchive cannot open.
pub fn read_toc(archive: &Path, password: Option<&str>) -> Result<Toc, String> {
    let mut toc = Toc::default();
    let via_libarchive = (|| {
        let mut reader = Reader::open(archive, password)?;
        while let Some(h) = reader.next()? {
            if let Some(path) = safe_path(&h.path) {
                if h.kind != Kind::Other {
                    toc.add(path, h.size, h.mtime, h.kind == Kind::Dir);
                }
            }
        }
        Ok::<(), String>(())
    })();
    match via_libarchive {
        Ok(()) => Ok(toc),
        Err(error) if is_7z(archive) => {
            let mut toc = Toc::default();
            let pw = password.map(sevenz_rust2::Password::new).unwrap_or_else(|| sevenz_rust2::Password::empty());
            let reader = sevenz_rust2::ArchiveReader::open(archive, pw).map_err(|e| seven_error(archive, &e.to_string(), password.is_none()).unwrap_or(error.clone()))?;
            for e in &reader.archive().files {
                if let Some(path) = safe_path(e.name()) {
                    let mtime = SystemTime::from(e.last_modified_date()).duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
                    toc.add(path, e.size(), mtime, e.is_directory());
                }
            }
            Ok(toc)
        }
        Err(error) if libarchive::wants_password(&error) && password.is_none() => Err(needs_password(archive)),
        Err(error) => Err(error),
    }
}

/// A 7z error in words, asking for a password when that is what it lacks.
fn seven_error(archive: &Path, error: &str, no_password: bool) -> Option<String> {
    let e = error.to_lowercase();
    if e.contains("password") || e.contains("encrypt") {
        return Some(if no_password { needs_password(archive) } else { tr("Sai mật khẩu", "Wrong password").to_owned() });
    }
    Some(error.to_owned())
}

/// The table of contents of an archive, kept while the archive does not change.
pub fn toc(archive: &Path) -> Result<Arc<Toc>, String> {
    type Cache = Mutex<HashMap<PathBuf, (SystemTime, u64, Arc<Toc>)>>;
    static CACHE: OnceLock<Cache> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let meta = fs::metadata(archive).map_err(|e| vfs::local::error(archive, &e))?;
    let stamp = (meta.modified().unwrap_or(SystemTime::UNIX_EPOCH), meta.len());
    if let Some((time, len, toc)) = cache.lock().ok().and_then(|c| c.get(archive).cloned()) {
        if (time, len) == stamp {
            return Ok(toc);
        }
    }
    let toc = Arc::new(read_toc(archive, password_of(archive).as_deref())?);
    if let Ok(mut c) = cache.lock() {
        if c.len() > 64 {
            c.clear();
        }
        c.insert(archive.to_path_buf(), (stamp.0, stamp.1, toc.clone()));
    }
    Ok(toc)
}

/// The archive file and the place inside it of `archive:///path/a.zip!/inside`. A name may itself hold `!`, so the
/// archive is the first prefix before a `!` that is a file.
pub fn split(uri: &Uri) -> Result<(PathBuf, String), String> {
    for (i, _) in uri.path.match_indices('!') {
        let (file, rest) = uri.path.split_at(i);
        let inside = &rest[1..];
        if (inside.is_empty() || inside.starts_with('/')) && Path::new(file).is_file() {
            return Ok((PathBuf::from(file), inside.trim_matches('/').to_owned()));
        }
    }
    Err(format!("{}: {uri}", tr("Không phải địa chỉ trong tệp nén", "Not an address inside an archive")))
}

/// The URI of `inside` in the archive at `archive`.
pub fn uri_of(archive: &Path, inside: &str) -> Uri {
    Uri { scheme: "archive".into(), authority: String::new(), path: format!("{}!/{inside}", archive.display()).trim_end_matches('/').to_owned() }
}

fn entry_of(archive: &Path, item: &Item) -> Entry {
    let name = item.path.rsplit('/').next().unwrap_or(&item.path).to_owned();
    let ext = if item.dir { String::new() } else { Path::new(&name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default() };
    let icon = if item.dir { "type:public.folder".into() } else if ext.is_empty() { "type:public.data".into() } else { format!("ext:{ext}") };
    Entry {
        uri: uri_of(archive, &item.path).to_string(),
        kind: if item.dir { "dir" } else { "file" },
        is_dir: item.dir,
        size: item.size,
        mtime: item.mtime,
        ctime: item.mtime,
        hidden: name.starts_with('.') || name == "__MACOSX",
        ext,
        icon,
        name,
    }
}

/// The provider of `archive://`: archives as read-only folders.
pub struct ArchiveProvider;

impl Provider for ArchiveProvider {
    fn capabilities(&self, _: &Uri) -> Capabilities {
        Capabilities { write: false, rename: false, trash: false, watch: false, sizes: false, local_path: false }
    }

    fn list(&self, uri: &Uri, _cancel: &AtomicBool) -> Result<Vec<Entry>, String> {
        let (archive, inside) = split(uri)?;
        let toc = toc(&archive)?;
        Ok(toc.children(&inside).into_iter().map(|i| entry_of(&archive, i)).collect())
    }

    fn stat(&self, uri: &Uri) -> Result<Entry, String> {
        let (archive, inside) = split(uri)?;
        if inside.is_empty() {
            let meta = fs::metadata(&archive).map_err(|e| vfs::local::error(&archive, &e))?;
            let name = archive.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let mtime = meta.modified().ok().and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs() as i64);
            return Ok(Entry { name, uri: uri.to_string(), kind: "dir", is_dir: true, size: 0, mtime, ctime: mtime, hidden: false, ext: String::new(), icon: format!("path:{}", archive.display()) });
        }
        let toc = toc(&archive)?;
        toc.items.get(&inside).map(|i| entry_of(&archive, i)).ok_or_else(|| format!("\"{inside}\": {}", tr("không có trong tệp nén", "is not in the archive")))
    }

    fn read(&self, uri: &Uri) -> Result<Box<dyn Read + Send>, String> {
        let (archive, inside) = split(uri)?;
        let password = password_of(&archive);
        match Reader::open(&archive, password.as_deref()).and_then(|r| if via_sevenz(&archive, password.as_deref()) { Err(String::new()) } else { Ok(r) }) {
            Ok(mut reader) => {
                while let Some(h) = reader.next()? {
                    if safe_path(&h.path).as_deref() == Some(inside.as_str()) {
                        return Ok(Box::new(Guarded { reader, archive: archive.clone() }));
                    }
                }
                Err(format!("\"{inside}\": {}", tr("không có trong tệp nén", "is not in the archive")))
            }
            Err(_) if is_7z(&archive) => {
                // shortcut: a 7z item opened from inside the archive is read whole into memory; stream it if users browse
                // huge encrypted 7z archives.
                let pw = password.as_deref().map(sevenz_rust2::Password::new).unwrap_or_else(sevenz_rust2::Password::empty);
                let mut reader = sevenz_rust2::ArchiveReader::open(&archive, pw).map_err(|e| seven_error(&archive, &e.to_string(), password.is_none()).unwrap_or_default())?;
                let name = reader.archive().files.iter().find(|f| safe_path(f.name()).as_deref() == Some(inside.as_str())).map(|f| f.name().to_owned());
                let name = name.ok_or_else(|| format!("\"{inside}\": {}", tr("không có trong tệp nén", "is not in the archive")))?;
                let bytes = reader.read_file(&name).map_err(|e| e.to_string())?;
                Ok(Box::new(std::io::Cursor::new(bytes)))
            }
            Err(e) => Err(e),
        }
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

/// The bytes of an item, turning libarchive's "passphrase required" into a question for the page.
struct Guarded {
    reader: Reader,
    archive: PathBuf,
}

impl Read for Guarded {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.reader.read(buf).map_err(|e| {
            let text = e.to_string();
            if libarchive::wants_password(&text) && password_of(&self.archive).is_none() { std::io::Error::other(needs_password(&self.archive)) } else { e }
        })
    }
}

fn read_only() -> String {
    tr("Không sửa được bên trong tệp nén; hãy giải nén trước", "An archive cannot be changed inside; extract it first").into()
}

/// Where an archive goes when extracted into `dest`: straight in when everything is in one folder at the top (under a
/// name of its own if that is taken), else in a new folder named after the archive.
pub fn plan_root(archive: &Path, toc: &Toc, dest: &Path) -> (PathBuf, Option<(String, String)>) {
    let tops: HashSet<&str> = toc.items.keys().map(|p| p.split('/').next().unwrap_or(p)).collect();
    let free = |name: &str| if dest.join(name).exists() { copy::unique_name(name, false, true, |n| dest.join(n).exists()) } else { name.to_owned() };
    if tops.len() == 1 {
        let top = tops.into_iter().next().unwrap_or_default().to_owned();
        if toc.items.get(&top).is_some_and(|i| i.dir) {
            let renamed = free(&top);
            return (dest.to_path_buf(), (renamed != top).then_some((top, renamed)));
        }
    }
    let name = archive.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "archive".into());
    let stem = EXTENSIONS.iter().find_map(|ext| name.strip_suffix(&format!(".tar.{ext}")).or_else(|| name.strip_suffix(&format!(".{ext}")))).unwrap_or(&name).to_owned();
    (dest.join(free(&stem)), None)
}

/// Writes one item under `root`, refusing what would leave it; links are returned to be made last.
fn put(root: &Path, rel: &str, kind: Kind, perm: u32, mtime: i64, data: &mut dyn Read, links: &mut Vec<(PathBuf, String)>, link: Option<String>, ctx: &Ctx, done: &mut u64, total: u64) -> Result<(), String> {
    let target = root.join(rel);
    if !target.starts_with(root) {
        return Ok(());
    }
    match kind {
        Kind::Dir => fs::create_dir_all(&target).map_err(|e| vfs::local::error(&target, &e))?,
        Kind::File => {
            let parent = target.parent().unwrap_or(root);
            fs::create_dir_all(parent).map_err(|e| vfs::local::error(parent, &e))?;
            // A folder made by an earlier item may be a link in disguise: the real place must still be inside.
            let real = parent.canonicalize().map_err(|e| vfs::local::error(parent, &e))?;
            if !real.starts_with(root.canonicalize().map_err(|e| vfs::local::error(root, &e))?) {
                return Ok(());
            }
            let mut file = fs::File::options().write(true).create_new(true).open(&target).map_err(|e| vfs::local::error(&target, &e))?;
            let mut buf = vec![0u8; 1 << 20];
            loop {
                if ctx.cancelled() {
                    return Err(tr("Đã hủy", "Cancelled").into());
                }
                let n = data.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                file.write_all(&buf[..n]).map_err(|e| vfs::local::error(&target, &e))?;
                *done += n as u64;
                ctx.progress(*done, total, rel);
            }
            let _ = fs::set_permissions(&target, fs::Permissions::from_mode((perm & 0o777) | 0o600));
            let _ = file.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(mtime.max(0) as u64));
        }
        Kind::Link => {
            if let Some(link) = link {
                links.push((target, link));
            }
        }
        Kind::Other => {}
    }
    Ok(())
}

/// Makes the links of an archive, only those whose target stays inside the destination.
fn make_links(root: &Path, links: Vec<(PathBuf, String)>) {
    for (place, target) in links {
        if target.starts_with('/') {
            continue;
        }
        let mut resolved = place.parent().unwrap_or(root).to_path_buf();
        let mut inside = true;
        for part in Path::new(&target).components() {
            match part {
                Component::ParentDir => inside &= resolved.pop() && resolved.starts_with(root),
                Component::Normal(p) => resolved.push(p),
                _ => {}
            }
        }
        if inside && resolved.starts_with(root) {
            let _ = std::os::unix::fs::symlink(&target, &place);
        }
    }
}

/// Extracts `archive` into the folder `dest` and returns where it went.
pub fn extract(ctx: &Ctx, archive: &Path, dest: &Path, password: Option<&str>) -> Result<PathBuf, String> {
    let toc = read_toc(archive, password)?;
    let total = toc.items.values().map(|i| i.size).sum::<u64>().max(1);
    let (root, rename_top) = plan_root(archive, &toc, dest);
    let made = if root == dest { rename_top.as_ref().map(|(_, to)| dest.join(to)).or_else(|| toc.items.keys().next().map(|k| dest.join(k.split('/').next().unwrap_or(k)))) } else { Some(root.clone()) };
    fs::create_dir_all(&root).map_err(|e| vfs::local::error(&root, &e))?;
    let rel_of = |path: &str| -> Option<String> {
        let safe = safe_path(path)?;
        Some(match &rename_top {
            Some((from, to)) if safe == *from || safe.starts_with(&format!("{from}/")) => format!("{to}{}", &safe[from.len()..]),
            _ => safe,
        })
    };
    let mut links = Vec::new();
    let mut done = 0u64;
    let result = (|| {
        match Reader::open(archive, password).and_then(|r| if via_sevenz(archive, password) { Err(String::new()) } else { Ok(r) }) {
            Ok(mut reader) => {
                while let Some(Header { path, kind, perm, mtime, link, .. }) = reader.next()? {
                    let Some(rel) = rel_of(&path) else { continue };
                    put(&root, &rel, kind, perm, mtime, &mut reader, &mut links, link, ctx, &mut done, total).map_err(|e| {
                        if libarchive::wants_password(&e) && password.is_none() { needs_password(archive) } else { e }
                    })?;
                }
                Ok(())
            }
            Err(_) if is_7z(archive) => {
                let pw = password.map(sevenz_rust2::Password::new).unwrap_or_else(sevenz_rust2::Password::empty);
                let mut reader = sevenz_rust2::ArchiveReader::open(archive, pw).map_err(|e| seven_error(archive, &e.to_string(), password.is_none()).unwrap_or_default())?;
                let mut failure = None;
                reader
                    .for_each_entries(|entry, data| {
                        let Some(rel) = rel_of(entry.name()) else { return Ok(true) };
                        let kind = if entry.is_directory() { Kind::Dir } else { Kind::File };
                        let mtime = SystemTime::from(entry.last_modified_date()).duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
                        if let Err(e) = put(&root, &rel, kind, 0o644, mtime, data, &mut links, None, ctx, &mut done, total) {
                            failure = Some(e);
                            return Ok(false);
                        }
                        Ok(true)
                    })
                    .map_err(|e| seven_error(archive, &e.to_string(), password.is_none()).unwrap_or_default())?;
                failure.map_or(Ok(()), Err)
            }
            Err(e) => Err(e),
        }
    })();
    if let Err(e) = result {
        if let Some(made) = &made {
            let _ = vfs::local::delete(made, &AtomicBool::new(false));
        }
        return Err(e);
    }
    make_links(&root, links);
    ctx.progress(total, total, "");
    Ok(made.unwrap_or(root))
}

/// Extracts, asking for the password when the archive wants one and none is known.
fn extract_asking(ctx: &Ctx, archive: &Path, dest: &Path) -> Result<PathBuf, String> {
    let mut password = password_of(archive);
    loop {
        match extract(ctx, archive, dest, password.as_deref()) {
            Err(e) if e.starts_with(NEEDS_PASSWORD) || (password.is_some() && libarchive::wants_password(&e)) => {
                let name = archive.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                match ctx.ask(Question::Password { what: name }) {
                    Answer::Text(pw) => {
                        if let Ok(mut p) = passwords().lock() {
                            p.insert(archive.to_path_buf(), pw.clone());
                        }
                        password = Some(pw);
                    }
                    _ => return Err(tr("Đã hủy", "Cancelled").into()),
                }
            }
            other => return other,
        }
    }
}

/// The files of `sources` with the names they get in an archive, relative to the folder that holds each source.
fn walk(sources: &[PathBuf]) -> Result<Vec<(PathBuf, String, fs::Metadata)>, String> {
    let mut out = Vec::new();
    for source in sources {
        let base = source.parent().unwrap_or(Path::new("/"));
        let mut stack = vec![source.clone()];
        while let Some(path) = stack.pop() {
            let meta = fs::symlink_metadata(&path).map_err(|e| vfs::local::error(&path, &e))?;
            let name = path.strip_prefix(base).map_err(|e| e.to_string())?.to_string_lossy().into_owned();
            if meta.is_dir() {
                let mut children: Vec<PathBuf> = fs::read_dir(&path).map_err(|e| vfs::local::error(&path, &e))?.flatten().map(|e| e.path()).collect();
                children.sort();
                stack.extend(children.into_iter().rev());
            }
            out.push((path, name, meta));
        }
    }
    Ok(out)
}

/// Makes an archive of `sources` at `target` and returns its path, or the paths of its volumes when split.
pub fn create(ctx: &Ctx, sources: &[PathBuf], target: &Path, format: Format, password: Option<&str>, level: Option<u8>, split_mb: u64) -> Result<Vec<PathBuf>, String> {
    let files = walk(sources)?;
    let total = files.iter().filter(|(_, _, m)| m.is_file()).map(|(_, _, m)| m.len()).sum::<u64>().max(1);
    let partial = vfs::local::partial_of(target);
    let mut done = 0u64;
    let written = (|| {
        if format == Format::SevenZip && password.is_some() {
            let pw = sevenz_rust2::Password::new(password.unwrap_or_default());
            let mut writer = sevenz_rust2::ArchiveWriter::create(&partial).map_err(|e| e.to_string())?;
            writer.set_content_methods(vec![sevenz_rust2::encoder_options::AesEncoderOptions::new(pw).into(), sevenz_rust2::EncoderMethod::LZMA2.into()]);
            writer.set_encrypt_header(true);
            for (path, name, meta) in &files {
                if ctx.cancelled() {
                    return Err(tr("Đã hủy", "Cancelled").into());
                }
                if meta.is_dir() {
                    writer.push_archive_entry::<fs::File>(sevenz_rust2::ArchiveEntry::new_directory(name), None).map_err(|e| e.to_string())?;
                } else if meta.is_file() {
                    let entry = sevenz_rust2::ArchiveEntry::from_path(path, name.clone());
                    writer.push_archive_entry(entry, Some(fs::File::open(path).map_err(|e| vfs::local::error(path, &e))?)).map_err(|e| e.to_string())?;
                    done += meta.len();
                    ctx.progress(done, total, name);
                }
            }
            writer.finish().map_err(|e| e.to_string())?;
            return Ok(());
        }
        let mut writer = Writer::create(&partial, format, password, level)?;
        for (path, name, meta) in &files {
            if meta.is_dir() {
                writer.add_dir(name, meta)?;
            } else if meta.file_type().is_symlink() {
                let target = fs::read_link(path).map_err(|e| vfs::local::error(path, &e))?;
                writer.add_link(name, &target.to_string_lossy(), meta)?;
            } else if meta.is_file() {
                writer.add_file(name, path, meta, ctx.cancel_flag(), |n| {
                    done += n;
                    ctx.progress(done, total, name);
                })?;
            }
        }
        writer.finish()
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&partial);
        return Err(e);
    }
    fs::rename(&partial, target).map_err(|e| vfs::local::error(target, &e))?;
    if split_mb > 0 { split_volumes(target, split_mb << 20) } else { Ok(vec![target.to_path_buf()]) }
}

/// Splits a file into volumes of `size` bytes named `name.001`, `name.002` (as 7-Zip names them) and removes the whole
/// file; a file smaller than one volume stays whole.
pub fn split_volumes(path: &Path, size: u64) -> Result<Vec<PathBuf>, String> {
    let len = fs::metadata(path).map_err(|e| vfs::local::error(path, &e))?.len();
    if size == 0 || len <= size {
        return Ok(vec![path.to_path_buf()]);
    }
    let mut source = fs::File::open(path).map_err(|e| vfs::local::error(path, &e))?;
    let mut parts = Vec::new();
    let mut buf = vec![0u8; 1 << 20];
    for n in 1.. {
        let part = PathBuf::from(format!("{}.{n:03}", path.display()));
        let mut out = fs::File::options().write(true).create_new(true).open(&part).map_err(|e| vfs::local::error(&part, &e))?;
        let mut left = size;
        while left > 0 {
            let want = buf.len().min(left as usize);
            let got = source.read(&mut buf[..want]).map_err(|e| e.to_string())?;
            if got == 0 {
                break;
            }
            out.write_all(&buf[..got]).map_err(|e| vfs::local::error(&part, &e))?;
            left -= got as u64;
        }
        parts.push(part);
        if left > 0 || parts.len() as u64 * size >= len {
            break;
        }
    }
    fs::remove_file(path).map_err(|e| vfs::local::error(path, &e))?;
    Ok(parts)
}

pub fn register(d: &mut Dispatcher) {
    registry().add("archive", Arc::new(ArchiveProvider));
    d.on("archive.password", |_, _, a| {
        #[derive(Deserialize)]
        struct Pw {
            uri: String,
            password: String,
        }
        let a: Pw = args(a)?;
        let uri = Uri::parse(&a.uri)?;
        let archive = if uri.scheme == "archive" { split(&uri)?.0 } else { uri.local_path().ok_or_else(|| tr("Chỉ với tệp trên máy", "Only for files on this Mac").to_owned())? };
        read_toc(&archive, Some(&a.password)).map_err(|e| if e.starts_with(NEEDS_PASSWORD) { tr("Sai mật khẩu", "Wrong password").to_owned() } else { e })?;
        if let Ok(mut p) = passwords().lock() {
            p.insert(archive, a.password);
        }
        Ok(Value::Null)
    });
    d.on("archive.extract", |app, window, a| {
        #[derive(Deserialize)]
        struct Extract {
            to: Option<String>,
        }
        let to = args::<Extract>(a.clone())?.to.map(|u| Uri::parse(&u)).transpose()?;
        let archives: Vec<PathBuf> = browse::targets(app, window, &a)?.iter().filter_map(Uri::local_path).collect();
        if archives.is_empty() {
            return Err(tr("Hãy chọn tệp nén trên máy", "Choose archives on this Mac").into());
        }
        let dest_of = move |archive: &Path| -> Result<PathBuf, String> {
            match &to {
                Some(uri) => uri.local_path().ok_or_else(|| tr("Chỉ giải nén vào thư mục trên máy", "Only folders on this Mac").to_owned()),
                None => Ok(archive.parent().unwrap_or(Path::new("/")).to_path_buf()),
            }
        };
        let title = match archives.as_slice() {
            [one] => format!("{} \"{}\"", tr("Giải nén", "Extract"), one.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()),
            many => format!("{} {} {}", tr("Giải nén", "Extract"), many.len(), tr("tệp", "archives")),
        };
        let job = app.jobs.spawn(
            &app.proxy,
            Some(window),
            "archive.extract",
            title,
            move |ctx| {
                let mut names = Vec::new();
                let mut folder = None;
                for archive in &archives {
                    let dest = dest_of(archive)?;
                    let made = extract_asking(ctx, archive, &dest)?;
                    names.push(made.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
                    folder = made.parent().map(|p| Uri::file(p).to_string());
                }
                Ok(json!({ "names": names, "to": folder }))
            },
            None,
        );
        Ok(json!({ "job": job }))
    });
    d.on("archive.create", |app, window, a| {
        #[derive(Deserialize)]
        struct Create {
            format: String,
            name: Option<String>,
            password: Option<String>,
            level: Option<u8>,
            #[serde(default, rename = "splitMb")]
            split_mb: u64,
        }
        let c: Create = args(a.clone())?;
        let format = Format::parse(&c.format).ok_or_else(|| tr("Định dạng không hỗ trợ", "That format is not supported").to_owned())?;
        let password = c.password.filter(|p| !p.is_empty());
        if password.is_some() && !matches!(format, Format::Zip | Format::SevenZip) {
            return Err(tr("Chỉ zip và 7z mới đặt được mật khẩu", "Only zip and 7z take a password").into());
        }
        let sources: Vec<PathBuf> = browse::targets(app, window, &a)?.iter().filter_map(Uri::local_path).collect();
        let folder = sources.first().and_then(|s| s.parent()).ok_or_else(|| tr("Chưa chọn mục nào", "Nothing is selected").to_owned())?.to_path_buf();
        let base = match (&c.name, sources.as_slice()) {
            (Some(name), _) if !name.trim().is_empty() => name.trim().to_owned(),
            (_, [one]) => one.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            _ => tr("Lưu trữ", "Archive").to_owned(),
        };
        vfs::valid_name(&base)?;
        let file = format!("{base}.{}", format.extension());
        let file = if folder.join(&file).exists() { copy::unique_name(&file, false, false, |n| folder.join(n).exists()) } else { file };
        let target = folder.join(&file);
        let job = app.jobs.spawn(
            &app.proxy,
            Some(window),
            "archive.create",
            format!("{} \"{file}\"", tr("Nén", "Compress")),
            move |ctx| {
                let made = create(ctx, &sources, &target, format, password.as_deref(), c.level, c.split_mb)?;
                let names: Vec<String> = made.iter().filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())).collect();
                Ok(json!({ "names": names, "to": Uri::file(&folder).to_string() }))
            },
            None,
        );
        Ok(json!({ "job": job }))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{jobs::test_ctx, vfs::local::tests::Temp};
    use std::process::Command;

    fn sources(t: &Temp) -> Vec<PathBuf> {
        t.file("src/photos/Tài liệu.txt", "chữ Việt");
        t.file("src/photos/sub/b.bin", &"x".repeat(5000));
        t.file("src/readme.md", "# hi");
        vec![t.0.join("src/photos"), t.0.join("src/readme.md")]
    }

    #[test]
    fn zip_roundtrip_with_password_and_unicode_names() {
        let t = Temp::new("archive-zip");
        let (ctx, answers, _) = test_ctx();
        let target = t.0.join("out.zip");
        create(&ctx, &sources(&t), &target, Format::Zip, Some("s3cret"), Some(6), 0).unwrap();
        let toc = read_toc(&target, None).unwrap();
        // libarchive gives names decomposed on a Mac (NFD); the disk finds a file under either form.
        let fold = |s: &str| crate::vfs::fold(s);
        assert!(toc.items.keys().any(|k| fold(k) == fold("photos/Tài liệu.txt")), "{:?}", toc.items.keys().collect::<Vec<_>>());
        assert!(toc.items.contains_key("photos/sub") && toc.items.contains_key("readme.md"));
        // Without the password the data cannot be read; the job asks for it.
        answers.send((Answer::Text("s3cret".into()), false)).unwrap();
        let dest = t.0.join("x");
        fs::create_dir(&dest).unwrap();
        let made = extract_asking(&ctx, &target, &dest).unwrap();
        assert_eq!(made, dest.join("out"), "two items at the top go in a folder named after the archive");
        assert_eq!(fs::read_to_string(made.join("photos/Tài liệu.txt")).unwrap(), "chữ Việt");
        assert_eq!(fs::read(made.join("photos/sub/b.bin")).unwrap().len(), 5000);
        passwords().lock().unwrap().remove(&target);
    }

    #[test]
    fn sevenz_roundtrip_with_password_and_encrypted_header() {
        let t = Temp::new("archive-7z");
        let (ctx, _, _) = test_ctx();
        let target = t.0.join("out.7z");
        create(&ctx, &sources(&t), &target, Format::SevenZip, Some("pa55"), None, 0).unwrap();
        assert!(read_toc(&target, None).unwrap_err().starts_with(NEEDS_PASSWORD), "the names themselves are hidden");
        let toc = read_toc(&target, Some("pa55")).unwrap();
        assert!(toc.items.contains_key("photos/sub/b.bin"));
        let dest = t.0.join("x");
        fs::create_dir(&dest).unwrap();
        let made = extract(&ctx, &target, &dest, Some("pa55")).unwrap();
        assert_eq!(fs::read_to_string(made.join("readme.md")).unwrap(), "# hi");
    }

    #[test]
    fn tar_gz_lists_and_one_item_reads_through_the_provider() {
        let t = Temp::new("archive-tgz");
        let (ctx, _, _) = test_ctx();
        let target = t.0.join("bundle.tar.gz");
        create(&ctx, &[t.0.join("src")].iter().map(|p| { sources(&t); p.clone() }).collect::<Vec<_>>(), &target, Format::TarGz, None, Some(9), 0).unwrap();
        let root = uri_of(&target, "");
        let top = ArchiveProvider.list(&root, &AtomicBool::new(false)).unwrap();
        assert_eq!(top.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["src"]);
        let readme = uri_of(&target, "src/readme.md");
        let mut text = String::new();
        ArchiveProvider.read(&readme).unwrap().read_to_string(&mut text).unwrap();
        assert_eq!(text, "# hi");
        assert_eq!(ArchiveProvider.stat(&uri_of(&target, "src/photos")).unwrap().kind, "dir");
        assert!(ArchiveProvider.mkdir(&root).is_err(), "an archive is read only");
        // One folder at the top goes straight into the destination.
        let dest = t.0.join("x");
        fs::create_dir(&dest).unwrap();
        assert_eq!(extract(&ctx, &target, &dest, None).unwrap(), dest.join("src"));
        // A second time, the folder takes a name of its own.
        assert_eq!(extract(&ctx, &target, &dest, None).unwrap(), dest.join("src 2"));
    }

    #[test]
    fn extract_refuses_zip_slip_and_absolute_paths() {
        assert_eq!(safe_path("../evil"), None);
        assert_eq!(safe_path("a/../../evil"), None);
        assert_eq!(safe_path("/etc/passwd").as_deref(), Some("etc/passwd"));
        assert_eq!(safe_path("./a/./b").as_deref(), Some("a/b"));
        assert_eq!(safe_path(""), None);
        // A tar whose names climb out, made with the system's bsdtar from a crafted list.
        let t = Temp::new("archive-slip");
        t.file("work/inner/ok.txt", "ok");
        t.file("work/escape.txt", "evil");
        let tar = t.0.join("slip.tar");
        let status = Command::new("/usr/bin/bsdtar")
            .args(["-cf"])
            .arg(&tar)
            .args(["-C"])
            .arg(t.0.join("work/inner"))
            .args(["-s", "|^escape.txt|../../escape.txt|", "ok.txt", "../escape.txt"])
            .status()
            .unwrap();
        assert!(status.success());
        let dest = t.0.join("dest");
        fs::create_dir(&dest).unwrap();
        let (ctx, _, _) = test_ctx();
        let made = extract(&ctx, &tar, &dest, None).unwrap();
        assert!(made.join("ok.txt").exists());
        assert!(!t.0.join("escape.txt").exists() && !t.0.join("dest/../escape.txt").exists(), "nothing leaves the destination");
        // A link pointing out is not made.
        let links = vec![(dest.join("slip/out"), "../../../etc".to_owned()), (dest.join("slip/in"), "ok.txt".to_owned())];
        fs::create_dir_all(dest.join("slip")).unwrap();
        make_links(&dest, links);
        assert!(fs::symlink_metadata(dest.join("slip/out")).is_err());
        assert!(fs::symlink_metadata(dest.join("slip/in")).is_ok());
    }

    #[test]
    fn split_7z_volumes_rejoin_byte_exact() {
        let t = Temp::new("archive-split");
        let big: Vec<u8> = (0..2_600_000u32).map(|i| (i * 7 % 251) as u8).collect();
        let file = t.0.join("data.bin");
        fs::write(&file, &big).unwrap();
        let parts = split_volumes(&file, 1 << 20).unwrap();
        assert_eq!(parts.iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect::<Vec<_>>(), ["data.bin.001", "data.bin.002", "data.bin.003"]);
        assert!(!file.exists());
        let joined: Vec<u8> = parts.iter().flat_map(|p| fs::read(p).unwrap()).collect();
        assert_eq!(joined, big);
    }

    #[test]
    fn uri_with_bang_splits_archive_and_inner_path() {
        let t = Temp::new("archive-uri");
        let odd = t.file("odd!name.zip", "");
        let uri = uri_of(&odd, "dir/a.txt");
        assert_eq!(split(&uri).unwrap(), (odd.clone(), "dir/a.txt".into()));
        assert_eq!(split(&Uri::parse(&uri.to_string()).unwrap()).unwrap().1, "dir/a.txt");
        assert_eq!(split(&uri_of(&odd, "")).unwrap().1, "");
        assert!(split(&Uri::parse("archive:///nowhere.zip!/x").unwrap()).is_err());
    }
}
