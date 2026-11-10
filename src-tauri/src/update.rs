//! Whether a newer version is out, from the latest GitHub release, and putting it in place of the installed app:
//! download, check, swap beside the app, then a restart. The installed app is not touched until
//! the new one has passed every check; a failure at any step removes what was downloaded and leaves the app as it was.

use crate::tr;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    ffi::OsStr,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

pub const REPO: &str = "eliasbui/lazyspace";
pub const CURRENT: &str = env!("CARGO_PKG_VERSION");
const BUNDLE_ID: &str = "com.eliasbui.lazyspace";
/// The app inside the release zip, whatever the installed copy has been renamed to.
const APP: &str = "LazySpace.app";
const PLATFORM: &str = "macos";
const STAGE: &str = ".LazySpace-update";
const OLD: &str = ".LazySpace-old";

#[derive(Debug, Serialize, PartialEq)]
pub struct Check {
    pub current: String,
    pub latest: String,
    pub url: String,
    pub newer: bool,
    pub notes: String,
    pub installable: bool,
    #[serde(skip)]
    pub asset: Option<Asset>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Asset {
    pub url: String,
    pub size: u64,
    pub sha256: Option<String>,
}

fn releases() -> String {
    format!("https://github.com/{REPO}/releases/")
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_body(Some(Duration::from_secs(20)))
        .max_redirects(10)
        .http_status_as_error(false)
        .user_agent("lazyspace")
        .build()
        .into()
}

/// The body of a URL, and its status, through GitHub's download links rather than the API where it can be, since the
/// API's limit of sixty calls an hour counts a whole network.
fn get(url: &str) -> Result<(u16, String), String> {
    let mut response = agent().get(url).call().map_err(|e| format!("{}: {e}", tr("Không kết nối được", "Could not connect")))?;
    let status = response.status().as_u16();
    let body = response.body_mut().read_to_string().unwrap_or_default();
    Ok((status, body))
}

/// The newest release. Each release carries `latest.json`, shaped like the API's answer and read through the
/// download links; the API is the fallback for anything without it.
pub fn check() -> Result<Check, String> {
    let manifest = format!("https://github.com/{REPO}/releases/latest/download/latest.json");
    if let Ok((200, body)) = get(&manifest) {
        if let Ok(check) = parse(&body, PLATFORM) {
            return Ok(check);
        }
    }
    let (status, body) = get(&format!("https://api.github.com/repos/{REPO}/releases/latest"))?;
    match status {
        200 => parse(&body, PLATFORM),
        404 => Err(tr("Chưa có bản phát hành nào", "There is no release yet").into()),
        403 | 429 => Err(tr("GitHub đang giới hạn số lần kiểm tra từ mạng của bạn, hãy thử lại sau ít phút", "GitHub is limiting the checks from your network, try again in a few minutes").into()),
        _ => Err(format!("{} {status}", tr("GitHub trả lỗi", "GitHub answered with the error"))),
    }
}

fn parse(body: &str, platform: &str) -> Result<Check, String> {
    let json: Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
    let latest = json["tag_name"].as_str().unwrap_or_default().trim_start_matches('v').to_owned();
    let url = json["html_url"].as_str().unwrap_or_default().to_owned();
    if !is_version(&latest) || !url.starts_with(&releases()) {
        return Err(tr("Bản phát hành không có số phiên bản", "The release has no version number").into());
    }
    let notes: String = json["body"].as_str().unwrap_or_default().chars().take(2000).collect();
    let name = format!("LazySpace-{latest}-{platform}.zip");
    let asset = json["assets"].as_array().and_then(|a| a.iter().find(|a| a["name"] == name.as_str())).and_then(|a| {
        Some(Asset {
            url: a["browser_download_url"].as_str().filter(|u| u.starts_with(&releases()))?.to_owned(),
            size: a["size"].as_u64()?,
            sha256: a["digest"].as_str().and_then(|d| d.strip_prefix("sha256:")).filter(|h| h.len() == 64).map(str::to_lowercase),
        })
    });
    let installable = asset.is_some() && installed().is_some();
    Ok(Check { newer: newer(&latest, CURRENT), current: CURRENT.into(), latest, url, notes, installable, asset })
}

/// The app this program runs from: the bundle. None in a build folder and elsewhere.
pub fn app_path() -> Option<PathBuf> {
    bundle_of(&std::env::current_exe().ok()?.canonicalize().ok()?)
}

pub fn installed() -> Option<PathBuf> {
    app_path().filter(|app| app.parent().is_some_and(writable))
}

fn writable(folder: &Path) -> bool {
    let probe = folder.join(".LazySpace-write-test");
    let ok = fs::write(&probe, b"").is_ok();
    let _ = fs::remove_file(&probe);
    ok
}

fn bundle_of(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent().filter(|d| d.file_name() == Some(OsStr::new("MacOS")))?;
    let contents = macos.parent().filter(|d| d.file_name() == Some(OsStr::new("Contents")))?;
    let bundle = contents.parent()?;
    bundle.extension().is_some_and(|e| e == "app").then(|| bundle.to_path_buf())
}

fn old_of(app: &Path) -> PathBuf {
    app.with_file_name(OLD)
}

/// Removes what a cut-short update left beside the app; the old copy only while the app itself is there.
pub fn tidy(app: &Path) {
    let Some(folder) = app.parent() else { return };
    let _ = fs::remove_dir_all(folder.join(STAGE));
    if app.exists() {
        let old = old_of(app);
        let _ = fs::remove_dir_all(&old);
        let _ = fs::remove_file(&old);
    }
}

pub fn install(check: &Check, app: &Path, progress: impl Fn(u8)) -> Result<(), String> {
    if plist_value(app, "CFBundleShortVersionString").is_ok_and(|v| v == check.latest) {
        return Ok(());
    }
    let asset = check.asset.as_ref().ok_or(tr("Bản phát hành này chưa có gói cho máy này", "This release has no package for this computer"))?;
    let folder = app.parent().ok_or(tr("Không thấy thư mục của ứng dụng", "The app's folder cannot be found"))?;
    tidy(app);
    let stage = folder.join(STAGE);
    fs::create_dir_all(&stage).map_err(|e| format!("{} {}: {e}", tr("Không ghi được vào", "Cannot write to"), folder.display()))?;
    let zip = stage.join("update.zip");
    let done = download(&asset.url, &zip, asset.size, &progress).and_then(|()| put_in_place(&zip, asset, &check.latest, app));
    let _ = fs::remove_dir_all(&stage);
    done
}

/// Downloads `url` to `to`, reporting the percent as it comes.
fn download(url: &str, to: &Path, size: u64, progress: &impl Fn(u8)) -> Result<(), String> {
    let response = agent().get(url).call().map_err(|e| format!("{}: {e}", tr("Không tải được bản cập nhật", "Could not download the update")))?;
    if response.status().as_u16() != 200 {
        return Err(format!("{} {}", tr("Máy chủ trả mã", "The server answered with"), response.status().as_u16()));
    }
    let mut reader = response.into_body().into_reader();
    let mut file = fs::File::create(to).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 256 * 1024];
    let mut got = 0u64;
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        std::io::Write::write_all(&mut file, &buf[..n]).map_err(|e| e.to_string())?;
        got += n as u64;
        progress((got.saturating_mul(100) / size.max(1)).min(99) as u8);
    }
    Ok(())
}

