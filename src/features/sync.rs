//! Comparing two folders and syncing them (W3): every item on either side, at any depth, is classified (the same,
//! newer on one side, on one side only, or in conflict) and given the action the mode proposes; the user sees the plan
//! and can change any line before anything happens. Copies replace through a temporary name, so a cut-short sync
//! leaves no half file, and an item removed by a mirror goes to the Trash.

use crate::{
    ipc::{Dispatcher, args},
    jobs::Ctx,
    native::trash,
    tr,
    vfs::{self, Entry, Uri, registry},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    io::Read,
    sync::atomic::AtomicBool,
};

/// Two times this close count as the same: FAT disks keep times to two seconds.
const TOLERANCE: i64 = 2;
/// The most differing items a report lists; the rest are counted.
const REPORT_MAX: usize = 20_000;

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    #[default]
    Ltr,
    Rtl,
    Both,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Options {
    pub mode: Mode,
    /// Compare the bytes of files of equal size, not only their sizes and times.
    pub content: bool,
    pub ignore_hidden: bool,
    /// One way only: remove from the target what the source does not have.
    pub mirror: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum State {
    Same,
    LeftNewer,
    RightNewer,
    LeftOnly,
    RightOnly,
    Conflict,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Skip,
    Ltr,
    Rtl,
    DeleteLeft,
    DeleteRight,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Pair {
    pub rel: String,
    pub left: Option<Side>,
    pub right: Option<Side>,
    pub state: State,
    pub action: Action,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Side {
    pub size: u64,
    pub mtime: i64,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
}

impl From<&Entry> for Side {
    fn from(e: &Entry) -> Side {
        Side { size: e.size, mtime: e.mtime, is_dir: physical_dir(e) }
    }
}

fn physical_dir(e: &Entry) -> bool {
    matches!(e.kind, "dir" | "app" | "package")
}

/// What the mode proposes for an item in `state`.
pub fn propose(state: State, options: &Options) -> Action {
    use State::*;
    match (options.mode, state) {
        (_, Same) => Action::Skip,
        (Mode::Ltr, LeftOnly | LeftNewer | Conflict) => Action::Ltr,
        (Mode::Ltr, RightOnly) if options.mirror => Action::DeleteRight,
        (Mode::Rtl, RightOnly | RightNewer | Conflict) => Action::Rtl,
        (Mode::Rtl, LeftOnly) if options.mirror => Action::DeleteLeft,
        (Mode::Both, LeftOnly | LeftNewer) => Action::Ltr,
        (Mode::Both, RightOnly | RightNewer) => Action::Rtl,
        // Two-way and a conflict: neither side wins without the user.
        _ => Action::Skip,
    }
}

/// The items of a folder by name, without hidden ones when asked.
fn children(uri: &Uri, options: &Options, ctx: &Ctx) -> Result<BTreeMap<String, Entry>, String> {
    let entries = registry().get(uri)?.list(uri, ctx.cancel_flag())?;
    Ok(entries.into_iter().filter(|e| !(options.ignore_hidden && e.hidden)).map(|e| (e.name.clone(), e)).collect())
}

/// Whether two files have the same bytes.
fn same_bytes(a: &Uri, b: &Uri, cancel: &AtomicBool) -> Result<bool, String> {
    let (mut ra, mut rb) = (registry().get(a)?.read(a)?, registry().get(b)?.read(b)?);
    let (mut ba, mut bb) = (vec![0u8; 1 << 20], vec![0u8; 1 << 20]);
    loop {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(tr("Đã hủy", "Cancelled").into());
        }
        let na = read_full(&mut ra, &mut ba).map_err(|e| e.to_string())?;
        let nb = read_full(&mut rb, &mut bb).map_err(|e| e.to_string())?;
        if na != nb || ba[..na] != bb[..nb] {
            return Ok(false);
        }
        if na == 0 {
            return Ok(true);
        }
    }
}

fn read_full(r: &mut dyn Read, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        match r.read(&mut buf[n..])? {
            0 => break,
            k => n += k,
        }
    }
    Ok(n)
}

fn classify(left: &Entry, right: &Entry, luri: &Uri, ruri: &Uri, options: &Options, ctx: &Ctx) -> Result<State, String> {
    let close = (left.mtime - right.mtime).abs() <= TOLERANCE;
    if left.size == right.size && (close || options.content) {
        if options.content && !same_bytes(luri, ruri, ctx.cancel_flag())? {
            return Ok(if close { State::Conflict } else if left.mtime > right.mtime { State::LeftNewer } else { State::RightNewer });
        }
        return Ok(State::Same);
    }
    Ok(if close { State::Conflict } else if left.mtime > right.mtime { State::LeftNewer } else { State::RightNewer })
}

/// Walks both folders and returns the pairs that differ (and the count of those that are the same).
pub fn compare(ctx: &Ctx, left: &Uri, right: &Uri, options: &Options) -> Result<(Vec<Pair>, usize), String> {
    let mut out = Vec::new();
    let mut same = 0usize;
    let mut stack = vec![(left.clone(), right.clone(), String::new())];
    let mut seen = 0u64;
    while let Some((l, r, prefix)) = stack.pop() {
        if ctx.cancelled() {
            return Err(tr("Đã hủy", "Cancelled").into());
        }
        let (lc, rc) = (children(&l, options, ctx)?, children(&r, options, ctx)?);
        let mut names: Vec<&String> = lc.keys().chain(rc.keys()).collect();
        names.sort();
        names.dedup();
        for name in names {
            seen += 1;
            ctx.progress(seen, 0, name);
            let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
            let (le, re) = (lc.get(name), rc.get(name));
            let state = match (le, re) {
                (Some(a), Some(b)) if physical_dir(a) && physical_dir(b) => {
                    stack.push((l.join(name), r.join(name), rel));
                    continue;
                }
                (Some(a), Some(b)) if physical_dir(a) != physical_dir(b) => State::Conflict,
                (Some(a), Some(b)) => classify(a, b, &l.join(name), &r.join(name), options, ctx)?,
                (Some(_), None) => State::LeftOnly,
                (None, Some(_)) => State::RightOnly,
                (None, None) => continue,
            };
            if state == State::Same {
                same += 1;
                continue;
            }
            if out.len() < REPORT_MAX {
                out.push(Pair { rel, left: le.map(Side::from), right: re.map(Side::from), state, action: propose(state, options) });
            }
        }
    }
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok((out, same))
}

/// One line of the plan the user confirmed.
#[derive(Debug, Clone, Deserialize)]
pub struct Step {
    pub rel: String,
    pub action: Action,
}

/// The place `rel` under `root`, refusing a path that leaves it.
fn under(root: &Uri, rel: &str) -> Result<Uri, String> {
    let parts: Vec<&str> = rel.split('/').collect();
    if rel.is_empty() || parts.iter().any(|p| p.is_empty() || *p == "." || *p == "..") {
        return Err(format!("{}: {rel}", tr("Đường dẫn không hợp lệ", "Not a valid path")));
    }
    Ok(parts.iter().fold(root.clone(), |uri, part| uri.join(part)))
}

/// Copies `from` over `to` (a file or a whole folder), writing beside it first and replacing it only once whole.
fn replace(ctx: &Ctx, from: &Uri, to: &Uri) -> Result<(), String> {
    let parent = to.parent().ok_or_else(|| tr("Không có thư mục chứa", "There is no enclosing folder").to_owned())?;
    let dp = registry().get(&parent)?;
    if dp.stat(&parent).is_err() {
        make_dirs(&parent)?;
    }
    let staging = parent.join(&format!(".lazyspace-sync-{}", to.name()));
    let _ = dp.delete(&staging, ctx.cancel_flag());
    let tmp_dir = parent.join(&format!(".lazyspace-sync-in-{}", std::process::id()));
    let _ = dp.delete(&tmp_dir, ctx.cancel_flag());
    dp.mkdir(&tmp_dir)?;
    // A copy into an empty folder of our own never asks a question; its result is then moved into place.
    let done = vfs::copy::transfer(ctx, std::slice::from_ref(from), &tmp_dir, false).and_then(|_| {
        let copied = tmp_dir.join(&from.name());
        if dp.stat(to).is_ok() {
            dp.rename(to, &staging)?;
        }
        match dp.rename(&copied, to) {
            Ok(()) => {
                let _ = dp.delete(&staging, ctx.cancel_flag());
                Ok(())
            }
            Err(e) => {
                let _ = dp.rename(&staging, to);
                Err(e)
            }
        }
    });
    let _ = dp.delete(&tmp_dir, ctx.cancel_flag());
    done
}

fn make_dirs(uri: &Uri) -> Result<(), String> {
    let provider = registry().get(uri)?;
    if provider.stat(uri).is_ok() {
        return Ok(());
    }
    if let Some(parent) = uri.parent() {
        make_dirs(&parent)?;
    }
    provider.mkdir(uri)
}

/// Removes an item of a sync: to the Trash on this Mac, for good elsewhere (a server has no Trash).
fn remove(ctx: &Ctx, uri: &Uri) -> Result<(), String> {
    match uri.local_path() {
        Some(path) => trash::trash(&path).map(drop),
        None => registry().get(uri)?.delete(uri, ctx.cancel_flag()),
    }
}

pub fn apply(ctx: &Ctx, left: &Uri, right: &Uri, steps: &[Step]) -> Result<Value, String> {
    let todo: Vec<&Step> = steps.iter().filter(|s| s.action != Action::Skip).collect();
    let mut done = 0usize;
    for (i, step) in todo.iter().enumerate() {
        if ctx.cancelled() {
            return Err(tr("Đã hủy", "Cancelled").into());
        }
        ctx.progress(i as u64, todo.len() as u64, &step.rel);
        let (l, r) = (under(left, &step.rel)?, under(right, &step.rel)?);
        match step.action {
            Action::Ltr => replace(ctx, &l, &r)?,
            Action::Rtl => replace(ctx, &r, &l)?,
            Action::DeleteLeft => remove(ctx, &l)?,
            Action::DeleteRight => remove(ctx, &r)?,
            Action::Skip => {}
        }
        done += 1;
    }
    ctx.progress(todo.len() as u64, todo.len() as u64, "");
    Ok(json!({ "done": done }))
}

pub fn register(d: &mut Dispatcher) {
    d.on("sync.compare", |app, window, a| {
        #[derive(Deserialize)]
        struct Compare {
            left: String,
            right: String,
            #[serde(default)]
            options: Options,
        }
        let a: Compare = args(a)?;
        let (left, right) = (Uri::parse(&a.left)?, Uri::parse(&a.right)?);
        if left == right || right.path.starts_with(&format!("{}/", left.path)) && left.scheme == right.scheme || left.path.starts_with(&format!("{}/", right.path)) && left.scheme == right.scheme {
            return Err(tr("Hai thư mục không được nằm trong nhau", "One folder cannot be inside the other").into());
        }
        let title = format!("{} \"{}\" - \"{}\"", tr("So sánh", "Compare"), left.name(), right.name());
        let job = app.jobs.spawn(
            &app.proxy,
            Some(window),
            "sync.compare",
            title,
            move |ctx| {
                let (pairs, same) = compare(ctx, &left, &right, &a.options)?;
                Ok(json!({ "pairs": pairs, "same": same, "truncated": pairs.len() >= REPORT_MAX }))
            },
            None,
        );
        Ok(json!({ "job": job }))
    });
    d.on("sync.apply", |app, window, a| {
        #[derive(Deserialize)]
        struct Apply {
            left: String,
            right: String,
            steps: Vec<Step>,
        }
        let a: Apply = args(a)?;
        let (left, right) = (Uri::parse(&a.left)?, Uri::parse(&a.right)?);
        let count = a.steps.iter().filter(|s| s.action != Action::Skip).count();
        if count == 0 {
            return Err(tr("Không có gì để đồng bộ", "There is nothing to sync").into());
        }
        let title = format!("{} {count} {}", tr("Đồng bộ", "Sync"), tr("mục", "items"));
        let job = app.jobs.spawn(&app.proxy, Some(window), "sync.apply", title, move |ctx| apply(ctx, &left, &right, &a.steps), None);
        Ok(json!({ "job": job }))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{jobs::test_ctx, vfs::local::tests::Temp};
    use std::{fs, time::Duration};

    fn set_mtime(path: &std::path::Path, secs_ago: u64) {
        let time = std::time::SystemTime::now() - Duration::from_secs(secs_ago);
        fs::File::options().write(true).open(path).unwrap().set_modified(time).unwrap();
    }

    fn setup(t: &Temp) -> (Uri, Uri) {
        t.file("L/same.txt", "x");
        t.file("R/same.txt", "x");
        set_mtime(&t.0.join("L/same.txt"), 100);
        set_mtime(&t.0.join("R/same.txt"), 100);
        t.file("L/newer.txt", "new");
        t.file("R/newer.txt", "old");
        set_mtime(&t.0.join("R/newer.txt"), 1000);
        t.file("L/older.txt", "old");
        t.file("R/older.txt", "new!");
        set_mtime(&t.0.join("L/older.txt"), 1000);
        t.file("L/only-left/deep.txt", "d");
        t.file("R/only-right.txt", "r");
        t.file("L/.hidden", "h");
        (Uri::file(&t.0.join("L")), Uri::file(&t.0.join("R")))
    }

    fn state_of<'a>(pairs: &'a [Pair], rel: &str) -> &'a Pair {
        pairs.iter().find(|p| p.rel == rel).unwrap_or_else(|| panic!("{rel} in {pairs:?}"))
    }

    #[test]
    fn compare_classifies_every_state() {
        let t = Temp::new("sync-compare");
        let (l, r) = setup(&t);
        let (ctx, _, _) = test_ctx();
        let (pairs, same) = compare(&ctx, &l, &r, &Options { ignore_hidden: true, ..Options::default() }).unwrap();
        assert_eq!(same, 1);
        assert_eq!(state_of(&pairs, "newer.txt").state, State::LeftNewer);
        assert_eq!(state_of(&pairs, "older.txt").state, State::RightNewer);
        assert_eq!(state_of(&pairs, "only-left").state, State::LeftOnly);
        assert_eq!(state_of(&pairs, "only-right.txt").state, State::RightOnly);
        assert!(pairs.iter().all(|p| p.rel != ".hidden"));
        // With the bytes compared, two files of the same size and time but different bytes are in conflict.
        fs::write(t.0.join("R/same.txt"), "y").unwrap();
        set_mtime(&t.0.join("R/same.txt"), 100);
        let (pairs, _) = compare(&ctx, &l, &r, &Options { content: true, ignore_hidden: true, ..Options::default() }).unwrap();
        assert_eq!(state_of(&pairs, "same.txt").state, State::Conflict);
    }

    #[test]
    fn two_way_picks_newer_and_never_deletes() {
        let both = Options { mode: Mode::Both, mirror: true, ..Options::default() };
        assert_eq!(propose(State::LeftNewer, &both), Action::Ltr);
        assert_eq!(propose(State::RightNewer, &both), Action::Rtl);
        assert_eq!(propose(State::RightOnly, &both), Action::Rtl);
        assert_eq!(propose(State::Conflict, &both), Action::Skip);
        let ltr = Options::default();
        assert_eq!(propose(State::RightOnly, &ltr), Action::Skip, "no mirror, no deletion");
        assert_eq!(propose(State::RightOnly, &Options { mirror: true, ..ltr.clone() }), Action::DeleteRight);
        assert_eq!(propose(State::RightNewer, &ltr), Action::Skip);
    }

    #[test]
    fn apply_only_runs_listed_actions() {
        let t = Temp::new("sync-apply");
        let (l, r) = setup(&t);
        let (ctx, _, _) = test_ctx();
        let steps = vec![
            Step { rel: "newer.txt".into(), action: Action::Ltr },
            Step { rel: "only-left".into(), action: Action::Ltr },
            Step { rel: "older.txt".into(), action: Action::Skip },
        ];
        apply(&ctx, &l, &r, &steps).unwrap();
        assert_eq!(fs::read_to_string(t.0.join("R/newer.txt")).unwrap(), "new");
        assert_eq!(fs::read_to_string(t.0.join("R/only-left/deep.txt")).unwrap(), "d");
        assert_eq!(fs::read_to_string(t.0.join("R/older.txt")).unwrap(), "new!", "a skipped line is untouched");
        assert!(t.0.join("R/only-right.txt").exists(), "nothing was deleted");
        let leftovers: Vec<String> = fs::read_dir(t.0.join("R")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with(".lazyspace")).collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
        assert!(apply(&ctx, &l, &r, &[Step { rel: "../escape".into(), action: Action::Ltr }]).is_err());
    }
}
