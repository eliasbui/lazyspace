//! Search as a folder of its own: `search://<what>/<folder>`, where `<what>` is the query
//! (`q=report&kind=pdf&date=week&size=1m&content=1&tag=Red&recent=1`, each value encoded once more) and `<folder>` is
//! where to look, `/` for the whole Mac. Words in names under the home folder are matched in the quick index, as fzf
//! matches, the best first (src/features/index.rs); the rest is Spotlight's (`mdfind`): the contents, the tags, the
//! recent items, the whole Mac. A folder neither knows (an external disk, a folder left out of Spotlight) is walked by
//! hand instead, by name only. The items keep their own `file://` URIs, so
//! opening, copying, renaming and the Trash work on them as anywhere; two of the same name are told apart by their
//! folder. The recent items of the sidebar and the items of a tag are searches too.

use crate::{
    features::index,
    ipc::Dispatcher,
    tr,
    vfs::{Capabilities, Commit, Entry, Provider, Uri, fold, local, registry},
};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

/// The most items a search shows.
const MAX: usize = 5000;
/// The most items the walk of a folder Spotlight does not index looks at.
const WALK_MAX: usize = 200_000;
/// How far back the recent items go, in days.
const RECENT_DAYS: u32 = 30;

/// What a search asks for.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Query {
    /// The words the name holds, every one of them.
    pub text: String,
    /// "folder", "image", "movie", "audio", "pdf", "document", "archive", "app", "code" or empty for any.
    pub kind: String,
    /// Changed within: "today", "week", "month", "year", or empty for any time.
    pub date: String,
    /// At least: "1m", "100m", "1g", or empty for any size.
    pub size: String,
    /// The words may be in the contents too, not only in the name.
    pub content: bool,
    /// A tag of Finder's the items carry.
    pub tag: String,
    /// The files used lately, newest first, instead of words.
    pub recent: bool,
}

impl Query {
    /// The query in the authority of a search URI (already decoded once by `Uri::parse`).
    pub fn parse(authority: &str) -> Query {
        let mut query = Query::default();
        for pair in authority.split('&') {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            let value = decode(value);
            match key {
                "q" => query.text = value,
                "kind" => query.kind = value,
                "date" => query.date = value,
                "size" => query.size = value,
                "content" => query.content = value == "1",
                "tag" => query.tag = value,
                "recent" => query.recent = value == "1",
                _ => {}
            }
        }
        query
    }

    fn words(&self) -> Vec<String> {
        self.text.split_whitespace().map(str::to_owned).collect()
    }

    /// The query in Spotlight's language, or None when it asks for nothing (no words, no tag, not the recent items),
    /// which would list every file.
    pub fn spotlight(&self) -> Option<String> {
        let mut all: Vec<String> = Vec::new();
        for word in self.words() {
            let word = escape(&word);
            all.push(if self.content { format!("(kMDItemFSName == \"*{word}*\"cd || kMDItemTextContent == \"{word}*\"cdw)") } else { format!("kMDItemFSName == \"*{word}*\"cd") });
        }
        if !self.tag.is_empty() {
            // A colour of Finder's is found by its name and by the label the system keeps for its colour, so an item tagged
            // under the name of another language still comes.
            let name = format!("kMDItemUserTags == \"{}\"cd", escape(&self.tag));
            all.push(match crate::native::tags::COLOURS.iter().position(|c| !c.is_empty() && c.eq_ignore_ascii_case(&self.tag)) {
                Some(colour) => format!("({name} || kMDItemFSLabel == {colour})"),
                None => name,
            });
        }
        if self.recent {
            all.push(format!("kMDItemLastUsedDate >= $time.today(-{RECENT_DAYS})"));
            all.push("kMDItemContentTypeTree != \"public.folder\"".into());
            all.push("kMDItemContentTypeTree != \"com.apple.application-bundle\"".into());
        }
        if all.is_empty() {
            return None;
        }
        let types: &[&str] = match self.kind.as_str() {
            "folder" => &["public.folder"],
            "image" => &["public.image"],
            "movie" => &["public.movie"],
            "audio" => &["public.audio"],
            "pdf" => &["com.adobe.pdf"],
            "document" => &["public.composite-content", "public.text", "com.adobe.pdf"],
            "archive" => &["public.archive"],
            "app" => &["com.apple.application-bundle"],
            "code" => &["public.source-code"],
            _ => &[],
        };
        if !types.is_empty() {
            all.push(format!("({})", types.iter().map(|t| format!("kMDItemContentTypeTree == \"{t}\"")).collect::<Vec<_>>().join(" || ")));
        }
        let days = match self.date.as_str() {
            "today" => Some(0),
            "week" => Some(7),
            "month" => Some(30),
            "year" => Some(365),
            _ => None,
        };
        if let Some(days) = days {
            all.push(if days == 0 { "kMDItemFSContentChangeDate >= $time.today".into() } else { format!("kMDItemFSContentChangeDate >= $time.today(-{days})") });
        }
        if let Some(bytes) = min_size(&self.size) {
            all.push(format!("kMDItemFSSize >= {bytes}"));
        }
        Some(all.join(" && "))
    }

