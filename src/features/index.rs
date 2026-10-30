//! The quick index: every file and folder under the places people keep their own things (the home folder and the
//! Applications), held in memory, kept up to date by FSEvents, and matched as fzf matches (nucleo-matcher, the same
//! scoring in Rust), so a search answers as fast as one types and a name typed without its accents ("bao cao") still
//! finds it ("Báo cáo"). What nobody looks for is left out: hidden items, the Library, node_modules and the like, build
//! folders that mark themselves with CACHEDIR.TAG, and what is inside an app or another package. A copy of the list is
//! kept in the cache folder, so a new launch searches at once while it walks the disk again.

use crate::{
    features::search::Query,
    ipc::{Dispatcher, args, defer},
    vfs::{cache_dir, local},
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use nucleo_matcher::{
    Config, Matcher, Utf32String,
    pattern::{CaseMatching, Normalization, Pattern},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    cmp::Reverse,
    collections::{BTreeMap, BinaryHeap},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock, RwLock},
    thread,
};

/// The most items kept; a disk with more is indexed up to here.
const MAX_ITEMS: usize = 2_000_000;
/// Folders never gone into, by name, wherever they are.
const SKIP: &[&str] = &["node_modules", "bower_components", "DerivedData", "Pods", "__pycache__"];

/// One item of the index: whether it is a folder to go into, and the text it is matched by, made once.
struct Item {
    folder: bool,
    text: Utf32String,
}

impl Item {
    /// The item at `path`, matched by its path from the home folder (or from the root for the rest) without the marks
    /// the matcher does not fold.
    fn new(path: &str, folder: bool) -> Item {
        static HOME: OnceLock<String> = OnceLock::new();
        let home = HOME.get_or_init(|| format!("{}/", home().to_string_lossy()));
        let shown = path.strip_prefix(home.as_str()).unwrap_or_else(|| path.trim_start_matches('/'));
        Item { folder, text: Utf32String::from(plain(shown).as_ref()) }
    }
}

#[derive(Default)]
struct State {
    /// Every path with its item; sorted, so the items under a folder are together.
    items: BTreeMap<String, Item>,
    ready: bool,
    building: bool,
}

fn state() -> &'static RwLock<State> {
    static STATE: OnceLock<RwLock<State>> = OnceLock::new();
    STATE.get_or_init(|| RwLock::new(State::default()))
}

/// The watcher of the indexed places, kept while the app runs.
fn watcher() -> &'static Mutex<Option<RecommendedWatcher>> {
    static WATCHER: OnceLock<Mutex<Option<RecommendedWatcher>>> = OnceLock::new();
    WATCHER.get_or_init(|| Mutex::new(None))
}

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

/// The places indexed: the home folder and the Applications folder.
pub fn roots() -> Vec<PathBuf> {
    vec![home(), PathBuf::from("/Applications")]
}

fn cache_file() -> PathBuf {
    cache_dir().join("quick-index.txt")
}

/// Whether an item of these names is left out: hidden, a folder nobody looks into, or the Library of the home folder.
fn skipped(path: &Path, name: &str, is_dir: bool) -> bool {
    name.starts_with('.') || (is_dir && (SKIP.contains(&name) || path == home().join("Library") || path.join("CACHEDIR.TAG").exists()))
}

/// Whether an item lies under a part of the disk the index leaves out, which an FSEvent of it does not say.
fn under_skipped(path: &Path, roots: &[PathBuf]) -> bool {
    let Some(root) = roots.iter().find(|r| path.starts_with(r)) else { return true };
    let mut at = root.clone();
    for part in path.strip_prefix(root).unwrap_or(path).components() {
        let name = part.as_os_str().to_string_lossy();
        at.push(&*name);
        let package = Path::new(&*name).extension().is_some_and(|e| local::is_package(&e.to_string_lossy()));
        if at != path && (skipped(&at, &name, true) || package) {
            return true;
        }
        if at == path && skipped(&at, &name, at.is_dir()) {
            return true;
        }
    }
    false
}

/// Every item under `root` the index keeps, added to `into`. A package is an item, never gone into; a link is never
/// followed.
fn walk(root: &Path, into: &mut BTreeMap<String, Item>) {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(items) = fs::read_dir(&dir) else { continue };
        for item in items.flatten() {
            if into.len() >= MAX_ITEMS {
                return;
            }
            let Ok(kind) = item.file_type() else { continue };
            let name = item.file_name().to_string_lossy().into_owned();
            let path = item.path();
            if skipped(&path, &name, kind.is_dir()) {
                continue;
            }
            let package = kind.is_dir() && Path::new(&name).extension().is_some_and(|e| local::is_package(&e.to_string_lossy()));
            let folder = kind.is_dir() && !package;
            let key = path.to_string_lossy().into_owned();
            let item = Item::new(&key, folder);
            into.insert(key, item);
            if folder {
                stack.push(path);
            }
        }
    }
}

