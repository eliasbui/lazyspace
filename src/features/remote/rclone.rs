//! Google Drive, Dropbox, OneDrive and the other clouds through rclone, when it is installed: rclone signs in to them
//! with its own app ids, which LazySpace does not have. Its remotes are listed as rclone keeps them, and a place is
//! `rclone://<remote>/<path>`. Each call runs the rclone command, with arguments passed as they are, never through a
//! shell; command names follow rclone's documentation (lsjson, cat, rcat, moveto, purge).

use super::{entry, folder};
use crate::{
    tr,
    vfs::{Capabilities, Commit, Entry, Provider, Uri, cache_dir},
};
use serde::Deserialize;
use std::{
    io::{self, Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::atomic::AtomicBool,
};

/// The clouds offered when adding an account, by rclone's name for them.
pub const KINDS: &[&str] = &["drive", "dropbox", "onedrive", "box", "pcloud", "mega", "yandex", "koofr", "jottacloud", "sharefile"];

/// The rclone program: on the PATH, or where Homebrew puts it (an app opened from Finder has a short PATH).
pub fn binary() -> Option<PathBuf> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&path).chain(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from)).map(|dir| dir.join("rclone")).find(|p| p.is_file())
}

/// Whether `name` is a remote rclone could have made; it cannot start with a dash, so it never reads as an option.
pub fn valid_remote(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphanumeric() || c == '_') && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ' ')) && name.len() <= 64
}

fn missing() -> String {
    tr("Chưa cài rclone. Cài bằng lệnh: brew install rclone", "rclone is not installed. Install it with: brew install rclone").into()
}

fn run(args: &[&str]) -> Result<String, String> {
    let output = Command::new(binary().ok_or_else(missing)?).args(args).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    Err(last_line(&output.stderr))
}

/// The last line rclone wrote to stderr, which says what went wrong, without its date.
fn last_line(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let line = text.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("rclone").trim();
    line.split_once(" ERROR : ").or_else(|| line.split_once(" NOTICE: ")).map_or(line, |(_, rest)| rest).to_owned()
}

/// The names of the remotes rclone has.
pub fn remotes() -> Result<Vec<String>, String> {
    Ok(parse_remotes(&run(&["listremotes"])?))
}

fn parse_remotes(text: &str) -> Vec<String> {
    text.lines().filter_map(|l| l.trim().strip_suffix(':')).filter(|n| valid_remote(n)).map(str::to_owned).collect()
}

/// Opens Terminal with `rclone config create <name> <kind>`, where rclone asks what it needs and signs in in the
/// browser.
pub fn add(kind: &str, name: &str) -> Result<(), String> {
    if !KINDS.contains(&kind) {
        return Err(tr("Không có loại đám mây này", "There is no such cloud").into());
    }
    if !valid_remote(name) || name.contains(' ') || name.contains('.') {
        return Err(tr("Tên chỉ gồm chữ không dấu, số, - và _", "A name may only have plain letters, digits, - and _").into());
    }
    let rclone = binary().ok_or_else(missing)?;
    let dir = cache_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let script = dir.join("rclone-add.command");
    // The name and kind were checked to hold no quote; the program's path is quoted as a whole.
    let body = format!("#!/bin/sh\nexec '{}' config create '{name}' '{kind}'\n", rclone.display().to_string().replace('\'', "'\\''"));
    std::fs::write(&script, body).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&script, std::os::unix::fs::PermissionsExt::from_mode(0o755)).map_err(|e| e.to_string())?;
    Command::new("/usr/bin/open").args(["-a", "Terminal"]).arg(&script).status().map_err(|e| e.to_string()).and_then(|s| if s.success() { Ok(()) } else { Err(tr("Không mở được Terminal", "Terminal could not be opened").into()) })
}

