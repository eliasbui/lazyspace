//! The methods of the core browser (design.md section 5.3): listing a folder into a tab and handing its rows out,
//! file operations as jobs with an undo, the clipboard, folder sizes, and what the system does with files. The state
//! they share beyond the App's views and jobs lives in `State`.

use crate::{
    App, Proxy, UserEvent, clipboard,
    fswatch::FsWatch,
    ipc::{Dispatcher, args, defer, event},
    jobs::{Answer, Then},
    native::{icons, trash, workspace},
    protocol,
    settings::Sort,
    sizes, tr,
    vfs::{self, Uri, copy, registry},
    views::Selection,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};
use tao::window::WindowId;

/// The most steps the undo list keeps.
const UNDO_MAX: usize = 50;

pub struct State {
    pub watch: FsWatch,
    pub cut: clipboard::Cut,
    pub undo: Vec<Undo>,
    /// The folder sizes being worked out, by tab, to stop when the tab moves on.
    sizes: HashMap<String, Arc<AtomicBool>>,
}

impl State {
    pub fn new(proxy: Proxy) -> State {
        State { watch: FsWatch::new(proxy, changed), cut: clipboard::Cut::default(), undo: Vec::new(), sizes: HashMap::new() }
    }

    #[cfg(test)]
    pub fn none() -> State {
        State { watch: FsWatch::none(), cut: clipboard::Cut::default(), undo: Vec::new(), sizes: HashMap::new() }
    }

    pub fn push_undo(&mut self, undo: Undo) {
        self.undo.push(undo);
        if self.undo.len() > UNDO_MAX {
            self.undo.remove(0);
        }
    }
}

/// A step that can be taken back.
#[derive(Debug, Clone, PartialEq)]
pub enum Undo {
    /// Items that were moved (renamed, moved, or put in the Trash): each goes back from where it is to where it was.
    Moves { title: String, moves: Vec<(PathBuf, PathBuf)> },
    /// Items that were made (copies, a new folder): they go to the Trash.
    Made { title: String, made: Vec<PathBuf> },
    /// Items renamed together (a batch rename): they go back in two phases, as they came.
    Renames { title: String, pairs: Vec<(PathBuf, PathBuf)> },
}

impl Undo {
    pub fn title(&self) -> &str {
        match self {
            Undo::Moves { title, .. } | Undo::Made { title, .. } | Undo::Renames { title, .. } => title,
        }
    }
}

/// Which items a method acts on: URIs, or a selection of a tab.
#[derive(Deserialize)]
struct Targets {
    #[serde(default)]
    uris: Vec<String>,
    view: Option<String>,
    selection: Option<Selection>,
}

pub(crate) fn targets(app: &App, window: WindowId, value: &Value) -> Result<Vec<Uri>, String> {
    let t: Targets = args(value.clone())?;
    let mut uris: Vec<Uri> = t.uris.iter().map(|u| Uri::parse(u)).collect::<Result<_, _>>()?;
    if let (Some(view), Some(selection)) = (&t.view, &t.selection) {
        uris.extend(app.views.resolve(view, window, selection)?);
    }
    if uris.is_empty() {
        return Err(tr("Chưa chọn mục nào", "Nothing is selected").into());
    }
    Ok(uris)
}

/// Runs `work` at once for a place on this Mac, else from a thread of its own: a server may be slow to answer, and the
/// windows must not wait for it.
fn off_main(app: &mut App, uri: &Uri, work: impl FnOnce() -> Result<Value, String> + Send + 'static) -> Result<Value, String> {
    if uri.local_path().is_some() { work() } else { defer(app, work) }
}

fn local_paths(uris: &[Uri]) -> Result<Vec<PathBuf>, String> {
    uris.iter().map(|u| u.local_path().ok_or_else(|| tr("Việc này chỉ làm được với tệp trên máy", "This can only be done with files on this Mac").to_owned())).collect()
}

/// Starts listing `uri` into the tab `view` of `window` on a thread; the page hears `view.changed` when it is in.
fn list(app: &mut App, window: WindowId, view: &str, uri: Uri, sort: Sort, show_hidden: bool) -> Result<u64, String> {
    let provider = registry().get(&uri)?;
    let request = app.views.begin(window, view, uri.clone(), sort, show_hidden, provider.capabilities(&uri));
    if let Some(cancel) = app.browse.sizes.remove(view) {
        cancel.store(true, Ordering::Relaxed);
    }
    let proxy = app.proxy.clone();
    let view = view.to_owned();
    thread::spawn(move || {
        let result = provider.list(&uri, &AtomicBool::new(false));
        proxy.send(UserEvent::Main(Box::new(move |app: &mut App| listed(app, window, &view, request, result))));
    });
    Ok(request)
}