/// Walks every root again on a thread of its own and puts the new list in place; the old one serves until then.
pub fn rebuild() {
    {
        let Ok(mut s) = state().write() else { return };
        if s.building {
            return;
        }
        s.building = true;
    }
    thread::spawn(|| {
        let mut items = BTreeMap::new();
        for root in roots() {
            walk(&root, &mut items);
        }
        save_cache(&items);
        if let Ok(mut s) = state().write() {
            s.items = items;
            s.ready = true;
            s.building = false;
        }
        watch();
    });
}

/// The list of the last run, to search with until the walk is done.
fn load_cache() {
    let Ok(text) = fs::read_to_string(cache_file()) else { return };
    let items: BTreeMap<String, Item> = text.lines().filter_map(|l| l.split_once('\t')).map(|(kind, path)| (path.to_owned(), Item::new(path, kind == "d"))).collect();
    if let Ok(mut s) = state().write()
        && !s.ready
        && !items.is_empty()
    {
        s.items = items;
        s.ready = true;
    }
}

fn save_cache(items: &BTreeMap<String, Item>) {
    let mut text = String::with_capacity(items.len() * 80);
    for (path, item) in items {
        // A name with a line break in it would break the file into two lines; it is left out of the copy only.
        if !path.contains('\n') {
            text.push_str(if item.folder { "d\t" } else { "f\t" });
            text.push_str(path);
            text.push('\n');
        }
    }
    let file = cache_file();
    let temp = file.with_extension("tmp");
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if fs::write(&temp, text).and_then(|()| fs::rename(&temp, &file)).is_err() {
        let _ = fs::remove_file(&temp);
    }
}

/// Follows the roots with FSEvents and brings the index up to date with each change: an item that is there is added
/// (a new folder with all that is in it), one that is gone goes with everything under it.
fn watch() {
    let Ok(mut slot) = watcher().lock() else { return };
    if slot.is_some() {
        return;
    }
    let roots = roots();
    let handler = {
        let roots = roots.clone();
        move |result: notify::Result<notify::Event>| {
            let Ok(event) = result else { return };
            for path in event.paths {
                apply(&path, &roots);
            }
        }
    };
    let Ok(mut w) = notify::recommended_watcher(handler) else { return };
    for root in &roots {
        let _ = w.watch(root, RecursiveMode::Recursive);
    }
    *slot = Some(w);
}

fn apply(path: &Path, roots: &[PathBuf]) {
    if under_skipped(path, roots) || roots.iter().any(|r| r == path) {
        return;
    }
    let key = path.to_string_lossy().into_owned();
    let Ok(mut s) = state().write() else { return };
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let package = meta.is_dir() && Path::new(&name).extension().is_some_and(|e| local::is_package(&e.to_string_lossy()));
            let folder = meta.is_dir() && !package;
            let item = Item::new(&key, folder);
            let new = s.items.insert(key, item).is_none();
            if new && folder {
                let mut under = BTreeMap::new();
                walk(path, &mut under);
                s.items.extend(under);
            }
        }
        Err(_) => {
            s.items.remove(&key);
            let prefix = format!("{key}/");
            let gone: Vec<String> = s.items.range(prefix.clone()..).take_while(|(p, _)| p.starts_with(&prefix)).map(|(p, _)| p.clone()).collect();
            for p in gone {
                s.items.remove(&p);
            }
        }
    }
}

/// One item that matches, with its score; the higher, the better.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Hit {
    pub score: u32,
    /// Shorter paths win a tie, so the lowest of the scores wins at the same score.
    pub shortness: Reverse<usize>,
    pub path: String,
    pub folder: bool,
}