/// rclone's name of a place: `remote:path/inside`.
fn target(uri: &Uri) -> Result<String, String> {
    if !valid_remote(&uri.authority) {
        return Err(format!("{}: {}", tr("Tên remote không hợp lệ", "Not a valid remote name"), uri.authority));
    }
    Ok(format!("{}:{}", uri.authority, uri.path.trim_start_matches('/')))
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Item {
    name: String,
    #[serde(default)]
    size: i64,
    #[serde(default)]
    mod_time: String,
    #[serde(default)]
    is_dir: bool,
}

/// `2017-05-31T16:15:57.034468261+01:00` in seconds since 1970.
fn rfc3339(text: &str) -> i64 {
    let n = |a: usize, b: usize| text.get(a..b).and_then(|t| t.parse::<u32>().ok()).unwrap_or(0);
    let year = text.get(..4).and_then(|t| t.parse().ok()).unwrap_or(1970);
    let local = crate::features::unix(year, n(5, 7).max(1), n(8, 10).max(1), n(11, 13), n(14, 16), n(17, 19));
    // The offset after the time: Z, or +hh:mm and -hh:mm.
    let tail = text.get(19..).unwrap_or("");
    let offset = tail.find(['+', '-']).map(|i| &tail[i..]).map_or(0, |o| {
        let sign = if o.starts_with('-') { -1 } else { 1 };
        let h: i64 = o.get(1..3).and_then(|t| t.parse().ok()).unwrap_or(0);
        let m: i64 = o.get(4..6).and_then(|t| t.parse().ok()).unwrap_or(0);
        sign * (h * 3600 + m * 60)
    });
    local - offset
}

fn entry_of(dir: &Uri, item: &Item) -> Entry {
    entry(dir, &item.name, item.is_dir, false, item.size.max(0) as u64, rfc3339(&item.mod_time))
}

fn parse_list(dir: &Uri, json: &str) -> Result<Vec<Entry>, String> {
    let items: Vec<Item> = serde_json::from_str(json).map_err(|e| format!("rclone: {e}"))?;
    Ok(items.iter().filter(|i| crate::vfs::valid_name(&i.name).is_ok()).map(|i| entry_of(dir, i)).collect())
}

pub struct RcloneProvider;

impl Provider for RcloneProvider {
    fn capabilities(&self, _: &Uri) -> Capabilities {
        Capabilities { write: true, rename: true, trash: false, watch: false, sizes: false, local_path: false }
    }

    fn list(&self, uri: &Uri, _cancel: &AtomicBool) -> Result<Vec<Entry>, String> {
        parse_list(uri, &run(&["lsjson", "--no-mimetype", &target(uri)?])?)
    }

    fn stat(&self, uri: &Uri) -> Result<Entry, String> {
        let Some(parent) = uri.parent() else { return Ok(folder(uri, &uri.authority)) };
        let item: Item = serde_json::from_str(&run(&["lsjson", "--stat", "--no-mimetype", &target(uri)?])?).map_err(|e| format!("rclone: {e}"))?;
        Ok(Entry { name: uri.name(), ..entry_of(&parent, &item) })
    }

    fn read(&self, uri: &Uri) -> Result<Box<dyn Read + Send>, String> {
        let mut child = Command::new(binary().ok_or_else(missing)?).args(["cat", &target(uri)?]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
        let out = child.stdout.take().ok_or_else(|| "rclone".to_owned())?;
        Ok(Box::new(Download { child, out }))
    }

    fn write(&self, uri: &Uri) -> Result<Box<dyn Commit>, String> {
        let partial = uri.parent().map(|p| p.join(&format!(".lazyspace-partial-{}", uri.name()))).ok_or_else(|| tr("Không ghi được ở đây", "Nothing can be written here").to_owned())?;
        let mut child = Command::new(binary().ok_or_else(missing)?).args(["rcat", &target(&partial)?]).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
        let input = child.stdin.take();
        Ok(Box::new(Upload { child: Some(child), input, partial: target(&partial)?, target: target(uri)? }))
    }

    fn mkdir(&self, uri: &Uri) -> Result<(), String> {
        run(&["mkdir", &target(uri)?]).map(drop)
    }

    fn rename(&self, from: &Uri, to: &Uri) -> Result<(), String> {
        if self.stat(to).is_ok() {
            return Err(format!("\"{}\": {}", to.name(), tr("đã có một mục cùng tên", "an item with that name is already there")));
        }
        run(&["moveto", &target(from)?, &target(to)?]).map(drop)
    }

    fn delete(&self, uri: &Uri, _cancel: &AtomicBool) -> Result<(), String> {
        if uri.parent().is_none() {
            return Err(tr("Không xóa được thư mục gốc", "The top folder cannot be deleted").into());
        }
        let verb = if self.stat(uri)?.is_dir { "purge" } else { "deletefile" };
        run(&[verb, &target(uri)?]).map(drop)
    }
}

/// What `rclone cat` writes; its exit at the end says whether all of it came.
struct Download {
    child: Child,
    out: ChildStdout,
}

impl Read for Download {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.out.read(buf)?;
        if n == 0 && !buf.is_empty() {
            let mut stderr = Vec::new();
            if let Some(mut e) = self.child.stderr.take() {
                let _ = e.read_to_end(&mut stderr);
            }
            if !self.child.wait()?.success() {
                return Err(io::Error::other(last_line(&stderr)));
            }
        }
        Ok(n)
    }
}

impl Drop for Download {
    fn drop(&mut self) {
        if matches!(self.child.try_wait(), Ok(None)) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

/// `rclone rcat` into a partial name, moved onto the target by `commit`.
struct Upload {
    child: Option<Child>,
    input: Option<ChildStdin>,
    partial: String,
    target: String,
}

impl Write for Upload {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.input.as_mut().ok_or_else(|| io::Error::other("closed"))?.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.input.as_mut().map_or(Ok(()), Write::flush)
    }
}

impl Commit for Upload {
    fn commit(mut self: Box<Self>) -> Result<(), String> {
        drop(self.input.take());
        let child = self.child.take().ok_or_else(|| "rclone".to_owned())?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            let _ = run(&["deletefile", &self.partial]);
            return Err(last_line(&output.stderr));
        }
        run(&["moveto", &self.partial, &self.target]).map(drop)
    }
}

impl Drop for Upload {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            drop(self.input.take());
            let _ = child.kill();
            let _ = child.wait();
            let _ = run(&["deletefile", &self.partial]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rclone_listings_and_remote_names_parse() {
        assert_eq!(parse_remotes("gdrive:\nwork onedrive:\n-bad:\n\n"), ["gdrive", "work onedrive"]);
        assert!(!valid_remote("--config=/tmp/x") && !valid_remote("") && !valid_remote("a:b") && valid_remote("my_drive-2"));
        let dir = Uri::parse("rclone://gdrive/Tài liệu").unwrap();
        let json = r#"[{"Path":"a.pdf","Name":"a.pdf","Size":1234,"MimeType":"application/pdf","ModTime":"2017-05-31T16:15:57.034468261+01:00","IsDir":false},
                      {"Path":"Ảnh","Name":"Ảnh","Size":-1,"ModTime":"2024-02-29T12:00:00Z","IsDir":true}]"#;
        let entries = parse_list(&dir, json).unwrap();
        assert_eq!((entries[0].size, entries[0].mtime), (1234, crate::features::unix(2017, 5, 31, 15, 15, 57)));
        assert!(entries[1].is_dir && entries[1].size == 0);
        assert_eq!(entries[1].uri, "rclone://gdrive/T%C3%A0i%20li%E1%BB%87u/%E1%BA%A2nh");
        assert_eq!(target(&dir).unwrap(), "gdrive:Tài liệu");
        assert!(target(&Uri::parse("rclone://-x/").unwrap()).is_err());
        assert_eq!(last_line(b"2024/01/01 10:00:00 ERROR : a.txt: directory not found\n"), "a.txt: directory not found");
    }
}
