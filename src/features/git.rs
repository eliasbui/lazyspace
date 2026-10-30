//! Git in the list: in a folder of a repository, each item's state (changed, new, staged, in conflict; a folder with
//! anything changed inside it) and the branch, from `git status`. Only a git that is there is run: Homebrew's, the
//! Command Line Tools' or Xcode's, never /usr/bin/git, which on a Mac without the tools asks to install them.

use crate::{
    ipc::{Dispatcher, args, defer},
    vfs::Uri,
};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

/// A git of this Mac, the first found.
fn git() -> Option<&'static Path> {
    const PLACES: [&str; 4] = ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/Library/Developer/CommandLineTools/usr/bin/git", "/Applications/Xcode.app/Contents/Developer/usr/bin/git"];
    PLACES.iter().map(Path::new).find(|p| p.exists())
}

/// The top of the repository `folder` is in: the nearest folder above it, or itself, with a `.git` in it.
pub fn root_of(folder: &Path) -> Option<PathBuf> {
    folder.ancestors().find(|f| f.join(".git").exists()).map(Path::to_path_buf)
}

/// The state of each item directly in `folder` from the output of `git status --porcelain=v1 -z` run at `root`: one
/// letter as Finder's tags would show it, `M` changed, `A` added, `D` gone, `R` renamed, `?` new, `U` in conflict; a
/// folder takes the strongest state of what is inside it.
pub fn states(porcelain: &str, root: &Path, folder: &Path) -> Map<String, Value> {
    let Ok(inside) = folder.strip_prefix(root) else { return Map::new() };
    let mut out: Map<String, Value> = Map::new();
    let mut records = porcelain.split('\0');
    while let Some(record) = records.next() {
        if record.len() < 4 {
            continue;
        }
        let (code, path) = record.split_at(3);
        let xy = code.trim_end();
        // A rename names the old path in the next record, which is skipped.
        if xy.starts_with('R') || xy.starts_with('C') {
            records.next();
        }
        let letter = match xy {
            c if c.contains('U') || c == "AA" || c == "DD" => "U",
            "??" => "?",
            c if c.starts_with('A') => "A",
            c if c.starts_with('R') => "R",
            c if c.contains('D') => "D",
            _ => "M",
        };
        let Ok(rel) = Path::new(path.trim_end_matches('/')).strip_prefix(inside) else { continue };
        let Some(first) = rel.components().next() else { continue };
        let name = first.as_os_str().to_string_lossy().into_owned();
        let deeper = rel.components().count() > 1;
        let letter = if deeper && letter != "U" && letter != "?" { "M" } else { letter };
        let rank = |l: &str| ["?", "M", "R", "A", "D", "U"].iter().position(|x| *x == l).unwrap_or(0);
        let keep = out.get(&name).and_then(Value::as_str).is_some_and(|old| rank(old) >= rank(letter));
        if !keep {
            out.insert(name, json!(letter));
        }
    }
    out
}

fn status(folder: &Path) -> Value {
    let (Some(git), Some(root)) = (git(), root_of(folder)) else { return Value::Null };
    let run = |args: &[&str]| -> Option<String> {
        let out = Command::new(git).arg("-C").arg(&root).args(args).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    };
    let Some(porcelain) = run(&["status", "--porcelain=v1", "-z", "--untracked-files=normal"]) else { return Value::Null };
    let branch = run(&["branch", "--show-current"]).map(|b| b.trim().to_owned()).filter(|b| !b.is_empty());
    let branch = branch.or_else(|| run(&["rev-parse", "--short", "HEAD"]).map(|h| h.trim().to_owned()));
    json!({ "root": Uri::file(&root).to_string(), "branch": branch, "items": states(&porcelain, &root, folder) })
}

pub fn register(d: &mut Dispatcher) {
    d.on("git.status", |app, _, a| {
        #[derive(Deserialize)]
        struct Status {
            uri: String,
        }
        let Some(folder) = Uri::parse(&args::<Status>(a)?.uri)?.local_path() else { return Ok(Value::Null) };
        // Most folders are in no repository; they answer at once, without a git.
        if root_of(&folder).is_none() {
            return Ok(Value::Null);
        }
        defer(app, move || Ok(status(&folder)))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;

    #[test]
    fn each_item_takes_its_state_and_a_folder_the_strongest_inside_it() {
        let root = Path::new("/r");
        let porcelain = " M src/main.rs\0?? notes.md\0A  src/new.rs\0R  docs/b.md\0docs/a.md\0UU src/x/conflict.rs\0 D gone.txt\0?? build/\0";
        let top = states(porcelain, root, root);
        assert_eq!(top["notes.md"], "?");
        assert_eq!(top["src"], "U", "a conflict inside wins");
        assert_eq!(top["docs"], "M", "a rename deeper down is a change of the folder");
        assert_eq!(top["gone.txt"], "D");
        assert_eq!(top["build"], "?");
        let src = states(porcelain, root, &root.join("src"));
        assert_eq!((src["main.rs"].as_str(), src["new.rs"].as_str(), src["x"].as_str()), (Some("M"), Some("A"), Some("U")));
        assert!(states(porcelain, root, Path::new("/elsewhere")).is_empty());
    }

    #[test]
    fn a_repository_is_found_from_any_folder_in_it() {
        let t = Temp::new("git-root");
        t.file("repo/.git/HEAD", "ref: refs/heads/main");
        t.file("repo/a/b/c.txt", "");
        assert_eq!(root_of(&t.0.join("repo/a/b")), Some(t.0.join("repo")));
        assert_eq!(root_of(&t.0.join("repo")), Some(t.0.join("repo")));
    }
}
