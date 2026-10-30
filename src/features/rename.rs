//! Advanced batch rename (W5): rules applied in order to each name (replace, with or without a regular expression;
//! insert; remove; number; the name of the folder; case; extension), a preview that marks names that would collide,
//! and a rename in two phases that never loses a file and comes back with Cmd+Z.

use crate::{
    App, browse,
    browse::Undo,
    ipc::{Dispatcher, args},
    tr,
    vfs::{self, Uri, registry},
};
use regex::{Regex, RegexBuilder};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::HashMap, path::PathBuf};

/// The most rows a preview gives; the rename itself takes them all.
const PREVIEW_MAX: usize = 1000;

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum At {
    Start,
    #[default]
    End,
    Index,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    #[default]
    Name,
    Ext,
    All,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CaseMode {
    Lower,
    Upper,
    Title,
    Sentence,
}

fn one() -> i64 {
    1
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Rule {
    Replace {
        find: String,
        #[serde(default)]
        with: String,
        #[serde(default)]
        regex: bool,
        #[serde(default, rename = "caseInsensitive")]
        case_insensitive: bool,
        #[serde(default)]
        scope: Scope,
    },
    Insert {
        text: String,
        #[serde(default)]
        at: At,
        #[serde(default)]
        index: usize,
    },
    Remove {
        #[serde(default)]
        from: usize,
        count: usize,
        #[serde(default, rename = "fromEnd")]
        from_end: bool,
    },
    Number {
        #[serde(default = "one")]
        start: i64,
        #[serde(default = "one")]
        step: i64,
        #[serde(default)]
        pad: usize,
        #[serde(default)]
        at: At,
        #[serde(default)]
        index: usize,
        #[serde(default)]
        sep: String,
    },
    Parent {
        #[serde(default)]
        at: At,
        #[serde(default)]
        sep: String,
    },
    Case {
        mode: CaseMode,
    },
    Ext {
        #[serde(default)]
        set: Option<String>,
        #[serde(default)]
        case: Option<CaseMode>,
    },
}

/// The rules with their regular expressions compiled once for a whole batch.
pub struct Compiled {
    rules: Vec<Rule>,
    patterns: HashMap<usize, Regex>,
}

pub fn compile(rules: Vec<Rule>) -> Result<Compiled, String> {
    let mut patterns = HashMap::new();
    for (i, rule) in rules.iter().enumerate() {
        if let Rule::Replace { find, regex, case_insensitive, .. } = rule {
            let source = if *regex { find.clone() } else { regex::escape(find) };
            if find.is_empty() {
                continue;
            }
            let pattern = RegexBuilder::new(&source)
                .case_insensitive(*case_insensitive)
                .size_limit(1 << 20)
                .build()
                .map_err(|e| format!("{}: {e}", tr("Biểu thức chính quy không hợp lệ", "The regular expression is not valid")))?;
            patterns.insert(i, pattern);
        }
    }
    Ok(Compiled { rules, patterns })
}

/// `text` with `piece` put at the start, the end or the character index `index`.
fn put(text: &str, piece: &str, at: At, index: usize) -> String {
    match at {
        At::Start => format!("{piece}{text}"),
        At::End => format!("{text}{piece}"),
        At::Index => {
            let cut = text.char_indices().nth(index).map_or(text.len(), |(i, _)| i);
            format!("{}{piece}{}", &text[..cut], &text[cut..])
        }
    }
}

fn case(text: &str, mode: CaseMode) -> String {
    match mode {
        CaseMode::Lower => text.to_lowercase(),
        CaseMode::Upper => text.to_uppercase(),
        CaseMode::Title => {
            let mut out = String::with_capacity(text.len());
            let mut start = true;
            for c in text.chars() {
                if start { out.extend(c.to_uppercase()) } else { out.extend(c.to_lowercase()) }
                start = c.is_whitespace() || c == '-' || c == '_' || c == '.';
            }
            out
        }
        CaseMode::Sentence => {
            let lower = text.to_lowercase();
            let mut chars = lower.chars();
            chars.next().map(|c| c.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default()
        }
    }
}

/// The new name of `name` (a folder's name has no extension), the `ordinal`th item of the batch, in the folder named
/// `parent`.
// shortcut: positions count Unicode scalars, so a letter written with a combining mark (as macOS stores names) counts
// as two; counting grapheme clusters needs a crate, worth it if users ask.
pub fn new_name(compiled: &Compiled, name: &str, is_dir: bool, ordinal: usize, parent: &str) -> String {
    let (mut stem, mut ext) = match name.rfind('.') {
        Some(dot) if !is_dir && dot > 0 => (name[..dot].to_owned(), name[dot + 1..].to_owned()),
        _ => (name.to_owned(), String::new()),
    };
    for (i, rule) in compiled.rules.iter().enumerate() {
        match rule {
            Rule::Replace { with, scope, .. } => {
                let Some(pattern) = compiled.patterns.get(&i) else { continue };
                match scope {
                    Scope::Name => stem = pattern.replace_all(&stem, with.as_str()).into_owned(),
                    Scope::Ext => ext = pattern.replace_all(&ext, with.as_str()).into_owned(),
                    Scope::All => {
                        let whole = if ext.is_empty() { stem.clone() } else { format!("{stem}.{ext}") };
                        let replaced = pattern.replace_all(&whole, with.as_str()).into_owned();
                        (stem, ext) = match replaced.rfind('.') {
                            Some(dot) if !is_dir && dot > 0 => (replaced[..dot].to_owned(), replaced[dot + 1..].to_owned()),
                            _ => (replaced, String::new()),
                        };
                    }
                }
            }
            Rule::Insert { text, at, index } => stem = put(&stem, text, *at, *index),
            Rule::Remove { from, count, from_end } => {
                let chars: Vec<char> = stem.chars().collect();
                let len = chars.len();
                let start = if *from_end { len.saturating_sub(from + count) } else { (*from).min(len) };
                let end = (start + count).min(len);
                stem = chars[..start].iter().chain(&chars[end..]).collect();
            }
            Rule::Number { start, step, pad, at, index, sep } => {
                let n = start + step * ordinal as i64;
                let digits = if n < 0 { format!("-{:0pad$}", -n, pad = *pad) } else { format!("{n:0pad$}", pad = *pad) };
                let piece = match at {
                    At::Start => format!("{digits}{sep}"),
                    _ => format!("{sep}{digits}"),
                };
                stem = put(&stem, &piece, *at, *index);
            }
            Rule::Parent { at, sep } => {
                let piece = match at {
                    At::Start => format!("{parent}{sep}"),
                    _ => format!("{sep}{parent}"),
                };
                stem = put(&stem, &piece, *at, 0);
            }
            Rule::Case { mode } => stem = case(&stem, *mode),
            Rule::Ext { set, case: ext_case } => {
                if let Some(set) = set {
                    ext = set.trim_start_matches('.').to_owned();
                }
                if let Some(mode) = ext_case {
                    ext = case(&ext, *mode);
                }
            }
        }
    }
    if ext.is_empty() { stem } else { format!("{stem}.{ext}") }
}

/// One line of the preview.
#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    pub from: Uri,
    pub to: String,
    pub problem: Option<String>,
}

/// The new names of `items` (their URIs, folder flags and the names already in their folders), with what is wrong
/// with each: an empty or impossible name, two items given one name, or a name an item outside the batch has.
pub fn plan(compiled: &Compiled, items: &[(Uri, bool)], existing: &HashMap<Uri, Vec<String>>) -> Vec<Row> {
    let mut rows: Vec<Row> = items
        .iter()
        .enumerate()
        .map(|(i, (uri, is_dir))| {
            let parent = uri.parent().map(|p| p.name()).unwrap_or_default();
            let to = new_name(compiled, &uri.name(), *is_dir, i, &parent);
            let problem = vfs::valid_name(&to).err();
            Row { from: uri.clone(), to, problem }
        })
        .collect();
    // Names compare without regard to case, as the Mac's disks do by default.
    let mut taken: HashMap<(Uri, String), usize> = HashMap::new();
    for row in &rows {
        let folder = row.from.parent().unwrap_or_else(|| row.from.clone());
        *taken.entry((folder, row.to.to_lowercase())).or_insert(0) += 1;
    }
    let renamed: Vec<String> = items.iter().map(|(u, _)| u.name().to_lowercase()).collect();
    for row in &mut rows {
        if row.problem.is_some() {
            continue;
        }
        let folder = row.from.parent().unwrap_or_else(|| row.from.clone());
        let key = row.to.to_lowercase();
        if taken.get(&(folder.clone(), key.clone())).copied().unwrap_or(0) > 1 {
            row.problem = Some(tr("Trùng tên với mục khác trong lượt này", "Another item of this batch gets the same name").into());
        } else if row.from.name().to_lowercase() != key
            && existing.get(&folder).is_some_and(|names| names.iter().any(|n| n.to_lowercase() == key && !renamed.contains(&n.to_lowercase())))
        {
            row.problem = Some(tr("Đã có một mục mang tên này", "An item with this name is already there").into());
        }
    }
    rows
}

/// The items of a batch with whether each is a folder, and the names in their folders.
fn gather(uris: &[Uri]) -> Result<(Vec<(Uri, bool)>, HashMap<Uri, Vec<String>>), String> {
    let mut items = Vec::new();
    let mut existing: HashMap<Uri, Vec<String>> = HashMap::new();
    for uri in uris {
        let provider = registry().get(uri)?;
        let entry = provider.stat(uri)?;
        // A package (an app) keeps its extension, as Finder renames it; a folder has none.
        items.push((uri.clone(), entry.kind == "dir" || (entry.kind == "link" && entry.is_dir)));
        if let Some(folder) = uri.parent() {
            if !existing.contains_key(&folder) {
                let names = provider.list(&folder, &std::sync::atomic::AtomicBool::new(false))?.into_iter().map(|e| e.name).collect();
                existing.insert(folder, names);
            }
        }
    }
    Ok((items, existing))
}

#[derive(Deserialize)]
struct Batch {
    rules: Vec<Rule>,
}

pub fn register(d: &mut Dispatcher) {
    d.on("rename.preview", |app: &mut App, window, a| {
        let uris = browse::targets(app, window, &a)?;
        let compiled = compile(args::<Batch>(a)?.rules)?;
        let (items, existing) = gather(&uris)?;
        let rows = plan(&compiled, &items, &existing);
        let problems = rows.iter().filter(|r| r.problem.is_some()).count();
        let changed = rows.iter().filter(|r| r.to != r.from.name()).count();
        let shown: Vec<Value> = rows.iter().take(PREVIEW_MAX).map(|r| json!({ "from": r.from.name(), "to": r.to, "problem": r.problem })).collect();
        Ok(json!({ "rows": shown, "total": rows.len(), "problems": problems, "changed": changed }))
    });
    d.on("rename.apply", |app: &mut App, window, a| {
        let uris = browse::targets(app, window, &a)?;
        let compiled = compile(args::<Batch>(a)?.rules)?;
        let (items, existing) = gather(&uris)?;
        let rows = plan(&compiled, &items, &existing);
        if let Some(bad) = rows.iter().find(|r| r.problem.is_some()) {
            return Err(format!("\"{}\": {}", bad.to, bad.problem.clone().unwrap_or_default()));
        }
        let pairs: Vec<(PathBuf, PathBuf)> = rows
            .iter()
            .filter(|r| r.to != r.from.name())
            .filter_map(|r| {
                let from = r.from.local_path()?;
                let to = from.with_file_name(&r.to);
                Some((from, to))
            })
            .collect();
        if pairs.is_empty() {
            return Err(tr("Không có tên nào thay đổi", "No name changes").into());
        }
        let count = pairs.len();
        let title = format!("{} {count} {}", tr("Đổi tên", "Rename"), tr("mục", "items"));
        let undo_title = title.clone();
        let done = pairs.clone();
        let then: crate::jobs::Then = Box::new(move |app: &mut App, result: &Result<Value, String>| {
            if result.is_ok() {
                app.browse.push_undo(Undo::Renames { title: undo_title, pairs: done.into_iter().map(|(from, to)| (to, from)).collect() });
            }
        });
        let names: Vec<String> = pairs.iter().filter_map(|(_, to)| to.file_name().map(|n| n.to_string_lossy().into_owned())).collect();
        let to = pairs.first().and_then(|(from, _)| from.parent()).map(|p| Uri::file(p).to_string());
        let job = app.jobs.spawn(
            &app.proxy,
            Some(window),
            "rename",
            title,
            move |ctx| {
                vfs::local::rename_all(&pairs)?;
                ctx.progress(1, 1, "");
                Ok(json!({ "names": names, "to": to }))
            },
            Some(then),
        );
        Ok(json!({ "job": job }))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;
    use serde_json::json;

    fn rules(value: Value) -> Compiled {
        compile(serde_json::from_value(value).unwrap()).unwrap()
    }

    #[test]
    fn rules_compose_in_order() {
        let c = rules(json!([
            { "type": "replace", "find": "IMG_", "with": "" },
            { "type": "insert", "text": "Trip ", "at": "start" },
            { "type": "case", "mode": "upper" },
            { "type": "ext", "case": "lower" }
        ]));
        assert_eq!(new_name(&c, "IMG_0042.JPG", false, 0, "x"), "TRIP 0042.jpg");
        assert_eq!(new_name(&c, "IMG_dir.d", true, 0, "x"), "TRIP DIR.D", "a folder has no extension");
    }

    #[test]
    fn regex_groups_and_invalid_pattern_error() {
        let c = rules(json!([{ "type": "replace", "find": "(\\d+)-(\\d+)", "with": "$2-$1", "regex": true }]));
        assert_eq!(new_name(&c, "page 12-34.pdf", false, 0, ""), "page 34-12.pdf");
        let c = rules(json!([{ "type": "replace", "find": "a.b", "with": "x" }]));
        assert_eq!(new_name(&c, "a.b aXb.txt", false, 0, ""), "x aXb.txt", "without regex, a dot is a dot");
        let c = rules(json!([{ "type": "replace", "find": "photo", "with": "Ảnh", "caseInsensitive": true }]));
        assert_eq!(new_name(&c, "PHOTO 1.png", false, 0, ""), "Ảnh 1.png");
        assert!(compile(serde_json::from_value(json!([{ "type": "replace", "find": "(", "regex": true }])).unwrap()).is_err());
    }

    #[test]
    fn numbering_pads_and_steps_and_the_parent_goes_in() {
        let c = rules(json!([{ "type": "number", "start": 1, "step": 2, "pad": 3, "at": "start", "sep": " - " }, { "type": "parent", "at": "end", "sep": "_" }]));
        assert_eq!(new_name(&c, "beach.jpg", false, 0, "Hawaii"), "001 - beach_Hawaii.jpg");
        assert_eq!(new_name(&c, "beach.jpg", false, 4, "Hawaii"), "009 - beach_Hawaii.jpg");
        let c = rules(json!([{ "type": "remove", "from": 0, "count": 2 }, { "type": "remove", "count": 1, "fromEnd": true }]));
        assert_eq!(new_name(&c, "xxname1.txt", false, 0, ""), "name.txt");
        let c = rules(json!([{ "type": "insert", "text": "-", "at": "index", "index": 4 }, { "type": "case", "mode": "title" }]));
        assert_eq!(new_name(&c, "holiday photos.png", false, 0, ""), "Holi-Day Photos.png");
        assert!(serde_json::from_value::<Vec<Rule>>(json!([{ "type": "explode" }])).is_err());
    }

    #[test]
    fn preview_marks_collisions() {
        let t = Temp::new("rename-plan");
        let a = Uri::file(&t.file("a.txt", ""));
        let b = Uri::file(&t.file("b.txt", ""));
        let existing = HashMap::from([(t.uri(), vec!["a.txt".into(), "b.txt".into(), "taken.txt".into()])]);
        let same = rules(json!([{ "type": "replace", "find": "^.*$", "with": "same", "regex": true }]));
        let rows = plan(&same, &[(a.clone(), false), (b.clone(), false)], &existing);
        assert!(rows.iter().all(|r| r.problem.is_some()), "two items cannot both become same.txt");
        let taken = rules(json!([{ "type": "replace", "find": "a", "with": "taken" }]));
        assert!(plan(&taken, &[(a.clone(), false)], &existing)[0].problem.is_some());
        let swap = rules(json!([{ "type": "replace", "find": "^a$|^b$", "with": "z", "regex": true }]));
        let rows = plan(&swap, &[(a.clone(), false)], &existing);
        assert!(rows[0].problem.is_none() && rows[0].to == "z.txt");
        let empty = rules(json!([{ "type": "remove", "count": 99 }, { "type": "ext", "set": "" }]));
        assert!(plan(&empty, &[(a, false)], &existing)[0].problem.is_some(), "an empty name");
    }

    #[test]
    fn swap_two_names_uses_two_phases_and_undo_restores() {
        let t = Temp::new("rename-swap");
        let (a, b) = (t.file("a.txt", "A"), t.file("b.txt", "B"));
        let pairs = vec![(a.clone(), b.clone()), (b.clone(), a.clone())];
        vfs::local::rename_all(&pairs).unwrap();
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "B");
        let back: Vec<(PathBuf, PathBuf)> = pairs.into_iter().map(|(f, t)| (t, f)).collect();
        vfs::local::rename_all(&back).unwrap();
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "A");
    }
}