/// The items whose path (from the home folder, or from the root for the rest) matches `text` as fzf would match it,
/// the best `limit` first, only those under `under` when it is given; None until the index is first ready. The items
/// are shared among the cores, each with a matcher of its own.
pub fn search(text: &str, under: Option<&Path>, limit: usize) -> Option<Vec<Hit>> {
    let s = state().read().ok()?;
    if !s.ready {
        return None;
    }
    let needle = plain(text).into_owned();
    let prefix = under.map(|u| format!("{}/", u.to_string_lossy().trim_end_matches('/')));
    let items: Vec<(&String, &Item)> = match &prefix {
        Some(prefix) => s.items.range(prefix.clone()..).take_while(|(p, _)| p.starts_with(prefix.as_str())).collect(),
        None => s.items.iter().collect(),
    };
    let cores = thread::available_parallelism().map_or(4, |n| n.get()).clamp(1, 8);
    let chunk = items.len().div_ceil(cores).max(4096);
    let best = thread::scope(|scope| {
        let workers: Vec<_> = items
            .chunks(chunk)
            .map(|part| {
                let needle = needle.as_str();
                scope.spawn(move || {
                    let pattern = Pattern::parse(needle, CaseMatching::Smart, Normalization::Smart);
                    let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
                    let mut best: BinaryHeap<Reverse<Hit>> = BinaryHeap::with_capacity(limit + 1);
                    for (path, item) in part {
                        let Some(score) = pattern.score(item.text.slice(..), &mut matcher) else { continue };
                        let hit = Hit { score, shortness: Reverse(path.len()), path: (*path).clone(), folder: item.folder };
                        if best.len() < limit {
                            best.push(Reverse(hit));
                        } else if best.peek().is_some_and(|Reverse(worst)| hit > *worst) {
                            best.pop();
                            best.push(Reverse(hit));
                        }
                    }
                    best
                })
            })
            .collect();
        workers.into_iter().filter_map(|w| w.join().ok()).flatten().collect::<Vec<_>>()
    });
    let mut hits: Vec<Hit> = best.into_iter().map(|Reverse(h)| h).collect();
    hits.sort_by(|a, b| b.cmp(a));
    hits.truncate(limit);
    Some(hits)
}

/// The text with the letters of Vietnamese the matcher does not fold as their plain letters: Đ and đ, which fzf's
/// folding leaves as they are, and the block of tone marks (ạ to ỹ, U+1EA0 to U+1EF9), whose table nucleo-matcher 0.3.1
/// builds from the wrong data; a mark written apart from its letter (a name in NFD) goes too. A plain name, as most
/// are, is borrowed as it is.
fn plain(text: &str) -> std::borrow::Cow<'_, str> {
    if text.is_ascii() {
        return text.into();
    }
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c as u32 {
            0x0300..=0x036F => {}
            0x0110 => out.push('D'),
            0x0111 => out.push('d'),
            code @ 0x1EA0..=0x1EF9 => {
                // The block runs letter by letter, a capital then its small one: A (24), E (16), I (4), O (24), U (14), Y (8).
                let at = code - 0x1EA0;
                let base = match at {
                    0..24 => 'a',
                    24..40 => 'e',
                    40..44 => 'i',
                    44..68 => 'o',
                    68..82 => 'u',
                    _ => 'y',
                };
                out.push(if at % 2 == 0 { base.to_ascii_uppercase() } else { base });
            }
            _ => out.push(c),
        }
    }
    out.into()
}

/// Whether the index answers for a search under `scope` with `query`: the place is indexed, and the query asks for
/// words in names only (the contents, a tag and the recent items are Spotlight's).
pub fn answers(query: &Query, scope: &Path) -> bool {
    !query.text.trim().is_empty() && !query.content && query.tag.is_empty() && !query.recent && scope != Path::new("/") && roots().iter().any(|r| scope.starts_with(r)) && !under_skipped(scope, &roots())
}

