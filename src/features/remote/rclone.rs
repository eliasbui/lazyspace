//! Google Drive, Dropbox, OneDrive and the other clouds through rclone, which the app installs with Homebrew when asked:
//! rclone signs in to them in the browser with its own app ids, which LazySpace does not have. Its remotes are listed as rclone keeps them, and a place is
//! `rclone://<remote>/<path>`. Each call runs the rclone command, with arguments passed as they are, never through a
//! shell; command names follow rclone's documentation (lsjson, cat, rcat, moveto, purge).

use super::{entry, folder};
use crate::{
    jobs::Ctx,
    tr,
    vfs::{Capabilities, Commit, Entry, Provider, Uri},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::atomic::AtomicBool,
    thread,
    time::{Duration, Instant},
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

/// Signs in to a cloud without a terminal: `rclone config create <name> <kind>` opens the browser itself, waits on
/// 127.0.0.1:53682 for the answer, and writes the remote with its token (and, for OneDrive, the drive it picked).
/// Stopping the job stops rclone and drops what it may have half written; a name already taken is refused, so that
/// never removes a remote the user had.
pub fn sign_in(ctx: &Ctx, kind: &str, name: &str) -> Result<Value, String> {
    if !KINDS.contains(&kind) {
        return Err(tr("Không có loại đám mây này", "There is no such cloud").into());
    }
    if !valid_remote(name) || name.contains(' ') || name.contains('.') {
        return Err(tr("Tên chỉ gồm chữ không dấu, số, - và _", "A name may only have plain letters, digits, - and _").into());
    }
    if remotes()?.iter().any(|r| r == name) {
        return Err(format!("\"{name}\": {}", tr("đã có đám mây tên này", "a cloud of this name is already there")));
    }
    ctx.progress(0, 0, tr("Đăng nhập trong trình duyệt vừa mở", "Sign in in the browser that opened"));
    let child = Command::new(binary().ok_or_else(missing)?).args(["config", "create", name, kind]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let finished = wait(ctx, child, SIGN_IN_LIMIT).and_then(|()| match signed_in(&run(&["config", "dump"])?, name, kind) {
        true => Ok(()),
        false => Err(tr("Chưa đăng nhập xong: rclone không nhận được quyền truy cập", "Signing in did not finish: rclone got no access").into()),
    });
    if finished.is_err() {
        let _ = run(&["config", "delete", name]);
    }
    finished.map(|()| json!({ "remote": name }))
}

/// How long a sign in may wait for the browser.
const SIGN_IN_LIMIT: Duration = Duration::from_secs(600);

/// Whether rclone's configuration (`config dump`) holds the remote `name` of `kind` with a token, and for OneDrive the
/// drive to use: what a sign in that went through leaves.
fn signed_in(dump: &str, name: &str, kind: &str) -> bool {
    let Ok(config) = serde_json::from_str::<Value>(dump) else { return false };
    let remote = &config[name];
    let has = |key: &str| remote[key].as_str().is_some_and(|v| !v.is_empty());
    remote["type"] == kind && has("token") && (kind != "onedrive" || has("drive_id"))
}

/// Installs rclone with Homebrew, which is where `binary` looks for it. Homebrew itself is not installed here: that
/// asks for the administrator's password in a terminal.
pub fn install(ctx: &Ctx) -> Result<Value, String> {
    if binary().is_some() {
        return Ok(Value::Null);
    }
    let brew = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].map(PathBuf::from).into_iter().find(|p| p.is_file()).ok_or_else(|| {
        tr(
            "Chưa có Homebrew để cài rclone. Cài Homebrew từ brew.sh, hoặc rclone từ rclone.org/install, rồi thử lại.",
            "Homebrew is not there to install rclone. Install Homebrew from brew.sh, or rclone from rclone.org/install, then try again.",
        )
        .to_owned()
    })?;
    ctx.progress(0, 0, "brew install rclone");
    // An app opened from Finder has a short PATH; Homebrew needs its own folder on it.
    let path = format!("{}:/usr/bin:/bin:/usr/sbin:/sbin", brew.parent().unwrap_or(Path::new("/")).display());
    let child = Command::new(&brew)
        .args(["install", "rclone"])
        .env("PATH", path)
        .env("HOMEBREW_NO_AUTO_UPDATE", "1")
        .env("HOMEBREW_NO_INSTALL_CLEANUP", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    wait(ctx, child, Duration::from_secs(900))?;
    binary().map(|_| Value::Null).ok_or_else(missing)
}

/// Waits for a program the user may stop or that may hang, reading what it says on stderr as it goes so a full pipe
/// never blocks it; its last line is the error when it fails.
fn wait(ctx: &Ctx, mut child: Child, limit: Duration) -> Result<(), String> {
    let mut stderr = child.stderr.take();
    let said = thread::spawn(move || {
        let mut text = Vec::new();
        if let Some(stderr) = stderr.as_mut() {
            let _ = stderr.read_to_end(&mut text);
        }
        text
    });
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let said = said.join().unwrap_or_default();
            return if status.success() { Ok(()) } else { Err(last_line(&said)) };
        }
        if ctx.cancelled() || started.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            return Err(if ctx.cancelled() { tr("Đã dừng", "Stopped") } else { tr("Hết thời gian chờ", "It took too long") }.into());
        }
        thread::sleep(Duration::from_millis(200));
    }
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
    fn a_sign_in_counts_only_with_a_token_and_for_onedrive_a_drive() {
        let dump = r#"{"gd": {"type": "drive", "scope": "drive", "token": "{\"access_token\":\"x\"}"},
                      "od": {"type": "onedrive", "token": "{}", "drive_id": "b!abc", "drive_type": "personal"},
                      "half": {"type": "onedrive", "token": "{}"}, "none": {"type": "drive"}}"#;
        assert!(signed_in(dump, "gd", "drive") && signed_in(dump, "od", "onedrive"));
        assert!(!signed_in(dump, "half", "onedrive") && !signed_in(dump, "none", "drive") && !signed_in(dump, "gd", "dropbox"));
        assert!(!signed_in(dump, "missing", "drive") && !signed_in("not json", "gd", "drive"));
    }

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