    /// Whether a name (and a folder or not) answers the query, for the walk: the words in the name, and the kinds a
    /// name tells.
    fn takes(&self, name: &str, is_dir: bool) -> bool {
        let name = fold(name);
        self.kind_of_name(&name, is_dir) && self.words().iter().all(|w| name.contains(&fold(w)))
    }

    /// Whether an item of this name is of the kind asked for, as far as its name tells.
    fn kind_of_name(&self, name: &str, is_dir: bool) -> bool {
        let ext = Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        match self.kind.as_str() {
            "" => true,
            "folder" => is_dir,
            "image" => matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "heic" | "webp" | "tiff" | "bmp" | "svg" | "raw" | "dng"),
            "movie" => matches!(ext.as_str(), "mov" | "mp4" | "m4v" | "mkv" | "avi" | "webm"),
            "audio" => matches!(ext.as_str(), "mp3" | "m4a" | "aac" | "wav" | "flac" | "ogg" | "aiff"),
            "pdf" => ext == "pdf",
            "archive" => matches!(ext.as_str(), "zip" | "7z" | "rar" | "tar" | "gz" | "tgz" | "xz" | "bz2" | "dmg"),
            "app" => ext == "app",
            "code" => matches!(ext.as_str(), "rs" | "js" | "ts" | "tsx" | "jsx" | "py" | "go" | "c" | "h" | "cpp" | "swift" | "java" | "kt" | "rb" | "php" | "cs" | "sh" | "html" | "css"),
            _ => !is_dir,
        }
    }

    /// Whether an entry is as new and as big as the query asks; the index knows names only, so its matches are
    /// checked here.
    fn fits(&self, entry: &Entry) -> bool {
        let days = match self.date.as_str() {
            "today" => Some(0),
            "week" => Some(7),
            "month" => Some(30),
            "year" => Some(365),
            _ => None,
        };
        let new_enough = days.is_none_or(|days| entry.mtime >= crate::native::start_of_today() - days * 86_400);
        new_enough && min_size(&self.size).is_none_or(|bytes| entry.size >= bytes)
    }
}

/// The least size of a size filter, in bytes.
fn min_size(size: &str) -> Option<u64> {
    match size {
        "1m" => Some(1_000_000),
        "100m" => Some(100_000_000),
        "1g" => Some(1_000_000_000),
        _ => None,
    }
}

/// A word as a string of Spotlight's language: a quote and a backslash are escaped; a star stays a wildcard.
fn escape(word: &str) -> String {
    word.replace('\\', "\\\\").replace('"', "\\\"")
}

fn decode(text: &str) -> String {
    crate::vfs::decode(text).unwrap_or_else(|| text.to_owned())
}