pub fn register(d: &mut Dispatcher) {
    d.on_start(|_| {
        thread::spawn(|| {
            load_cache();
            rebuild();
        });
    });
    d.on("index.search", |app, _, a| {
        #[derive(Deserialize)]
        struct Search {
            q: String,
            #[serde(default)]
            under: Option<String>,
            #[serde(default)]
            limit: Option<usize>,
        }
        let a: Search = args(a)?;
        defer(app, move || {
            let limit = a.limit.unwrap_or(50).min(5000);
            let hits = search(&a.q, a.under.as_deref().map(Path::new), limit);
            let items: Vec<Value> = hits.iter().flatten().map(|h| json!({ "path": h.path, "folder": h.folder, "score": h.score })).collect();
            Ok(json!({ "items": items, "ready": hits.is_some() }))
        })
    });
    d.on("index.state", |_, _, _| {
        let s = state().read().map_err(|e| e.to_string())?;
        Ok(json!({ "ready": s.ready, "building": s.building, "count": s.items.len() }))
    });
    d.on("index.rebuild", |_, _, _| {
        rebuild();
        Ok(Value::Null)
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;

    #[test]
    fn the_walk_keeps_what_people_look_for() {
        let t = Temp::new("index-walk");
        t.file("Documents/Báo cáo quý 3.pdf", "");
        t.file("Documents/.secret/x.txt", "");
        t.file("web/node_modules/left-pad/index.js", "");
        t.file("rust/target/CACHEDIR.TAG", "");
        t.file("rust/target/debug/app", "");
        t.file("Tool.app/Contents/Info.plist", "");
        let mut items = BTreeMap::new();
        walk(&t.0, &mut items);
        let mut names: Vec<String> = items.keys().map(|p| p.strip_prefix(&t.0.to_string_lossy().to_string()).unwrap().to_owned()).collect();
        names.sort();
        assert_eq!(names, ["/Documents", "/Documents/Báo cáo quý 3.pdf", "/Tool.app", "/rust", "/web"]);
        assert!(!items[&t.0.join("Tool.app").to_string_lossy().to_string()].folder, "an app is an item, not a folder to go into");
    }

    #[test]
    fn matching_is_fzf_like_without_accents_and_best_first() {
        use nucleo_matcher::Utf32Str;
        let pattern = Pattern::parse("bao cao", CaseMatching::Smart, Normalization::Smart);
        let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
        let mut buf = Vec::new();
        let score = |text: &str, buf: &mut Vec<char>, m: &mut Matcher| pattern.score(Utf32Str::new(text, buf), m);
        assert!(score("Documents/Báo cáo quý 3.pdf", &mut buf, &mut matcher).is_some(), "letters without their accents still match");
        assert!(score("Documents/Đường dẫn.txt", &mut buf, &mut matcher).is_none());
        let dd = Pattern::parse(&plain("duong"), CaseMatching::Smart, Normalization::Smart);
        assert!(dd.score(Utf32Str::new(&plain("Đường dẫn.txt"), &mut buf), &mut matcher).is_some(), "đ is d");
        let typed = Pattern::parse(&plain("đường dẫn"), CaseMatching::Smart, Normalization::Smart);
        assert!(typed.score(Utf32Str::new(&plain("Đường dẫn.txt"), &mut buf), &mut matcher).is_some(), "typed with its marks, it still matches");
        assert_eq!(plain("Ạ ạ Ặ ặ Ẹ ệ Ỉ ị Ọ ợ Ụ ự Ỳ ỹ"), "A a A a E e I i O o U u Y y");
        assert_eq!(plain("Tie\u{302}\u{301}ng"), "Tieng", "marks written apart go too");
        assert!(matches!(plain("plain.txt"), std::borrow::Cow::Borrowed(_)));
        let tight = score("Documents/bao cao.txt", &mut buf, &mut matcher).unwrap();
        let loose = score("b/a/o/x/c/a/o.txt", &mut buf, &mut matcher).unwrap_or(0);
        assert!(tight > loose, "{tight} > {loose}");
    }
}


#[cfg(test)]
mod bench {
    use super::*;
    use crate::vfs::local::tests::Temp;

    /// Run with `cargo test --release -- --ignored bench_quick_index --nocapture`: walks 100 000 items and matches a
    /// few words against them, as typing in the search field does.
    #[test]
    #[ignore]
    fn bench_quick_index() {
        let t = Temp::new("index-bench");
        for d in 0..200 {
            let dir = t.0.join(format!("Dự án {d}/src/module_{}", d % 7));
            fs::create_dir_all(&dir).unwrap();
            for f in 0..500 {
                fs::write(dir.join(format!("báo cáo {f} thang {}.txt", f % 12)), b"").unwrap();
            }
        }
        let started = std::time::Instant::now();
        let mut items = BTreeMap::new();
        walk(&t.0, &mut items);
        eprintln!("walk: {} items in {:?}", items.len(), started.elapsed());
        state().write().unwrap().items = items;
        state().write().unwrap().ready = true;
        for q in ["bao", "bao cao 42", "du an 17 mod", "zzz"] {
            let started = std::time::Instant::now();
            let hits = search(q, None, 50).unwrap();
            eprintln!("{q:?}: {} hits in {:?}, best {:?}", hits.len(), started.elapsed(), hits.first().map(|h| h.path.rsplit('/').next().unwrap().to_owned()));
        }
    }
}