/// A listing came back: shown when it is the tab's latest, then the watcher, the served folders and the sizes follow
/// the folders now open.
fn listed(app: &mut App, window: WindowId, view: &str, request: u64, result: Result<Vec<vfs::Entry>, String>) {
    match result {
        Ok(entries) => {
            let Some(generation) = app.views.finish(view, request, entries, &icons::describe) else { return };
            let Ok(v) = app.views.get(view, window) else { return };
            let free = v.uri.local_path().and_then(|p| workspace::free_space(&p));
            let changed = json!({ "view": view, "generation": generation, "count": v.count(), "uri": v.uri.to_string(), "capabilities": v.capabilities, "free": free, "groups": v.groups() });
            let sizes_wanted = app.settings.folder_sizes && v.capabilities.sizes;
            app.post(window, event("view.changed", changed));
            follow_open_folders(app);
            if sizes_wanted {
                start_sizes(app, window, view);
            }
        }
        Err(error) => {
            if app.views.get(view, window).is_ok_and(|v| v.request == request) {
                app.post(window, event("view.error", json!({ "view": view, "error": error })));
            }
        }
    }
}

/// Lists a tab again where it is, as it is sorted.
fn relist(app: &mut App, view: &str) {
    let Some((window, uri, sort, hidden)) = app.views.by_id().find(|(id, _)| *id == view).map(|(_, v)| (v.window, v.uri.clone(), v.sort.clone(), v.show_hidden)) else { return };
    let _ = list(app, window, view, uri, sort, hidden);
}

fn follow_open_folders(app: &mut App) {
    let folders: Vec<PathBuf> = app.views.open_folders().iter().filter_map(Uri::local_path).collect();
    protocol::allow(folders.iter().cloned());
    app.browse.watch.set(folders);
}

fn start_sizes(app: &mut App, window: WindowId, view: &str) {
    let Some(entries) = app.views.entries(view) else { return };
    let folders: Vec<(String, PathBuf)> = entries
        .iter()
        .filter(|e| e.is_dir || e.kind == "app" || e.kind == "package")
        .filter_map(|e| Some((e.name.clone(), Uri::parse(&e.uri).ok()?.local_path()?)))
        .collect();
    let cancel = sizes::start(&app.proxy, window, view.to_owned(), folders);
    if let Some(old) = app.browse.sizes.insert(view.to_owned(), cancel) {
        old.store(true, Ordering::Relaxed);
    }
}

/// The folders that changed on disk: the sizes of what holds them are forgotten and the tabs that show them are
/// listed again.
pub fn changed(app: &mut App, folders: HashSet<PathBuf>) {
    let mut views = Vec::new();
    for folder in &folders {
        sizes::forget(folder);
        views.extend(app.views.showing(&Uri::file(folder)));
    }
    views.sort();
    views.dedup();
    for view in views {
        relist(app, &view);
    }
}

/// Paths the address bar can complete `text` to: the folders in the folder it names whose names start with what is
/// typed after the last slash. `~` stands for the home folder.
pub fn complete(text: &str) -> Vec<String> {
    let home = dirs::home_dir().map(|h| h.to_string_lossy().into_owned()).unwrap_or_default();
    let typed = if text == "~" { format!("{home}/") } else if let Some(rest) = text.strip_prefix("~/") { format!("{home}/{rest}") } else { text.to_owned() };
    if !typed.starts_with('/') {
        return Vec::new();
    }
    let (dir, prefix) = typed.rsplit_once('/').map(|(d, p)| (if d.is_empty() { "/" } else { d }, p)).unwrap_or(("/", ""));
    let prefix_lower = prefix.to_lowercase();
    let Ok(items) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<String> = items
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.to_lowercase().starts_with(&prefix_lower) && (prefix.starts_with('.') || !n.starts_with('.')))
        .map(|n| format!("{}/{n}/", dir.trim_end_matches('/')))
        .collect();
    out.sort_by_key(|p| p.to_lowercase());
    out.truncate(20);
    out
}

/// The most folders a crumb's menu lists.
const SUBFOLDERS_MAX: usize = 300;

/// The folders directly in `uri` that are not hidden, by name as Finder sorts them, as `{ name, uri }`.
fn subfolders(uri: &Uri) -> Result<Vec<Value>, String> {
    let mut folders: Vec<vfs::Entry> = registry().get(uri)?.list(uri, &AtomicBool::new(false))?.into_iter().filter(|e| e.is_dir && !e.hidden).collect();
    folders.sort_by_cached_key(vfs::Entry::key);
    folders.truncate(SUBFOLDERS_MAX);
    Ok(folders.into_iter().map(|e| json!({ "name": e.name, "uri": e.uri })).collect())
}

/// The name a new folder gets: "untitled folder", "untitled folder 2" as Finder names them.
fn new_folder_name(folder: &Uri) -> Result<String, String> {
    let provider = registry().get(folder)?;
    let base = tr("thư mục không tên", "untitled folder");
    if provider.stat(&folder.join(base)).is_err() {
        return Ok(base.into());
    }
    Ok(copy::unique_name(base, false, true, |n| provider.stat(&folder.join(n)).is_ok()))
}

fn title(verb: (&str, &str), uris: &[Uri]) -> String {
    match uris {
        [one] => format!("{} \"{}\"", tr(verb.0, verb.1), one.name()),
        many => format!("{} {} {}", tr(verb.0, verb.1), many.len(), tr("mục", "items")),
    }
}