fn verify(zip: &Path, asset: &Asset) -> Result<(), String> {
    let size = fs::metadata(zip).map_err(|e| e.to_string())?.len();
    if size != asset.size {
        return Err(format!("{} {size} byte, {} {}", tr("Gói tải về nặng", "The download is"), tr("không phải", "not"), asset.size));
    }
    if asset.sha256.as_ref().is_some_and(|expected| sha256(zip).ok().as_ref() != Some(expected)) {
        return Err(tr("Gói tải về không khớp mã kiểm tra trên GitHub", "The download does not match the checksum on GitHub").into());
    }
    Ok(())
}

fn put_in_place(zip: &Path, asset: &Asset, version: &str, bundle: &Path) -> Result<(), String> {
    verify(zip, asset)?;
    let stage = zip.parent().ok_or(tr("Không thấy thư mục tải về", "The download folder cannot be found"))?;
    run("/usr/bin/ditto", [OsStr::new("-x"), OsStr::new("-k"), zip.as_os_str(), stage.as_os_str()])?;
    let fresh = stage.join(APP);
    check_app(&fresh, version)?;
    let old = bundle.with_file_name(OLD);
    swap(bundle, &fresh, &old)?;
    let _ = fs::remove_dir_all(&old);
    Ok(())
}

fn sha256(file: &Path) -> Result<String, String> {
    let mut hasher = Sha256::new();
    std::io::copy(&mut fs::File::open(file).map_err(|e| e.to_string())?, &mut hasher).map_err(|e| e.to_string())?;
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn check_app(app: &Path, version: &str) -> Result<(), String> {
    if plist_value(app, "CFBundleIdentifier").ok().as_deref() != Some(BUNDLE_ID) {
        return Err(tr("Gói tải về không phải LazySpace", "The download is not LazySpace").into());
    }
    let found = plist_value(app, "CFBundleShortVersionString")?;
    if found != version {
        return Err(format!("{} {found}, {} {version}", tr("Gói tải về là bản", "The download is version"), tr("không phải", "not")));
    }
    if !app.join("Contents/MacOS/lazyspace").is_file() {
        return Err(tr("Gói tải về không có chương trình", "The download has no program").into());
    }
    run("/usr/bin/codesign", [OsStr::new("--verify"), OsStr::new("--strict"), app.as_os_str()]).map(drop)
}

fn plist_value(app: &Path, key: &str) -> Result<String, String> {
    let plist = app.join("Contents/Info.plist");
    let args = [OsStr::new("-extract"), OsStr::new(key), OsStr::new("raw"), OsStr::new("-o"), OsStr::new("-"), plist.as_os_str()];
    run("/usr/bin/plutil", args)
}

/// Moves the installed app aside and the new one in; a failed second move is undone, so an app is always in place.
fn swap(installed: &Path, fresh: &Path, old: &Path) -> Result<(), String> {
    fs::rename(installed, old).map_err(|e| format!("{}: {e}", tr("Không dời được bản đang cài", "Could not move the installed copy aside")))?;
    if let Err(e) = fs::rename(fresh, installed) {
        let _ = fs::rename(old, installed);
        return Err(format!("{}: {e}", tr("Không đặt được bản mới vào chỗ", "Could not put the new copy in place")));
    }
    Ok(())
}

/// Starts the installed app again once this copy has quit.
pub fn relaunch() -> Result<Value, String> {
    let bundle = app_path().ok_or(tr("Bản này không khởi động lại được", "This copy cannot restart itself"))?;
    Command::new("/bin/sh").args(["-c", "sleep 1; /usr/bin/open -n \"$0\""]).arg(&bundle).spawn().map_err(|e| e.to_string())?;
    std::process::exit(0);
}

fn run<'a>(program: impl AsRef<OsStr>, args: impl IntoIterator<Item = &'a OsStr>) -> Result<String, String> {
    let name = program.as_ref().to_string_lossy().into_owned();
    let output = Command::new(program).args(args).stdin(Stdio::null()).output().map_err(|e| format!("{name}: {e}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned());
    }
    Err(format!("{name}: {}", String::from_utf8_lossy(&output.stderr).lines().next().unwrap_or(tr("lỗi", "error"))))
}

fn is_version(text: &str) -> bool {
    let numbers = text.split('-').next().unwrap_or_default();
    numbers.split('.').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

/// Whether `latest` comes after `current`; anything after the numbers (`-beta.1`) is ignored.
pub fn newer(latest: &str, current: &str) -> bool {
    let parts = |v: &str| -> Vec<u64> { v.split('-').next().unwrap_or_default().split('.').map(|p| p.parse().unwrap_or(0)).collect() };
    let (mut a, mut b) = (parts(latest), parts(current));
    let len = a.len().max(b.len());
    a.resize(len, 0);
    b.resize(len, 0);
    a > b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_by_number() {
        assert!(newer("0.10.0", "0.9.9"));
        assert!(newer("1.0", "0.9.9"));
        assert!(!newer("1.0.0", "1.0"));
        assert!(!newer("0.1.0", "0.1.0"));
        assert!(is_version("1.2.3") && is_version("0.1.0"));
        assert!(!is_version("") && !is_version("v1"));
    }

    #[test]
    fn parse_takes_only_this_repositorys_release() {
        let ok = r#"{"tag_name":"v9.0.0","html_url":"https://github.com/eliasbui/lazyspace/releases/tag/v9.0.0","body":"- new"}"#;
        let c = parse(ok, "macos").unwrap();
        assert!(c.newer && c.latest == "9.0.0" && c.notes == "- new");
        let elsewhere = r#"{"tag_name":"v9.0.0","html_url":"https://evil.example/releases/tag/v9.0.0"}"#;
        assert!(parse(elsewhere, "macos").is_err());
    }

    #[test]
    fn parse_finds_the_zip_of_this_platform() {
        let body = r#"{"tag_name":"v9.0.0","html_url":"https://github.com/eliasbui/lazyspace/releases/tag/v9.0.0","assets":[
            {"name":"LazySpace-9.0.0-macos.zip","size":42,"digest":"sha256:BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD",
             "browser_download_url":"https://github.com/eliasbui/lazyspace/releases/download/v9.0.0/LazySpace-9.0.0-macos.zip"}]}"#;
        let asset = parse(body, "macos").unwrap().asset.unwrap();
        assert_eq!(asset.size, 42);
        assert_eq!(asset.sha256.as_deref(), Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
        let evil = body.replace("https://github.com/eliasbui/lazyspace/releases/download", "https://evil.example");
        assert!(parse(&evil, "macos").unwrap().asset.is_none());
    }

    #[test]
    fn the_app_around_the_program_is_found() {
        assert_eq!(bundle_of(Path::new("/Applications/LazySpace.app/Contents/MacOS/lazyspace")), Some(PathBuf::from("/Applications/LazySpace.app")));
        assert_eq!(bundle_of(Path::new("/x/target/release/lazyspace")), None);
        assert_eq!(old_of(Path::new("/A/LazySpace.app")), PathBuf::from("/A/.LazySpace-old"));
    }
}
