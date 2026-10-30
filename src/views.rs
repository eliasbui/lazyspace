//! The listing of each tab, kept in Rust: the page draws only the rows it shows and asks for them by range, so a
//! folder of a hundred thousand items never crosses the bridge at once. A listing has a generation; the page drops
//! rows of an older one.

use crate::{
    settings::Sort,
    tr,
    vfs::{Capabilities, Entry, Uri},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{cmp::Ordering, collections::HashMap};
use tao::window::WindowId;

/// The most rows one `view.rows` gives.
pub const MAX_ROWS: usize = 500;

pub struct View {
    pub window: WindowId,
    pub uri: Uri,
    pub sort: Sort,
    pub show_hidden: bool,
    pub capabilities: Capabilities,
    pub generation: u64,
    /// The listing asked for last; a listing that comes back for an older one is dropped.
    pub request: u64,
    pub loading: bool,
    /// Every item, sorted.
    entries: Vec<Entry>,
    /// What the page shows: the indices of `entries` left after the hidden items and the filter.
    shown: Vec<usize>,
    filter: String,
    /// The sizes of folders worked out so far, by name.
    pub sizes: HashMap<String, u64>,
}

/// Which items an action is for: some by name, or all but some.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum Selection {
    Names { names: Vec<String> },
    All { all: bool, #[serde(default)] except: Vec<String> },
}

#[derive(Default)]
pub struct Views {
    by_id: HashMap<String, View>,
    next: u64,
}

impl Views {
    /// A tab of `window` starts listing `uri`; the listing arrives with `finish`. Returns the number of the request.
    pub fn begin(&mut self, window: WindowId, id: &str, uri: Uri, sort: Sort, show_hidden: bool, capabilities: Capabilities) -> u64 {
        self.next += 1;
        let request = self.next;
        let view = self.by_id.entry(id.into()).or_insert_with(|| View {
            window,
            uri: uri.clone(),
            sort: sort.clone(),
            show_hidden,
            capabilities,
            generation: 0,
            request,
            loading: true,
            entries: Vec::new(),
            shown: Vec::new(),
            filter: String::new(),
            sizes: HashMap::new(),
        });
        if view.uri != uri {
            view.filter.clear();
            view.sizes.clear();
        }
        view.window = window;
        view.uri = uri;
        view.sort = sort;
        view.show_hidden = show_hidden;
        view.capabilities = capabilities;
        view.request = request;
        view.loading = true;
        request
    }

    /// The listing of request `request` came: it is sorted and shown, unless the tab has asked for another since.
    /// Returns the view's id and new generation when it was taken.
    pub fn finish(&mut self, id: &str, request: u64, entries: Vec<Entry>, kind: &dyn Fn(&Entry) -> String) -> Option<u64> {
        let generation = self.bump();
        let view = self.by_id.get_mut(id).filter(|v| v.request == request)?;
        view.entries = entries;
        view.loading = false;
        view.generation = generation;
        sort_entries(&mut view.entries, &view.sort, &view.sizes, kind);
        view.reshow();
        Some(generation)
    }

    fn bump(&mut self) -> u64 {
        self.next += 1;
        self.next
    }

    pub fn get(&self, id: &str, window: WindowId) -> Result<&View, String> {
        self.by_id.get(id).filter(|v| v.window == window).ok_or_else(|| tr("Tab này không còn", "That tab is gone").to_owned())
    }

    fn get_mut(&mut self, id: &str, window: WindowId) -> Result<&mut View, String> {
        self.by_id.get_mut(id).filter(|v| v.window == window).ok_or_else(|| tr("Tab này không còn", "That tab is gone").to_owned())
    }

    /// Rows `start..start + count` of what the view shows, as of `generation`.
    pub fn rows(&self, id: &str, window: WindowId, start: usize, count: usize, generation: u64, kind: &dyn Fn(&Entry) -> String) -> Result<Value, String> {
        let view = self.get(id, window)?;
        if generation != view.generation {
            return Err("stale".into());
        }
        let end = start.saturating_add(count.min(MAX_ROWS)).min(view.shown.len());
        let rows: Vec<Value> = view.shown.get(start.min(end)..end).unwrap_or_default().iter().map(|&i| view.row(&view.entries[i], kind)).collect();
        Ok(json!({ "rows": rows, "generation": view.generation, "start": start }))
    }

    pub fn sort(&mut self, id: &str, window: WindowId, sort: Sort, kind: &dyn Fn(&Entry) -> String) -> Result<u64, String> {
        let generation = self.bump();
        let view = self.get_mut(id, window)?;
        view.sort = sort;
        sort_entries(&mut view.entries, &view.sort, &view.sizes, kind);
        view.generation = generation;
        view.reshow();
        Ok(generation)
    }

    /// Shows only the items whose name holds `text`, ignoring case.
    pub fn filter(&mut self, id: &str, window: WindowId, text: &str) -> Result<(u64, usize), String> {
        let generation = self.bump();
        let view = self.get_mut(id, window)?;
        view.filter = text.to_lowercase();
        view.generation = generation;
        view.reshow();
        Ok((generation, view.shown.len()))
    }

    pub fn set_hidden(&mut self, id: &str, window: WindowId, show: bool) -> Result<(u64, usize), String> {
        let generation = self.bump();
        let view = self.get_mut(id, window)?;
        view.show_hidden = show;
        view.generation = generation;
        view.reshow();
        Ok((generation, view.shown.len()))
    }

    /// Where the first item whose name starts with `prefix` is, as typing a name in a list finds it.
    pub fn find(&self, id: &str, window: WindowId, prefix: &str) -> Result<Option<usize>, String> {
        let view = self.get(id, window)?;
        let prefix = prefix.to_lowercase();
        Ok(view.shown.iter().position(|&i| view.entries[i].key().starts_with(&prefix)))
    }

    pub fn index_of(&self, id: &str, window: WindowId, name: &str) -> Result<Option<usize>, String> {
        let view = self.get(id, window)?;
        Ok(view.shown.iter().position(|&i| view.entries[i].name == name))
    }

    /// The URIs a selection stands for, in the order shown.
    pub fn resolve(&self, id: &str, window: WindowId, selection: &Selection) -> Result<Vec<Uri>, String> {
        let view = self.get(id, window)?;
        let pick = |e: &Entry| match selection {
            Selection::Names { names } => names.iter().any(|n| *n == e.name),
            Selection::All { all, except } => *all && !except.iter().any(|n| *n == e.name),
        };
        view.shown.iter().map(|&i| &view.entries[i]).filter(|e| pick(e)).map(|e| Uri::parse(&e.uri)).collect()
    }

    /// The entries a view shows, for the work that needs them all (folder sizes).
    pub fn entries(&self, id: &str) -> Option<&[Entry]> {
        self.by_id.get(id).map(|v| v.entries.as_slice())
    }

    pub fn close(&mut self, id: &str, window: WindowId) {
        if self.by_id.get(id).is_some_and(|v| v.window == window) {
            self.by_id.remove(id);
        }
    }

    /// Every tab of a window goes with it.
    pub fn close_window(&mut self, window: WindowId) {
        self.by_id.retain(|_, v| v.window != window);
    }

    /// The tabs that show `uri`, to list again when it changes.
    pub fn showing(&self, uri: &Uri) -> Vec<String> {
        self.by_id.iter().filter(|(_, v)| v.uri == *uri).map(|(id, _)| id.clone()).collect()
    }

    /// The folders open in any tab, which the watcher follows.
    pub fn open_folders(&self) -> Vec<Uri> {
        let mut uris: Vec<Uri> = self.by_id.values().map(|v| v.uri.clone()).collect();
        uris.sort_by(|a, b| a.path.cmp(&b.path));
        uris.dedup();
        uris
    }

    /// The size of a folder came: kept for its row, and the listing is sorted again when it is sorted by size.
    pub fn set_size(&mut self, id: &str, name: &str, bytes: u64) {
        if let Some(view) = self.by_id.get_mut(id) {
            view.sizes.insert(name.into(), bytes);
        }
    }

    pub fn by_id(&self) -> impl Iterator<Item = (&String, &View)> {
        self.by_id.iter()
    }
}

impl View {
    pub fn count(&self) -> usize {
        self.shown.len()
    }

    fn reshow(&mut self) {
        let filter = &self.filter;
        let show_hidden = self.show_hidden;
        self.shown = self
            .entries
            .iter()
            .enumerate()
            .filter(|(_, e)| (show_hidden || !e.hidden) && (filter.is_empty() || e.key().contains(filter.as_str())))
            .map(|(i, _)| i)
            .collect();
    }

    fn row(&self, entry: &Entry, kind: &dyn Fn(&Entry) -> String) -> Value {
        let mut row = serde_json::to_value(entry).unwrap_or(Value::Null);
        row["type"] = json!(kind(entry));
        if let Some(size) = self.sizes.get(&entry.name) {
            row["dirSize"] = json!(size);
        }
        row
    }
}

/// Sorts as Finder does: folders first when asked, then by the chosen column, ties by name; names compare with
/// numbers in them as numbers ("2" before "10") and without regard to case.
pub fn sort_entries(entries: &mut [Entry], sort: &Sort, sizes: &HashMap<String, u64>, kind: &dyn Fn(&Entry) -> String) {
    let size_of = |e: &Entry| if e.is_dir || e.kind == "app" || e.kind == "package" { sizes.get(&e.name).copied().unwrap_or(0) } else { e.size };
    let kinds: HashMap<String, String> = if sort.by == "kind" { entries.iter().map(|e| (e.name.clone(), kind(e))).collect() } else { HashMap::new() };
    entries.sort_by(|a, b| {
        if sort.folders_first && a.is_dir != b.is_dir {
            return b.is_dir.cmp(&a.is_dir);
        }
        let by = match sort.by.as_str() {
            "size" => size_of(a).cmp(&size_of(b)),
            "mtime" => a.mtime.cmp(&b.mtime),
            "ctime" => a.ctime.cmp(&b.ctime),
            "kind" => natural(&kinds[&a.name], &kinds[&b.name]),
            "ext" => a.ext.cmp(&b.ext),
            _ => Ordering::Equal,
        };
        let by = if sort.desc { by.reverse() } else { by };
        by.then_with(|| {
            let names = natural(&a.name, &b.name);
            if sort.desc && sort.by == "name" { names.reverse() } else { names }
        })
    });
}

/// Compares names as Finder does: case aside, and runs of digits by their value.
pub fn natural(a: &str, b: &str) -> Ordering {
    let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut digits = String::new();
                    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
                        digits.push(c);
                        it.next();
                    }
                    digits
                };
                let (da, db) = (take(&mut a), take(&mut b));
                let (ta, tb) = (da.trim_start_matches('0'), db.trim_start_matches('0'));
                let order = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb)).then_with(|| da.len().cmp(&db.len()));
                if order != Ordering::Equal {
                    return order;
                }
            }
            (Some(x), Some(y)) => {
                let order = x.to_lowercase().cmp(y.to_lowercase());
                if order != Ordering::Equal {
                    return order;
                }
                a.next();
                b.next();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window() -> WindowId {
        // SAFETY: the id is only compared, never used to reach a window.
        unsafe { WindowId::dummy() }
    }

    fn entry(name: &str, is_dir: bool, size: u64, mtime: i64) -> Entry {
        Entry {
            name: name.into(),
            uri: format!("file:///x/{name}"),
            kind: if is_dir { "dir" } else { "file" },
            is_dir,
            size,
            mtime,
            ctime: 0,
            hidden: name.starts_with('.'),
            ext: name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default(),
            icon: String::new(),
        }
    }

    fn kind(e: &Entry) -> String {
        if e.is_dir { "Folder".into() } else { format!("{} file", e.ext) }
    }

    fn caps() -> Capabilities {
        Capabilities { write: true, rename: true, trash: true, watch: true, sizes: true, local_path: true }
    }

    fn names(views: &Views, id: &str) -> Vec<String> {
        let generation = views.get(id, window()).unwrap().generation;
        views.rows(id, window(), 0, 100, generation, &kind).unwrap()["rows"].as_array().unwrap().iter().map(|r| r["name"].as_str().unwrap().to_owned()).collect()
    }

    fn listed(sort: Sort) -> Views {
        let mut views = Views::default();
        let request = views.begin(window(), "p0t0", Uri::parse("file:///x").unwrap(), sort, false, caps());
        let entries = vec![entry("b10.txt", false, 5, 3), entry("B2.txt", false, 50, 1), entry("Zed", true, 0, 2), entry(".hidden", false, 1, 9), entry("a.md", false, 7, 4)];
        views.finish("p0t0", request, entries, &kind).unwrap();
        views
    }

    #[test]
    fn names_sort_with_numbers_as_numbers_and_folders_first() {
        let views = listed(Sort::default());
        assert_eq!(names(&views, "p0t0"), ["Zed", "a.md", "B2.txt", "b10.txt"]);
        assert_eq!(natural("file2", "file10"), Ordering::Less);
        assert_eq!(natural("File", "file"), Ordering::Equal);
        assert_eq!(natural("a01", "a1"), Ordering::Greater);
    }

    #[test]
    fn other_columns_and_descending() {
        let mut views = listed(Sort::default());
        let sort = |by: &str, desc: bool| Sort { by: by.into(), desc, folders_first: false };
        views.sort("p0t0", window(), sort("size", true), &kind).unwrap();
        assert_eq!(names(&views, "p0t0"), ["B2.txt", "a.md", "b10.txt", "Zed"]);
        views.sort("p0t0", window(), sort("mtime", false), &kind).unwrap();
        assert_eq!(names(&views, "p0t0"), ["B2.txt", "Zed", "b10.txt", "a.md"]);
        views.sort("p0t0", window(), sort("name", true), &kind).unwrap();
        assert_eq!(names(&views, "p0t0"), ["Zed", "b10.txt", "B2.txt", "a.md"]);
        views.sort("p0t0", window(), sort("kind", false), &kind).unwrap();
        assert_eq!(names(&views, "p0t0"), ["Zed", "a.md", "B2.txt", "b10.txt"]);
    }

    #[test]
    fn rows_window_is_clamped_and_generation_is_checked() {
        let views = listed(Sort::default());
        let generation = views.get("p0t0", window()).unwrap().generation;
        let rows = views.rows("p0t0", window(), 2, 10, generation, &kind).unwrap();
        assert_eq!(rows["rows"].as_array().unwrap().len(), 2);
        assert_eq!(rows["rows"][0]["type"], "txt file");
        assert_eq!(views.rows("p0t0", window(), 99, 10, generation, &kind).unwrap()["rows"].as_array().unwrap().len(), 0);
        assert_eq!(views.rows("p0t0", window(), 0, 10, generation + 1, &kind).unwrap_err(), "stale");
        assert!(views.rows("nope", window(), 0, 10, generation, &kind).is_err());
    }

    #[test]
    fn filter_and_find_prefix() {
        let mut views = listed(Sort::default());
        assert_eq!(views.filter("p0t0", window(), "B").unwrap().1, 2);
        assert_eq!(names(&views, "p0t0"), ["B2.txt", "b10.txt"]);
        views.filter("p0t0", window(), "").unwrap();
        assert_eq!(views.find("p0t0", window(), "b").unwrap(), Some(2));
        assert_eq!(views.find("p0t0", window(), "q").unwrap(), None);
        assert_eq!(views.index_of("p0t0", window(), "a.md").unwrap(), Some(1));
        assert_eq!(views.set_hidden("p0t0", window(), true).unwrap().1, 5);
    }

    #[test]
    fn an_older_listing_is_dropped_and_selections_resolve() {
        let mut views = listed(Sort::default());
        let old = views.begin(window(), "p0t0", Uri::parse("file:///y").unwrap(), Sort::default(), false, caps());
        let new = views.begin(window(), "p0t0", Uri::parse("file:///z").unwrap(), Sort::default(), false, caps());
        assert_eq!(views.finish("p0t0", old, vec![entry("old", false, 0, 0)], &kind), None);
        assert!(views.finish("p0t0", new, vec![entry("n1", false, 0, 0), entry("n2", false, 0, 0)], &kind).is_some());
        let some = views.resolve("p0t0", window(), &Selection::Names { names: vec!["n2".into()] }).unwrap();
        assert_eq!(some.len(), 1);
        let all: Selection = serde_json::from_value(json!({ "all": true, "except": ["n1"] })).unwrap();
        assert_eq!(views.resolve("p0t0", window(), &all).unwrap()[0].name(), "n2");
        assert_eq!(views.showing(&Uri::parse("file:///z").unwrap()), ["p0t0"]);
    }
}