/// Waits for the copies and moves before this one to finish, showing it waits; the turn lasts as long as the guard.
fn turn(ctx: &crate::jobs::Ctx) -> Result<std::sync::MutexGuard<'static, ()>, String> {
    static QUEUE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    loop {
        match QUEUE.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(std::sync::TryLockError::Poisoned(p)) => return Ok(p.into_inner()),
            Err(std::sync::TryLockError::WouldBlock) => {}
        }
        if ctx.cancelled() {
            return Err("cancelled".into());
        }
        ctx.progress(0, 0, tr("Đang chờ lượt...", "Waiting for its turn..."));
        thread::sleep(std::time::Duration::from_millis(200));
    }
}

/// Reads every file copied again on both sides and compares their SHA-256; the first that differs is an error.
pub fn verify_copies(ctx: &crate::jobs::Ctx, pairs: &[(Uri, Uri)]) -> Result<(), String> {
    let mut files: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (from, to) in pairs {
        let (Some(from), Some(to)) = (from.local_path(), to.local_path()) else { continue };
        let mut stack = vec![(from, to)];
        while let Some((a, b)) = stack.pop() {
            if a.is_dir() {
                for item in std::fs::read_dir(&a).map_err(|e| e.to_string())?.flatten() {
                    stack.push((item.path(), b.join(item.file_name())));
                }
            } else if a.is_file() {
                files.push((a, b));
            }
        }
    }
    for (i, (a, b)) in files.iter().enumerate() {
        if ctx.cancelled() {
            return Err("cancelled".into());
        }
        ctx.progress(i as u64, files.len() as u64, &format!("{} {}", tr("Kiểm tra", "Checking"), b.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()));
        let same = crate::features::disk::digest(a, None).is_some_and(|d| crate::features::disk::digest(b, None) == Some(d));
        if !same {
            return Err(format!("{}: {}", tr("Bản sao khác bản gốc", "The copy differs from the original"), b.display()));
        }
    }
    Ok(())
}

/// Starts copying or moving `from` into `to` as a job of `window`, keeping an undo when it is over.
fn start_transfer(app: &mut App, window: WindowId, from: Vec<Uri>, to: Uri, mv: bool) -> u64 {
    let (queue, verify) = (app.settings.copy_queue, app.settings.verify_copies);
    let verb = if mv { ("Chuyển", "Move") } else { ("Chép", "Copy") };
    let job_title = title(verb, &from);
    let undo_title = job_title.clone();
    let then: Then = Box::new(move |app: &mut App, result: &Result<Value, String>| {
        let Ok(done) = result else { return };
        let pairs: Vec<(PathBuf, PathBuf)> = done["pairs"].as_array().into_iter().flatten().filter_map(|p| Some((PathBuf::from(p[0].as_str()?), PathBuf::from(p[1].as_str()?)))).collect();
        if pairs.is_empty() {
            return;
        }
        app.browse.push_undo(if mv {
            Undo::Moves { title: undo_title, moves: pairs.into_iter().map(|(src, dst)| (dst, src)).collect() }
        } else {
            Undo::Made { title: undo_title, made: pairs.into_iter().map(|(_, dst)| dst).collect() }
        });
    });
    let kind = if mv { "move" } else { "copy" };
    app.jobs.spawn(
        &app.proxy,
        Some(window),
        kind,
        job_title,
        move |ctx| {
            // One at a time when Settings asks: a later one waits its turn, and can still be stopped meanwhile.
            let _turn = if queue { Some(turn(ctx)?) } else { None };
            let done = copy::transfer(ctx, &from, &to, mv)?;
            if verify && !mv {
                verify_copies(ctx, &done.pairs)?;
            }
            // Local pairs as paths, for the undo; the names of what arrived, for the page to select them.
            let pairs: Vec<Value> = done.pairs.iter().filter_map(|(s, d)| Some(json!([s.local_path()?, d.local_path()?]))).collect();
            let names: Vec<String> = done.pairs.iter().map(|(_, d)| d.name()).collect();
            Ok(json!({ "pairs": pairs, "names": names, "to": to.to_string(), "skipped": done.skipped }))
        },
        Some(then),
    )
}

