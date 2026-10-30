//! Lanes, the download manager by the same author: a link kept as a file (a .webloc from the Stash Shelf or Safari, a .url
//! shortcut, a text file holding one link) is handed to it to download. LazySpace does what Lanes' own browser extension
//! does: it adds a job to `inbox.jsonl` in Lanes' data folder, under the lock Lanes takes the inbox by, and starts Lanes
//! in the background when it is not running, which reads the inbox as it starts and every few seconds after.

use crate::{
    ipc::{Dispatcher, args},
    tr,
    vfs::Uri,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    process::Command,
};

/// A link file is a few hundred bytes; anything larger is not one.
const LINK_FILE_MAX: u64 = 64 * 1024;
/// The longest address Lanes takes from a job.
const URL_MAX: usize = 8192;

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

/// Lanes' data folder, where its inbox is.
fn lanes_dir() -> PathBuf {
    home().join("Library/Application Support/Lanes")
}

/// Lanes when it is installed.
fn app() -> Option<PathBuf> {
    [PathBuf::from("/Applications"), home().join("Applications")].into_iter().map(|dir| dir.join("Lanes.app")).find(|app| app.exists())
}

/// The address a link file holds, or None for a file that is not one.
fn link_of(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if !matches!(ext.as_str(), "webloc" | "url" | "txt") || fs::metadata(path).ok()?.len() > LINK_FILE_MAX {
        return None;
    }
    let text = fs::read_to_string(path).ok()?;
    let found = match ext.as_str() {
        "webloc" => {
            let after = &text[text.find("<key>URL</key>")? + "<key>URL</key>".len()..];
            let inner = after.split_once("<string>")?.1.split_once("</string>")?.0;
            inner.trim().replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
        }
        "url" => text.lines().find_map(|l| l.trim().strip_prefix("URL=")).map(|u| u.trim().to_owned())?,
        _ => text.trim().to_owned(),
    };
    (found.len() <= URL_MAX && (found.starts_with("http://") || found.starts_with("https://")) && !found.contains(char::is_whitespace)).then_some(found)
}

/// Adds the links to the end of the inbox, under the lock Lanes reads it by so it never takes half of a line.
fn push(dir: &Path, urls: &[String]) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let mut file = OpenOptions::new().create(true).append(true).open(dir.join("inbox.jsonl"))?;
    file.lock()?;
    for url in urls {
        writeln!(file, "{}", json!({ "url": url }))?;
    }
    Ok(())
}

/// Hands the links of the given files to Lanes and returns how many were sent.
fn send(paths: &[PathBuf]) -> Result<usize, String> {
    let app = app().ok_or_else(|| tr("Chưa cài Lanes", "Lanes is not installed").to_owned())?;
    let urls: Vec<String> = paths.iter().filter_map(|p| link_of(p)).collect();
    if urls.is_empty() {
        return Err(tr("Không có liên kết http hay https nào để tải", "There is no http or https link to download").into());
    }
    push(&lanes_dir(), &urls).map_err(|e| e.to_string())?;
    Command::new("/usr/bin/open").args(["-g", "-a"]).arg(&app).spawn().map_err(|e| e.to_string())?;
    Ok(urls.len())
}

pub fn register(d: &mut Dispatcher) {
    d.on("lanes.available", |_, _, _| Ok(json!(app().is_some())));
    d.on("lanes.send", |_, _, a| {
        #[derive(Deserialize)]
        struct Send {
            uris: Vec<String>,
        }
        let paths: Vec<PathBuf> = args::<Send>(a)?.uris.iter().filter_map(|u| Uri::parse(u).ok()?.local_path()).collect();
        Ok(json!({ "sent": send(&paths)? }))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lazyspace-lanes-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_link_is_read_from_a_webloc_a_url_shortcut_and_a_text_file() {
        let dir = temp("read");
        let webloc = dir.join("a.webloc");
        fs::write(&webloc, "<plist><dict><key>URL</key><string>https://x.com/a.zip?a=1&amp;b=2</string></dict></plist>").unwrap();
        assert_eq!(link_of(&webloc).as_deref(), Some("https://x.com/a.zip?a=1&b=2"));
        let url = dir.join("b.url");
        fs::write(&url, "[InternetShortcut]\r\nURL=http://x.com/b.iso\r\n").unwrap();
        assert_eq!(link_of(&url).as_deref(), Some("http://x.com/b.iso"));
        let text = dir.join("c.txt");
        fs::write(&text, "  https://x.com/c.mp4\n").unwrap();
        assert_eq!(link_of(&text).as_deref(), Some("https://x.com/c.mp4"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn what_is_not_a_web_link_is_left_out() {
        let dir = temp("skip");
        for (name, body) in [("a.txt", "javascript:alert(1)"), ("b.txt", "two words https://x.com"), ("c.webloc", "<dict><key>URL</key><string>file:///etc/passwd</string></dict>"), ("d.zip", "https://x.com/d")] {
            fs::write(dir.join(name), body).unwrap();
            assert_eq!(link_of(&dir.join(name)), None, "{name}");
        }
        assert_eq!(link_of(&dir.join("missing.url")), None);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn jobs_are_appended_one_per_line_for_lanes() {
        let dir = temp("push");
        push(&dir, &["https://x.com/a".into()]).unwrap();
        push(&dir, &["https://x.com/b".into(), "https://x.com/c".into()]).unwrap();
        let lines: Vec<Value> = fs::read_to_string(dir.join("inbox.jsonl")).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines, vec![json!({ "url": "https://x.com/a" }), json!({ "url": "https://x.com/b" }), json!({ "url": "https://x.com/c" })]);
        let _ = fs::remove_dir_all(dir);
    }
}
