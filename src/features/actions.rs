//! Commands of the user's own in the context menu, as Directory Opus and ForkLift have them: a line of the shell run
//! with the items selected as its arguments (`"$@"`, `$1`), in the folder they are in, kept in actions.json. The paths
//! are arguments, never written into the line, so no name of a file can become a command. The output comes back as a
//! toast, or the line runs in Terminal for one to watch.

use crate::{
    features::data_file,
    ipc::{Dispatcher, args},
    tr,
    vfs::Uri,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

/// The most commands kept, and the most output kept of a run.
const MAX: usize = 50;
const OUTPUT_MAX: usize = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Action {
    pub id: String,
    pub name: String,
    /// A line of zsh; the items selected are its arguments.
    pub command: String,
    /// What it is offered for: "any" item, "files", "folders", or "none" selected (the folder itself).
    #[serde(default = "any")]
    pub when: String,
    /// Where its output goes: "toast", "terminal" or "none".
    #[serde(default = "toast")]
    pub output: String,
}

fn any() -> String {
    "any".into()
}

fn toast() -> String {
    "toast".into()
}

fn path() -> PathBuf {
    data_file("actions.json")
}

pub fn load(path: &Path) -> Vec<Action> {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(path: &Path, actions: &[Action]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(actions).map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text).and_then(|()| std::fs::rename(&temp, path)).map_err(|e| e.to_string())
}

/// Whether the commands can be kept: each with a name and a line, choices the page knows, not too many.
pub fn check(actions: &[Action]) -> Result<(), String> {
    if actions.len() > MAX {
        return Err(tr("Có quá nhiều lệnh", "There are too many commands").into());
    }
    for a in actions {
        if a.name.trim().is_empty() || a.name.chars().count() > 80 || a.command.trim().is_empty() || a.command.len() > 4000 {
            return Err(tr("Mỗi lệnh cần một tên (tối đa 80 ký tự) và một dòng lệnh", "Each command needs a name (80 characters at most) and a command line").into());
        }
        if !["any", "files", "folders", "none"].contains(&a.when.as_str()) || !["toast", "terminal", "none"].contains(&a.output.as_str()) {
            return Err(tr("Lựa chọn của lệnh không hợp lệ", "A choice of the command is not valid").into());
        }
    }
    Ok(())
}

/// A word quoted for zsh: between single quotes, a single quote closed, escaped and opened again.
fn quote(word: &str) -> String {
    format!("'{}'", word.replace('\'', "'\\''"))
}

/// The script Terminal runs for a command to be watched: in `folder`, the line with the items set as its arguments.
pub fn script(command: &str, folder: &Path, items: &[PathBuf]) -> String {
    let args: Vec<String> = items.iter().map(|p| quote(&p.to_string_lossy())).collect();
    format!("#!/bin/zsh\ncd {} || exit 1\nset -- {}\n{}\n", quote(&folder.to_string_lossy()), args.join(" "), command)
}

/// Runs the line with zsh in `folder`, the items as its arguments, and gives back what it printed; stops it when the
/// job is cancelled.
fn run(command: &str, folder: &Path, items: &[PathBuf], cancel: &std::sync::atomic::AtomicBool) -> Result<String, String> {
    let mut child = Command::new("/bin/zsh")
        .arg("-c")
        .arg(command)
        .arg("lazyspace")
        .args(items)
        .current_dir(folder)
        .env("LAZYSPACE_FOLDER", folder)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let (mut out, mut err) = (child.stdout.take(), child.stderr.take());
    let readers = [out.take().map(|o| std::thread::spawn(move || read_some(o))), err.take().map(|e| std::thread::spawn(move || read_some(e)))];
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("cancelled".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let [out, err] = readers.map(|r| r.and_then(|h| h.join().ok()).unwrap_or_default());
    let text = if out.trim().is_empty() { err } else { out };
    if status.success() { Ok(text) } else { Err(format!("{} {}: {}", tr("Lệnh dừng với mã", "The command stopped with code"), status.code().unwrap_or(-1), text.trim())) }
}

fn read_some(mut from: impl Read) -> String {
    let mut bytes = Vec::new();
    let _ = from.by_ref().take(OUTPUT_MAX as u64).read_to_end(&mut bytes);
    // What is beyond the limit is read and dropped, so the command never waits on a full pipe.
    let _ = std::io::copy(&mut from, &mut std::io::sink());
    String::from_utf8_lossy(&bytes).into_owned()
}

pub fn register(d: &mut Dispatcher) {
    d.on("actions.list", |_, _, _| Ok(json!(load(&path()))));
    d.on("actions.save", |_, _, a| {
        #[derive(Deserialize)]
        struct Save {
            actions: Vec<Action>,
        }
        let actions = args::<Save>(a)?.actions;
        check(&actions)?;
        save(&path(), &actions)?;
        Ok(json!(actions))
    });
    d.on("actions.run", |app, window, a| {
        #[derive(Deserialize)]
        struct Run {
            id: String,
            folder: String,
            #[serde(default)]
            uris: Vec<String>,
        }
        let a: Run = args(a)?;
        let action = load(&path()).into_iter().find(|x| x.id == a.id).ok_or_else(|| tr("Không còn lệnh này", "That command is gone").to_owned())?;
        let local = |u: &String| Uri::parse(u).ok().and_then(|u| u.local_path());
        let folder = local(&a.folder).ok_or_else(|| tr("Lệnh chỉ chạy trong thư mục trên máy", "Commands run in folders of this Mac only").to_owned())?;
        let items: Vec<PathBuf> = a.uris.iter().filter_map(local).collect();
        if action.output == "terminal" {
            let file = std::env::temp_dir().join(format!("lazyspace-{}.command", std::process::id()));
            std::fs::write(&file, script(&action.command, &folder, &items)).map_err(|e| e.to_string())?;
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
            Command::new("/usr/bin/open").args(["-a", "Terminal"]).arg(&file).status().map_err(|e| e.to_string())?;
            return Ok(Value::Null);
        }
        let quiet = action.output == "none";
        let job = app.jobs.spawn(&app.proxy, Some(window), "action", action.name.clone(), move |ctx| {
            let text = run(&action.command, &folder, &items, ctx.cancel_flag())?;
            Ok(json!({ "action": action.name, "output": if quiet { String::new() } else { text } }))
        }, None);
        Ok(json!({ "job": job }))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn the_items_are_arguments_and_a_name_never_runs() {
        let t = Temp::new("actions-run");
        let odd = t.file("a $(touch pwned) ; b'.txt", "x");
        let out = run("printf '%s|' \"$@\"; pwd", &t.0, &[odd.clone()], &AtomicBool::new(false)).unwrap();
        assert_eq!(out.trim(), format!("{}|{}", odd.display(), t.0.display()));
        assert!(!t.0.join("pwned").exists(), "the name was not run");
        let failed = run("echo nope >&2; exit 3", &t.0, &[], &AtomicBool::new(false)).unwrap_err();
        assert!(failed.contains('3') && failed.contains("nope"), "{failed}");
        assert_eq!(run("sleep 5", &t.0, &[], &AtomicBool::new(true)).unwrap_err(), "cancelled");
    }

    #[test]
    fn the_script_for_terminal_quotes_every_item() {
        let script = script("ls -l \"$@\"", Path::new("/tmp/a b"), &[PathBuf::from("/tmp/it's.txt")]);
        assert_eq!(script, "#!/bin/zsh\ncd '/tmp/a b' || exit 1\nset -- '/tmp/it'\\''s.txt'\nls -l \"$@\"\n");
    }

    #[test]
    fn commands_are_checked_before_they_are_kept() {
        let ok = Action { id: "a".into(), name: "List".into(), command: "ls".into(), when: "any".into(), output: "toast".into() };
        assert!(check(std::slice::from_ref(&ok)).is_ok());
        assert!(check(&[Action { name: " ".into(), ..ok.clone() }]).is_err());
        assert!(check(&[Action { when: "always".into(), ..ok.clone() }]).is_err());
        assert!(check(&vec![ok; MAX + 1]).is_err());
    }
}