pub fn register(d: &mut Dispatcher) {
    d.on("fs.list", |app, window, a| {
        #[derive(Deserialize)]
        struct List {
            view: String,
            uri: String,
            sort: Option<Sort>,
            #[serde(rename = "showHidden")]
            show_hidden: Option<bool>,
        }
        let a: List = args(a)?;
        let uri = Uri::parse(&a.uri)?;
        let sort = a.sort.unwrap_or_else(|| app.settings.sort.clone());
        let hidden = a.show_hidden.unwrap_or(app.settings.show_hidden);
        let request = list(app, window, &a.view, uri, sort, hidden)?;
        Ok(json!({ "request": request }))
    });
    d.on("view.rows", |app, window, a| {
        #[derive(Deserialize)]
        struct Rows {
            view: String,
            start: usize,
            count: usize,
            generation: u64,
        }
        let a: Rows = args(a)?;
        app.views.rows(&a.view, window, a.start, a.count, a.generation, &icons::describe)
    });
    d.on("view.sort", |app, window, a| {
        #[derive(Deserialize)]
        struct SortView {
            view: String,
            sort: Sort,
        }
        let a: SortView = args(a)?;
        let generation = app.views.sort(&a.view, window, a.sort, &icons::describe)?;
        Ok(json!({ "generation": generation, "groups": app.views.get(&a.view, window)?.groups() }))
    });
    d.on("view.filter", |app, window, a| {
        #[derive(Deserialize)]
        struct Filter {
            view: String,
            text: String,
        }
        let a: Filter = args(a)?;
        let (generation, count) = app.views.filter(&a.view, window, &a.text)?;
        Ok(json!({ "generation": generation, "count": count, "groups": app.views.get(&a.view, window)?.groups() }))
    });
    d.on("view.hidden", |app, window, a| {
        #[derive(Deserialize)]
        struct Hidden {
            view: String,
            show: bool,
        }
        let a: Hidden = args(a)?;
        let (generation, count) = app.views.set_hidden(&a.view, window, a.show)?;
        Ok(json!({ "generation": generation, "count": count, "groups": app.views.get(&a.view, window)?.groups() }))
    });
    d.on("view.find", |app, window, a| {
        #[derive(Deserialize)]
        struct Find {
            view: String,
            prefix: String,
        }
        let a: Find = args(a)?;
        Ok(json!({ "index": app.views.find(&a.view, window, &a.prefix)? }))
    });
    d.on("view.index_of", |app, window, a| {
        #[derive(Deserialize)]
        struct IndexOf {
            view: String,
            name: String,
        }
        let a: IndexOf = args(a)?;
        Ok(json!({ "index": app.views.index_of(&a.view, window, &a.name)? }))
    });
    d.on("view.close", |app, window, a| {
        #[derive(Deserialize)]
        struct Close {
            view: String,
        }
        let a: Close = args(a)?;
        if let Some(cancel) = app.browse.sizes.remove(&a.view) {
            cancel.store(true, Ordering::Relaxed);
        }
        app.views.close(&a.view, window);
        follow_open_folders(app);
        Ok(Value::Null)
    });
    d.on("fs.sizes", |app, window, a| {
        #[derive(Deserialize)]
        struct Sizes {
            view: String,
            on: bool,
        }
        let a: Sizes = args(a)?;
        if let Some(cancel) = app.browse.sizes.remove(&a.view) {
            cancel.store(true, Ordering::Relaxed);
        }
        if a.on && app.views.get(&a.view, window)?.capabilities.sizes {
            start_sizes(app, window, &a.view);
        }
        Ok(Value::Null)
    });
    d.on("fs.complete", |_, _, a| {
        #[derive(Deserialize)]
        struct Complete {
            text: String,
        }
        Ok(json!({ "items": complete(&args::<Complete>(a)?.text) }))
    });
    // The folders in a place, by name, for the menu of a crumb of the path bar.
    d.on("fs.subfolders", |app, _, a| {
        #[derive(Deserialize)]
        struct Subfolders {
            uri: String,
        }
        let uri = Uri::parse(&args::<Subfolders>(a)?.uri)?;
        off_main(app, &uri.clone(), move || Ok(json!({ "items": subfolders(&uri)? })))
    });
    d.on("fs.stat", |app, _, a| {
        #[derive(Deserialize)]
        struct Stat {
            uri: String,
        }
        let uri = Uri::parse(&args::<Stat>(a)?.uri)?;
        off_main(app, &uri.clone(), move || serde_json::to_value(registry().get(&uri)?.stat(&uri)?).map_err(|e| e.to_string()))
    });
    d.on("fs.mkdir", |app, _, a| {
        #[derive(Deserialize)]
        struct Mkdir {
            uri: String,
            name: Option<String>,
        }
        let a: Mkdir = args(a)?;
        let folder = Uri::parse(&a.uri)?;
        let make = move || {
            let name = match a.name {
                Some(name) => name,
                None => new_folder_name(&folder)?,
            };
            vfs::valid_name(&name)?;
            let target = folder.join(&name);
            let provider = registry().get(&target)?;
            provider.mkdir(&target)?;
            Ok::<_, String>((name, target.clone(), provider.stat(&target)?))
        };
        if Uri::parse(&a.uri)?.local_path().is_none() {
            return defer(app, move || serde_json::to_value(make()?.2).map_err(|e| e.to_string()));
        }
        let (name, target, entry) = make()?;
        if let Some(path) = target.local_path() {
            app.browse.push_undo(Undo::Made { title: format!("{} \"{name}\"", tr("Tạo thư mục", "New Folder")), made: vec![path] });
        }
        serde_json::to_value(entry).map_err(|e| e.to_string())
    });
    d.on("fs.create_file", |app, _, a| {
        #[derive(Deserialize)]
        struct Create {
            uri: String,
            name: String,
            #[serde(default)]
            text: String,
        }
        let a: Create = args(a)?;
        vfs::valid_name(&a.name)?;
        let target = Uri::parse(&a.uri)?.join(&a.name);
        let (name, at) = (a.name.clone(), target.clone());
        let make = move || {
            let provider = registry().get(&target)?;
            if provider.stat(&target).is_ok() {
                return Err(format!("\"{}\": {}", a.name, tr("đã có một mục cùng tên", "an item with that name is already there")));
            }
            let mut writer = provider.write(&target)?;
            std::io::Write::write_all(&mut writer, a.text.as_bytes()).map_err(|e| e.to_string())?;
            writer.commit()?;
            serde_json::to_value(provider.stat(&target)?).map_err(|e| e.to_string())
        };
        let Some(path) = at.local_path() else { return defer(app, make) };
        let entry = make()?;
        app.browse.push_undo(Undo::Made { title: format!("{} \"{name}\"", tr("Tạo tệp", "New File")), made: vec![path] });
        Ok(entry)
    });
    d.on("fs.rename", |app, _, a| {
        #[derive(Deserialize)]
        struct Rename {
            uri: String,
            name: String,
        }
        let a: Rename = args(a)?;
        vfs::valid_name(&a.name)?;
        let from = Uri::parse(&a.uri)?;
        let to = from.parent().ok_or_else(|| tr("Không đổi tên được ổ đĩa", "A disk cannot be renamed here").to_owned())?.join(&a.name);
        let (source, target) = (from.clone(), to.clone());
        let rename = move || {
            let provider = registry().get(&from)?;
            if from != to {
                provider.rename(&from, &to)?;
            }
            serde_json::to_value(provider.stat(&to)?).map_err(|e| e.to_string())
        };
        let (Some(old), Some(new)) = (source.local_path(), target.local_path()) else { return defer(app, rename) };
        let entry = rename()?;
        if old != new {
            app.browse.push_undo(Undo::Moves { title: format!("{} \"{}\"", tr("Đổi tên", "Rename"), source.name()), moves: vec![(new, old)] });
        }
        Ok(entry)
    });
    d.on("fs.copy", |app, window, a| {
        #[derive(Deserialize)]
        struct CopyArgs {
            from: Vec<String>,
            to: String,
            #[serde(default, rename = "move")]
            mv: bool,
            /// "copy", "move", or "auto": a move on the same disk and a copy to another, as a drop in Finder.
            mode: Option<String>,
        }
        let a: CopyArgs = args(a)?;
        let from: Vec<Uri> = a.from.iter().map(|u| Uri::parse(u)).collect::<Result<_, _>>()?;
        if from.is_empty() {
            return Err(tr("Chưa chọn mục nào", "Nothing is selected").into());
        }
        let to = Uri::parse(&a.to)?;
        let mv = match a.mode.as_deref() {
            Some("move") => true,
            Some("copy") => false,
            Some("auto") => from.iter().all(|f| same_disk(f, &to)),
            _ => a.mv,
        };
        let job = start_transfer(app, window, from, to, mv);
        Ok(json!({ "job": job }))
    });
    d.on("fs.trash", |app, window, a| {
        let uris = targets(app, window, &a)?;
        let paths = local_paths(&uris)?;
        let job_title = title(("Chuyển vào Thùng rác", "Move to Trash"), &uris);
        let undo_title = job_title.clone();
        let then: Then = Box::new(move |app: &mut App, result: &Result<Value, String>| {
            let moves: Vec<(PathBuf, PathBuf)> = result.as_ref().ok().and_then(|d| d["moves"].as_array().cloned()).into_iter().flatten().filter_map(|m| Some((PathBuf::from(m[0].as_str()?), PathBuf::from(m[1].as_str()?)))).collect();
            if !moves.is_empty() {
                app.browse.push_undo(Undo::Moves { title: undo_title, moves });
            }
        });
        let job = app.jobs.spawn(
            &app.proxy,
            Some(window),
            "trash",
            job_title,
            move |ctx| {
                let mut moves = Vec::new();
                for (i, path) in paths.iter().enumerate() {
                    if ctx.cancelled() {
                        break;
                    }
                    let went = trash::trash(path)?;
                    moves.push(json!([went, path]));
                    ctx.progress(i as u64 + 1, paths.len() as u64, &path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
                }
                Ok(json!({ "moves": moves }))
            },
            Some(then),
        );
        Ok(json!({ "job": job }))
    });
    d.on("fs.delete", |app, window, a| {
        let uris = targets(app, window, &a)?;
        if uris.iter().filter_map(Uri::local_path).any(|p| trash::protected(&p)) {
            return Err(tr("Không thể xóa mục này", "This item cannot be deleted").into());
        }
        let job_title = title(("Xóa hẳn", "Delete"), &uris);
        let job = app.jobs.spawn(
            &app.proxy,
            Some(window),
            "delete",
            job_title,
            move |ctx| {
                for (i, uri) in uris.iter().enumerate() {
                    registry().get(uri)?.delete(uri, ctx.cancel_flag())?;
                    ctx.progress(i as u64 + 1, uris.len() as u64, &uri.name());
                }
                Ok(Value::Null)
            },
            None,
        );
        Ok(json!({ "job": job }))
    });
    d.on("fs.undo", |app, window, _| {
        let Some(undo) = app.browse.undo.pop() else {
            return Err(tr("Không có gì để hoàn tác", "There is nothing to undo").into());
        };
        let job_title = format!("{} {}", tr("Hoàn tác", "Undo"), undo.title());
        let job = app.jobs.spawn(&app.proxy, Some(window), "undo", job_title, move |ctx| run_undo(&undo, ctx), None);
        Ok(json!({ "job": job }))
    });
    d.on("fs.undo_title", |app, _, _| Ok(json!(app.browse.undo.last().map(|u| u.title().to_owned()))));
    d.on("fs.read_text", |app, _, a| {
        #[derive(Deserialize)]
        struct Read {
            uri: String,
            #[serde(default = "one_mib")]
            max: u64,
        }
        let a: Read = args(a)?;
        let uri = Uri::parse(&a.uri)?;
        off_main(app, &uri.clone(), move || {
            let provider = registry().get(&uri)?;
            let entry = provider.stat(&uri)?;
            let mut bytes = Vec::new();
            std::io::Read::read_to_end(&mut std::io::Read::take(provider.read(&uri)?, a.max.min(16 << 20)), &mut bytes).map_err(|e| e.to_string())?;
            let truncated = entry.size > bytes.len() as u64;
            Ok(json!({ "text": String::from_utf8_lossy(&bytes), "truncated": truncated, "mtime": entry.mtime, "size": entry.size }))
        })
    });
    d.on("fs.write_text", |app, _, a| {
        #[derive(Deserialize)]
        struct Write {
            uri: String,
            text: String,
            mtime: Option<i64>,
        }
        let a: Write = args(a)?;
        let uri = Uri::parse(&a.uri)?;
        off_main(app, &uri.clone(), move || {
            let provider = registry().get(&uri)?;
            if let (Some(expected), Ok(now)) = (a.mtime, provider.stat(&uri)) {
                if now.mtime != expected {
                    return Err(tr("Tệp đã bị sửa ở nơi khác từ lúc mở; hãy mở lại", "The file changed elsewhere since it was opened; open it again").into());
                }
            }
            let mut writer = provider.write(&uri)?;
            std::io::Write::write_all(&mut writer, a.text.as_bytes()).map_err(|e| e.to_string())?;
            writer.commit()?;
            serde_json::to_value(provider.stat(&uri)?).map_err(|e| e.to_string())
        })
    });
    d.on("clipboard.copy", |app, window, a| {
        let paths = local_paths(&targets(app, window, &a)?)?;
        clipboard::write(&paths);
        app.browse.cut = clipboard::Cut::default();
        Ok(Value::Null)
    });
    d.on("clipboard.cut", |app, window, a| {
        let paths = local_paths(&targets(app, window, &a)?)?;
        let count = clipboard::write(&paths);
        app.browse.cut = clipboard::Cut { paths, count };
        Ok(Value::Null)
    });
    d.on("clipboard.paste", |app, window, a| {
        #[derive(Deserialize)]
        struct Paste {
            to: String,
            /// Moves what was copied rather than copying it, as Finder's Move Item Here.
            #[serde(default, rename = "move")]
            mv: bool,
        }
        let a: Paste = args(a)?;
        let to = Uri::parse(&a.to)?;
        let paths = clipboard::read();
        if paths.is_empty() {
            return Err(tr("Bảng nhớ tạm không có tệp nào", "There are no files on the clipboard").into());
        }
        let mv = a.mv || app.browse.cut.applies(clipboard::change_count(), &paths);
        if mv {
            app.browse.cut = clipboard::Cut::default();
        }
        let from: Vec<Uri> = paths.iter().map(|p| Uri::file(p)).collect();
        let job = start_transfer(app, window, from, to, mv);
        Ok(json!({ "job": job }))
    });
    d.on("clipboard.state", |app, _, _| {
        let count = clipboard::change_count();
        let cut: Vec<String> = if app.browse.cut.count == count { app.browse.cut.paths.iter().map(|p| Uri::file(p).to_string()).collect() } else { Vec::new() };
        Ok(json!({ "cut": cut }))
    });
    d.on("jobs.list", |app, _, _| Ok(app.jobs.list()));
    d.on("jobs.pause", |app, window, a| {
        #[derive(Deserialize)]
        struct Pause {
            id: u64,
            paused: bool,
        }
        let a: Pause = args(a)?;
        app.jobs.pause(a.id, a.paused)?;
        app.post(window, event("jobs.paused", json!({ "id": a.id, "paused": a.paused })));
        Ok(Value::Null)
    });
    d.on("jobs.cancel", |app, _, a| {
        #[derive(Deserialize)]
        struct Cancel {
            id: u64,
        }
        app.jobs.cancel(args::<Cancel>(a)?.id)?;
        Ok(Value::Null)
    });
    d.on("jobs.answer", |app, _, a| {
        #[derive(Deserialize)]
        struct AnswerArgs {
            id: u64,
            answer: Answer,
            #[serde(default, rename = "applyAll")]
            apply_all: bool,
        }
        let a: AnswerArgs = args(a)?;
        app.jobs.answer(a.id, a.answer, a.apply_all)?;
        Ok(Value::Null)
    });
    d.on("native.open", |app, window, a| {
        let uris = targets(app, window, &a)?;
        if let Ok(paths) = local_paths(&uris) {
            workspace::open(&paths)?;
            return Ok(Value::Null);
        }
        // An item inside an archive or on a server opens from a copy on this Mac, made off the main thread.
        if uris.iter().any(|u| u.scheme != "archive") {
            app.post(window, event("toast", json!(tr("Đang mở bản sao tạm; sửa trong đó không được lưu ngược lên máy chủ", "Opening a temporary copy; changes to it are not saved back to the server"))));
        }
        defer(app, move || {
            let paths: Vec<PathBuf> = uris.iter().map(vfs::materialize).collect::<Result<_, _>>()?;
            workspace::open(&paths)?;
            Ok(Value::Null)
        })
    });
    d.on("native.open_with", |app, window, a| {
        #[derive(Deserialize)]
        struct OpenWith {
            app: String,
        }
        let paths = local_paths(&targets(app, window, &a)?)?;
        workspace::open_with(&paths, Path::new(&args::<OpenWith>(a)?.app))?;
        Ok(Value::Null)
    });
    d.on("native.apps_for", |_, _, a| {
        #[derive(Deserialize)]
        struct AppsFor {
            uri: String,
        }
        let path = Uri::parse(&args::<AppsFor>(a)?.uri)?.local_path().ok_or_else(|| tr("Chỉ với tệp trên máy", "Only for files on this Mac").to_owned())?;
        serde_json::to_value(workspace::apps_for(&path)).map_err(|e| e.to_string())
    });
    d.on("native.reveal", |app, window, a| {
        workspace::reveal(&local_paths(&targets(app, window, &a)?)?)?;
        Ok(Value::Null)
    });
    d.on("native.get_info", |app, window, a| {
        for path in local_paths(&targets(app, window, &a)?)? {
            workspace::get_info(&path)?;
        }
        Ok(Value::Null)
    });
    d.on("native.volumes", |_, _, _| serde_json::to_value(workspace::volumes()).map_err(|e| e.to_string()));
    d.on("native.eject", |app, _, a| {
        #[derive(Deserialize)]
        struct Eject {
            path: String,
            /// Unmounted even while apps hold files open on it (src/native/workspace.rs).
            #[serde(default)]
            force: bool,
        }
        let Eject { path, force } = args(a)?;
        // A disk takes a while to eject, longer while it is still being written; the windows go on meanwhile.
        defer(app, move || {
            let path = Path::new(&path);
            if force { workspace::force_eject(path) } else { workspace::eject(path) }.map(|()| Value::Null)
        })
    });
    d.on("native.fonts", |_, _, _| Ok(json!(workspace::font_families())));
    d.on("native.home", |_, _, _| {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
        let place = |p: Option<PathBuf>| p.map(|p| Uri::file(&p).to_string());
        Ok(json!({
            "home": Uri::file(&home).to_string(),
            "desktop": place(dirs::desktop_dir()),
            "documents": place(dirs::document_dir()),
            "downloads": place(dirs::download_dir()),
            "movies": place(dirs::video_dir()),
            "music": place(dirs::audio_dir()),
            "pictures": place(dirs::picture_dir()),
            "applications": Uri::file(Path::new("/Applications")).to_string(),
            "trash": Uri::file(&home.join(".Trash")).to_string(),
            // The files used lately, as a search of the home folder (src/features/search.rs).
            "recents": Uri { scheme: "search".into(), authority: "recent=1".into(), path: Uri::file(&home).path }.to_string(),
        }))
    });
}

/// Whether two places are on the same disk, where a drop moves rather than copies. The folders of two clouds (or a
/// cloud and the rest of the disk) count as two disks: what goes from one account to another is copied. Off this Mac,
/// one server or one cloud account through rclone is one disk.
fn same_disk(a: &Uri, b: &Uri) -> bool {
    use std::os::unix::fs::MetadataExt;
    if a.scheme != "file" || b.scheme != "file" {
        return a.scheme == b.scheme && a.authority == b.authority;
    }
    let dev = |u: &Uri| u.local_path().and_then(|p| std::fs::symlink_metadata(&p).ok()).map(|m| m.dev());
    let cloud = |u: &Uri| u.local_path().and_then(|p| crate::features::remote::cloud_root(&p));
    matches!((dev(a), dev(b)), (Some(x), Some(y)) if x == y) && cloud(a) == cloud(b)
}

fn one_mib() -> u64 {
    1 << 20
}

/// Takes a step back: moved items go back where they were when that place is free, made items go to the Trash.
fn run_undo(undo: &Undo, ctx: &crate::jobs::Ctx) -> Result<Value, String> {
    let mut skipped = Vec::new();
    match undo {
        Undo::Moves { moves, .. } => {
            for (i, (now, was)) in moves.iter().enumerate() {
                if was.exists() {
                    skipped.push(was.display().to_string());
                } else {
                    vfs::local::rename(now, was).or_else(|_| {
                        // Across disks a rename cannot go back; copy and remove instead.
                        copy::transfer(ctx, &[Uri::file(now)], &Uri::file(was.parent().unwrap_or(Path::new("/"))), true).map(drop)
                    })?;
                }
                ctx.progress(i as u64 + 1, moves.len() as u64, "");
            }
        }
        Undo::Renames { pairs, .. } => {
            vfs::local::rename_all(pairs)?;
            ctx.progress(1, 1, "");
        }
        Undo::Made { made, .. } => {
            for (i, path) in made.iter().enumerate() {
                if path.exists() {
                    trash::trash(path)?;
                }
                ctx.progress(i as u64 + 1, made.len() as u64, "");
            }
        }
    }
    if skipped.is_empty() { Ok(Value::Null) } else { Err(format!("{}: {}", tr("Đã có mục khác ở chỗ cũ", "Something else is already where these were"), skipped.join(", "))) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{jobs::test_ctx, vfs::local::tests::Temp};

    #[test]
    fn a_drop_moves_within_one_disk_or_account_and_copies_across() {
        let home = dirs::home_dir().unwrap();
        let file = |p: &str| Uri::file(&home.join(p));
        let rclone = |p: &str| Uri::parse(p).unwrap();
        assert!(same_disk(&file(""), &file("Library")));
        assert!(same_disk(&rclone("rclone://work/a"), &rclone("rclone://work/b/c")));
        assert!(!same_disk(&rclone("rclone://work/a"), &rclone("rclone://home/a")));
        assert!(!same_disk(&rclone("rclone://work/a"), &file("")));
    }

    #[test]
    fn a_copy_is_checked_byte_for_byte_and_a_changed_one_fails() {
        let t = Temp::new("verify");
        t.file("from/dir/a.txt", "a");
        t.file("from/b.txt", "b");
        t.file("to/dir/a.txt", "a");
        t.file("to/b.txt", "b");
        let pair = |name: &str| (Uri::file(&t.0.join("from").join(name)), Uri::file(&t.0.join("to").join(name)));
        let pairs = [pair("dir"), pair("b.txt")];
        let (ctx, _answers, _cancel) = test_ctx();
        assert!(verify_copies(&ctx, &pairs).is_ok());
        t.file("to/dir/a.txt", "x");
        assert!(verify_copies(&ctx, &pairs).unwrap_err().contains("a.txt"));
    }

    #[test]
    fn a_crumb_lists_the_folders_in_it_by_name_without_hidden_ones() {
        let t = Temp::new("subfolders");
        t.file("b/x", "");
        t.file("A/x", "");
        t.file(".hidden/x", "");
        t.file("file.txt", "");
        let names: Vec<Value> = subfolders(&t.uri()).unwrap().iter().map(|f| f["name"].clone()).collect();
        assert_eq!(names, [json!("A"), json!("b")]);
        assert!(subfolders(&t.uri().join("nothing")).is_err(), "a folder that is not there");
    }

    #[test]
    fn the_address_bar_completes_folders_by_prefix() {
        let t = Temp::new("complete");
        t.file("Documents/x", "");
        t.file("Downloads/x", "");
        t.file("Desk.txt", "");
        t.file(".dotdir/x", "");
        let base = t.0.display().to_string();
        assert_eq!(complete(&format!("{base}/do")), [format!("{base}/Documents/"), format!("{base}/Downloads/")]);
        assert_eq!(complete(&format!("{base}/DOW")), [format!("{base}/Downloads/")]);
        assert!(complete(&format!("{base}/")).iter().all(|p| !p.contains(".dotdir")), "hidden folders only when a dot is typed");
        assert_eq!(complete(&format!("{base}/.d")), [format!("{base}/.dotdir/")]);
        assert!(complete("relative/path").is_empty());
        assert!(complete("~").iter().all(|p| p.starts_with('/')));
    }

    #[test]
    fn undo_moves_items_back_or_asks_when_the_place_is_taken() {
        let t = Temp::new("undo");
        // A folder of the test plays the Trash: the move "to the Trash" is a rename into it.
        let original = t.file("a.txt", "a");
        let trashed = t.0.join("trash/a.txt");
        std::fs::create_dir_all(trashed.parent().unwrap()).unwrap();
        std::fs::rename(&original, &trashed).unwrap();
        let (ctx, _answers, _) = test_ctx();
        let undo = Undo::Moves { title: "t".into(), moves: vec![(trashed.clone(), original.clone())] };
        run_undo(&undo, &ctx).unwrap();
        assert!(original.exists() && !trashed.exists());
        std::fs::rename(&original, &trashed).unwrap();
        t.file("a.txt", "something new");
        assert!(run_undo(&undo, &ctx).is_err(), "the place is taken");
        assert_eq!(std::fs::read_to_string(&original).unwrap(), "something new", "what is there now is untouched");
    }

    #[test]
    fn a_new_folder_is_named_like_finders() {
        let t = Temp::new("newfolder");
        let base = tr("thư mục không tên", "untitled folder");
        assert_eq!(new_folder_name(&t.uri()).unwrap(), base);
        std::fs::create_dir(t.0.join(base)).unwrap();
        assert_eq!(new_folder_name(&t.uri()).unwrap(), format!("{base} 2"));
    }
}