/// Whether a found item is one a person looks for: not hidden, not inside a hidden folder, not a part of the system or
/// of the Library, unless the search was started in such a place.
fn worth_showing(path: &Path, scope: &Path) -> bool {
    let rel = path.strip_prefix(scope).unwrap_or(path);
    if rel.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.')) {
        return false;
    }
    let home_library = dirs::home_dir().map(|h| h.join("Library"));
    let system = ["/System", "/Library", "/private", "/usr", "/bin", "/sbin", "/opt", "/cores", "/dev"];
    let in_place = |place: &Path| path.starts_with(place) && !scope.starts_with(place);
    !system.iter().any(|p| in_place(Path::new(p))) && !home_library.as_deref().is_some_and(in_place)
}

/// The items Spotlight finds for `query` under `scope`, the recent ones newest first, or None when Spotlight could not
/// be asked or found nothing there.
fn spotlight(query: &Query, scope: &Path, cancel: &AtomicBool) -> Option<Vec<PathBuf>> {
    let text = query.spotlight()?;
    let mut command = Command::new("/usr/bin/mdfind");
    command.arg("-0");
    if scope != Path::new("/") {
        command.arg("-onlyin").arg(scope);
    }
    if query.recent {
        command.args(["-attr", "kMDItemLastUsedDate"]);
    }
    let mut child = command.arg(text).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut found: Vec<(PathBuf, String)> = Vec::new();
    let mut out = BufReader::new(child.stdout.take()?);
    let mut record = Vec::new();
    while found.len() < MAX * 2 && !cancel.load(Ordering::Relaxed) && out.read_until(0, &mut record).ok()? > 0 {
        let (path, used) = found_item(&String::from_utf8_lossy(record.strip_suffix(&[0]).unwrap_or(&record)));
        record.clear();
        if worth_showing(&path, scope) {
            found.push((path, used));
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    if query.recent {
        // The dates are written "2026-10-30 10:06:45 +0000", so they sort as text.
        found.sort_by(|a, b| b.1.cmp(&a.1));
        found.truncate(300);
    }
    found.truncate(MAX);
    (!found.is_empty()).then(|| found.into_iter().map(|(p, _)| p).collect())
}

/// One item of `mdfind -0`: its path, and the date it was last used when that was asked for (`-attr`), as
/// "2026-10-30 10:06:45 +0000", which sorts as text.
fn found_item(record: &str) -> (PathBuf, String) {
    match record.rsplit_once("   kMDItemLastUsedDate = ") {
        Some((path, used)) => (PathBuf::from(path), used.trim().to_owned()),
        None => (PathBuf::from(record), String::new()),
    }
}

/// The items under `scope` whose name answers the query, walked folder by folder, for a place Spotlight does not
/// index. A package (an app) is an item, never walked into.
fn walk(query: &Query, scope: &Path, cancel: &AtomicBool) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![scope.to_path_buf()];
    let mut seen = 0;
    while let Some(dir) = stack.pop() {
        let Ok(items) = fs::read_dir(&dir) else { continue };
        for item in items.flatten() {
            seen += 1;
            if seen > WALK_MAX || found.len() >= MAX || (seen % 256 == 0 && cancel.load(Ordering::Relaxed)) {
                return found;
            }
            let name = item.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let Ok(meta) = item.file_type() else { continue };
            let package = meta.is_dir() && Path::new(&name).extension().is_some_and(|e| matches!(e.to_string_lossy().to_lowercase().as_str(), "app" | "bundle" | "framework" | "photoslibrary" | "pages" | "numbers" | "key"));
            if query.takes(&name, meta.is_dir() && !package) {
                found.push(item.path());
            }
            if meta.is_dir() && !package && !meta.is_symlink() {
                stack.push(item.path());
            }
        }
    }
    found
}

/// The items as entries of the list, each with its own URI; two of one name are told apart by their folder, as the
/// shelf does it.
fn entries(paths: Vec<PathBuf>) -> Vec<Entry> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
        let Ok(meta) = fs::symlink_metadata(&path) else { continue };
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let parent = Uri::file(path.parent().unwrap_or(Path::new("/")));
        let mut entry = local::entry(&parent, &name, &path, &meta);
        let count = seen.entry(fold(&name)).or_insert(0);
        *count += 1;
        if *count > 1 {
            entry.name = format!("{name} ({})", parent.name());
        }
        entry.hidden = false;
        out.push(entry);
    }
    out
}

/// What a search is called in its tab.
fn title(query: &Query) -> String {
    if query.recent {
        return tr("Gần đây", "Recents").into();
    }
    if query.text.is_empty() && !query.tag.is_empty() {
        return query.tag.clone();
    }
    format!("{} \"{}\"", tr("Tìm", "Search"), query.text)
}

pub struct SearchProvider;

impl Provider for SearchProvider {
    fn capabilities(&self, _: &Uri) -> Capabilities {
        // The items are files of this Mac: they can be renamed and put in the Trash; nothing is made in a search.
        Capabilities { write: false, rename: true, trash: true, watch: false, sizes: false, local_path: false }
    }

    fn list(&self, uri: &Uri, cancel: &AtomicBool) -> Result<Vec<Entry>, String> {
        let query = Query::parse(&uri.authority);
        let scope = PathBuf::from(&uri.path);
        if !scope.is_dir() {
            return Err(format!("{}: {}", tr("Không có thư mục để tìm", "There is no folder to search"), scope.display()));
        }
        // Names under the home folder: the quick index, the best match first, then the kind, the date and the size.
        if index::answers(&query, &scope)
            && let Some(hits) = index::search(&query.text, Some(&scope), MAX)
        {
            let paths = hits.into_iter().map(|h| PathBuf::from(h.path));
            let named = paths.filter(|p| p.file_name().is_some_and(|n| query.kind_of_name(&n.to_string_lossy(), p.is_dir())));
            return Ok(entries(named.collect()).into_iter().filter(|e| query.fits(e)).collect());
        }
        let paths = match spotlight(&query, &scope, cancel) {
            Some(paths) => paths,
            // Spotlight found nothing: the place may not be indexed, so its names are looked through by hand. The whole
            // Mac is not walked, nor a search without words.
            None if !query.text.trim().is_empty() && scope != Path::new("/") && !query.recent => walk(&query, &scope, cancel),
            None => Vec::new(),
        };
        Ok(entries(paths))
    }

    fn stat(&self, uri: &Uri) -> Result<Entry, String> {
        let query = Query::parse(&uri.authority);
        Ok(Entry { name: title(&query), uri: uri.to_string(), kind: "dir", is_dir: true, size: 0, mtime: 0, ctime: 0, hidden: false, ext: String::new(), icon: "type:public.folder".into() })
    }

    fn read(&self, _: &Uri) -> Result<Box<dyn Read + Send>, String> {
        Err(tr("Hãy mở mục trong kết quả tìm", "Open an item of the results").into())
    }
    fn write(&self, _: &Uri) -> Result<Box<dyn Commit>, String> {
        Err(tr("Không tạo được mục trong kết quả tìm", "Nothing can be made in search results").into())
    }
    fn mkdir(&self, _: &Uri) -> Result<(), String> {
        Err(tr("Không tạo được thư mục trong kết quả tìm", "No folder can be made in search results").into())
    }
    fn rename(&self, _: &Uri, _: &Uri) -> Result<(), String> {
        Err(tr("Hãy đổi tên từng mục", "Rename the items themselves").into())
    }
    fn delete(&self, _: &Uri, _: &AtomicBool) -> Result<(), String> {
        Err(tr("Hãy xóa từng mục", "Delete the items themselves").into())
    }
}

pub fn register(_: &mut Dispatcher) {
    registry().add("search", Arc::new(SearchProvider));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;

    #[test]
    fn a_query_reads_its_parts_and_values_with_an_ampersand_in_them() {
        let query = Query::parse("q=a%26b%20c&kind=pdf&date=week&size=1m&content=1&tag=Red&other=x");
        assert_eq!(query, Query { text: "a&b c".into(), kind: "pdf".into(), date: "week".into(), size: "1m".into(), content: true, tag: "Red".into(), recent: false });
        assert!(Query::parse("recent=1").recent);
        assert_eq!(Query::parse(""), Query::default());
    }

    #[test]
    fn the_spotlight_query_asks_for_every_word_and_filter_and_never_for_everything() {
        let q = Query { text: "báo \"cáo\"".into(), kind: "image".into(), date: "today".into(), size: "100m".into(), ..Default::default() };
        assert_eq!(
            q.spotlight().unwrap(),
            "kMDItemFSName == \"*báo*\"cd && kMDItemFSName == \"*\\\"cáo\\\"*\"cd && (kMDItemContentTypeTree == \"public.image\") && kMDItemFSContentChangeDate >= $time.today && kMDItemFSSize >= 100000000"
        );
        let content = Query { text: "plan".into(), content: true, ..Default::default() };
        assert!(content.spotlight().unwrap().contains("kMDItemTextContent == \"plan*\"cdw"));
        assert_eq!(Query { kind: "pdf".into(), ..Default::default() }.spotlight(), None, "a filter alone would list every file");
        assert_eq!(Query { tag: "Red".into(), ..Default::default() }.spotlight().unwrap(), "(kMDItemUserTags == \"Red\"cd || kMDItemFSLabel == 6)");
        assert_eq!(Query { tag: "Work".into(), ..Default::default() }.spotlight().unwrap(), "kMDItemUserTags == \"Work\"cd");
        assert!(Query { recent: true, ..Default::default() }.spotlight().unwrap().starts_with("kMDItemLastUsedDate >= $time.today(-30)"));
    }

    #[test]
    fn a_folder_spotlight_skips_is_walked_by_name() {
        let t = Temp::new("search-walk");
        t.file("Báo cáo/q3.txt", "");
        t.file("Báo cáo/bao cao.pdf", "");
        t.file("other/BÁO CÁO cuối.txt", "");
        t.file(".hidden/báo cáo.txt", "");
        t.file("App.app/Contents/báo cáo", "");
        let query = Query { text: "báo cáo".into(), ..Default::default() };
        let mut names: Vec<String> = walk(&query, &t.0, &AtomicBool::new(false)).iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        names.sort();
        assert_eq!(names, ["BÁO CÁO cuối.txt", "Báo cáo"], "case aside, no hidden folder, nothing inside an app");
        let folders = Query { text: "báo".into(), kind: "folder".into(), ..Default::default() };
        assert_eq!(walk(&folders, &t.0, &AtomicBool::new(false)).len(), 1);
    }

    #[test]
    fn found_items_keep_their_uris_and_two_of_one_name_are_told_apart() {
        let t = Temp::new("search-entries");
        let a = t.file("one/a.txt", "a");
        let b = t.file("two/a.txt", "b");
        let found = entries(vec![a.clone(), b, t.0.join("gone.txt")]);
        assert_eq!(found.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["a.txt", "a.txt (two)"]);
        assert_eq!(found[0].uri, Uri::file(&a).to_string());
    }

    #[test]
    fn an_item_of_mdfind_has_its_path_and_the_date_it_was_used() {
        assert_eq!(found_item("/Users/me/a b.pdf   kMDItemLastUsedDate = 2026-10-30 10:06:45 +0000"), (PathBuf::from("/Users/me/a b.pdf"), "2026-10-30 10:06:45 +0000".into()));
        assert_eq!(found_item("/Users/me/plain.txt"), (PathBuf::from("/Users/me/plain.txt"), String::new()));
    }

    #[test]
    fn the_system_and_hidden_places_are_left_out_unless_searched_in() {
        let home = dirs::home_dir().unwrap();
        assert!(worth_showing(&home.join("Documents/a.txt"), Path::new("/")));
        assert!(!worth_showing(&home.join("Library/Caches/a.txt"), Path::new("/")));
        assert!(worth_showing(&home.join("Library/Caches/a.txt"), &home.join("Library")));
        assert!(!worth_showing(Path::new("/System/Library/x"), Path::new("/")));
        assert!(!worth_showing(&home.join("p/.git/config"), &home.join("p")));
    }
}
