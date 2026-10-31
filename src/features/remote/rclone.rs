//! Google Drive, Dropbox, OneDrive and the other clouds through rclone, which the app installs with Homebrew when asked:
//! rclone signs in to them in the browser with its own app ids, which LazySpace does not have. Its remotes are listed as rclone keeps them, and a place is
//! `rclone://<remote>/<path>`. Each call runs the rclone command, with arguments passed as they are, never through a
//! shell; command names follow rclone's documentation (lsjson, cat, rcat, moveto, purge). Who is signed in to each
//! remote is asked of its cloud once, with the token rclone keeps, and remembered for the sidebar.

use super::{entry, folder};
use crate::{
    features::data_file,
    jobs::Ctx,
    tr,
    vfs::{Capabilities, Commit, Entry, Provider, Uri},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::atomic::AtomicBool,
    thread,
    time::{Duration, Instant},
};

/// The clouds offered when adding an account: rclone's name for each, and two of LazySpace's own for the Microsoft
/// clouds of an organisation, which rclone signs in to as OneDrive with other answers to its questions (`backend`).
pub const KINDS: &[&str] = &["drive", "dropbox", "onedrive", "onedrive_work", "sharepoint", "box", "pcloud", "mega", "yandex", "koofr", "jottacloud", "sharefile"];

/// rclone's backend for a kind of `KINDS`.
fn backend(kind: &str) -> &str {
    match kind {
        "onedrive_work" | "sharepoint" => "onedrive",
        kind => kind,
    }
}

/// The rclone program: on the PATH, or where Homebrew puts it (an app opened from Finder has a short PATH).
pub fn binary() -> Option<PathBuf> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&path).chain(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from)).map(|dir| dir.join("rclone")).find(|p| p.is_file())
}

/// A configuration file that replaces rclone's own; only the tests set one, to keep away from the user's remotes.
#[cfg(test)]
static CONFIG: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// The rclone command, to be given its arguments.
fn command() -> Result<Command, String> {
    #[allow(unused_mut)]
    let mut command = Command::new(binary().ok_or_else(missing)?);
    #[cfg(test)]
    if let Some(config) = CONFIG.get() {
        command.arg("--config").arg(config);
    }
    Ok(command)
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
    let output = command()?.args(args).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
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

/// The remotes rclone has, each with its backend (`listremotes --long`, which shows no secret).
pub fn listed() -> Result<Vec<(String, String)>, String> {
    Ok(parse_remotes(&run(&["listremotes", "--long"])?))
}

/// The names of the remotes rclone has.
pub fn remotes() -> Result<Vec<String>, String> {
    Ok(listed()?.into_iter().map(|(name, _)| name).collect())
}

/// `name: type` lines, the type padded after the colon; a name never holds a colon.
fn parse_remotes(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| l.trim().split_once(':'))
        .filter(|(name, _)| valid_remote(name))
        .map(|(name, kind)| (name.to_owned(), kind.trim().to_owned()))
        .collect()
}

/// What may be given beside a sign in, all of it optional: for an organisation that does not let rclone's own app in,
/// the app it registered itself (its client id and secret, and its tenant, the directory ID), and the SharePoint site.
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Advanced {
    pub client_id: String,
    pub client_secret: String,
    pub tenant: String,
    /// The SharePoint site, by its address (`https://contoso.sharepoint.com/sites/team`) or its name; the
    /// organisation's root site when empty.
    pub site: String,
}

/// The access OneDrive of work or school asks for: rclone's own without Sites.Read.All, which only SharePoint needs
/// (the scopes rclone's `disable_site_permission` leaves), so less waits on an administrator.
const WORK_SCOPES: &str = "Files.Read Files.ReadWrite Files.Read.All Files.ReadWrite.All offline_access";

/// A value typed for a sign in, trimmed; None when empty. Each goes to rclone as one `key=value` argument, so even
/// one that starts with a dash is never read as an option.
fn given(label: &str, value: &str) -> Result<Option<String>, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > 2048 || value.chars().any(char::is_control) {
        return Err(format!("{label}: {}", tr("giá trị không hợp lệ", "not a valid value")));
    }
    Ok(Some(value.to_owned()))
}

/// The arguments of `rclone config create` for a sign in to `kind`. rclone asks its questions with the answers given
/// here as `key=value` (it reads each "config parameter" by the question's name), and its defaults for the rest:
/// OneDrive of work or school takes the user's own drive, SharePoint the first library of the site.
fn create_args(kind: &str, name: &str, advanced: &Advanced) -> Result<Vec<String>, String> {
    let mut args = vec!["config".to_owned(), "create".into(), name.into(), backend(kind).into()];
    let mut set = |key: &str, value: &str| args.push(format!("{key}={value}"));
    match kind {
        "onedrive_work" => {
            set("config_type", "onedrive");
            set("access_scopes", WORK_SCOPES);
        }
        "sharepoint" => match given("Site", &advanced.site)? {
            Some(site) => {
                set("config_type", "url");
                set("config_site_url", &site);
            }
            None => set("config_type", "sharepoint"),
        },
        _ => {}
    }
    if let Some(id) = given("Client ID", &advanced.client_id)? {
        set("client_id", &id);
    }
    if let Some(secret) = given("Client secret", &advanced.client_secret)? {
        set("client_secret", &secret);
    }
    if backend(kind) == "onedrive" {
        if let Some(tenant) = given("Tenant ID", &advanced.tenant)? {
            if !tenant.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.')) {
                return Err(format!("Tenant ID: {}", tr("chỉ gồm chữ, số, - và .", "only letters, digits, - and .")));
            }
            set("tenant", &tenant);
        }
    }
    Ok(args)
}

/// Signs in to a cloud without a terminal: `rclone config create <name> <backend>` opens the browser itself, waits on
/// 127.0.0.1:53682 for the answer, and writes the remote with its token (and, for OneDrive, the drive it picked).
/// Stopping the job stops rclone and drops what it may have half written; a name already taken is refused, so that
/// never removes a remote the user had. Once in, the account is looked up for the sidebar.
pub fn sign_in(ctx: &Ctx, kind: &str, name: &str, advanced: &Advanced) -> Result<Value, String> {
    if !KINDS.contains(&kind) {
        return Err(tr("Không có loại đám mây này", "There is no such cloud").into());
    }
    if !valid_remote(name) || name.contains(' ') || name.contains('.') {
        return Err(tr("Tên chỉ gồm chữ không dấu, số, - và _", "A name may only have plain letters, digits, - and _").into());
    }
    let args = create_args(kind, name, advanced)?;
    if remotes()?.iter().any(|r| r == name) {
        return Err(format!("\"{name}\": {}", tr("đã có đám mây tên này", "a cloud of this name is already there")));
    }
    ctx.progress(0, 0, tr("Đăng nhập trong trình duyệt vừa mở", "Sign in in the browser that opened"));
    let microsoft = backend(kind) == "onedrive";
    let hint = microsoft.then_some((
        MICROSOFT_HINT,
        tr(
            "Trình duyệt báo \"Cần quản trị viên phê duyệt\"? Hãy dừng việc này: tổ chức của bạn chặn ứng dụng của rclone",
            "Does the browser say \"Need admin approval\"? Stop this: your organisation blocks rclone's app",
        ),
    ));
    let child = command()?.args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let finished = wait(ctx, child, SIGN_IN_LIMIT, hint).map_err(|ended| explain(kind, ended)).and_then(|()| match signed_in(&run(&["config", "dump"])?, name, backend(kind)) {
        true => Ok(()),
        false => Err(tr("Chưa đăng nhập xong: rclone không nhận được quyền truy cập", "Signing in did not finish: rclone got no access").into()),
    });
    if finished.is_err() {
        let _ = run(&["config", "delete", name]);
        return finished.map(|()| Value::Null);
    }
    ctx.progress(0, 0, tr("Đang xem tài khoản nào vừa đăng nhập", "Finding out which account signed in"));
    let account = lookup(name).ok();
    if let Some(account) = &account {
        remember(name, account.clone());
    }
    Ok(json!({ "remote": name, "account": account }))
}

/// How long a sign in may wait for the browser: long enough for a password and a second factor, short enough that a
/// page that will never answer (an organisation's "Need admin approval") does not hold the job for long.
const SIGN_IN_LIMIT: Duration = Duration::from_secs(300);

/// When a sign in to Microsoft still waits, the job says what may hold it up.
const MICROSOFT_HINT: Duration = Duration::from_secs(45);

/// Whether rclone's answer looks like Microsoft's refusal of its app in an organisation: AADSTS65001 (no consent),
/// AADSTS90094 and AADSTS90095 (an administrator must approve), or the consent page sent back without one.
fn needs_admin(error: &str) -> bool {
    let error = error.to_lowercase();
    ["aadsts65001", "aadsts90094", "aadsts90095", "admin", "consent", "access_denied"].iter().any(|word| error.contains(word))
}

/// What to say of a sign in that did not go through.
fn explain(kind: &str, ended: Ended) -> String {
    let microsoft = backend(kind) == "onedrive";
    let admin = tr(
        "Microsoft chưa cho rclone vào tài khoản này. Với tài khoản cơ quan hoặc trường học, trình duyệt thường báo \"Cần quản trị viên phê duyệt\" (Need admin approval): tổ chức của bạn chỉ cho các ứng dụng đã được duyệt truy cập OneDrive. Có hai cách:\n1. Nhờ bộ phận IT phê duyệt ứng dụng rclone, hoặc đăng ký một ứng dụng riêng trong Microsoft Entra ID rồi điền Client ID, Client secret và Tenant ID ở phần Nâng cao (Thêm đám mây > Dịch vụ khác...).\n2. Cài ứng dụng OneDrive của Microsoft và đăng nhập trong đó: LazySpace tự hiện thư mục của nó trong mục Đám mây.",
        "Microsoft did not let rclone into this account. With a work or school account the browser usually says \"Need admin approval\": your organisation lets only approved apps reach OneDrive. There are two ways around it:\n1. Ask your IT department to approve the rclone app, or register an app of your own in Microsoft Entra ID and fill in its Client ID, Client secret and Tenant ID under Advanced (Add a Cloud > Other Service...).\n2. Install Microsoft's OneDrive app and sign in there: LazySpace shows its folder in the Cloud section by itself.",
    );
    match ended {
        Ended::Stopped => tr("Đã dừng", "Stopped").into(),
        Ended::TooLong if microsoft => format!("{} {admin}", tr("Hết thời gian chờ đăng nhập.", "The sign in took too long.")),
        Ended::TooLong => tr("Hết thời gian chờ đăng nhập trong trình duyệt", "The sign in in the browser took too long").into(),
        Ended::Failed(error) if microsoft && needs_admin(&error) => format!("{admin}\n\n({error})"),
        Ended::Failed(error) => error,
    }
}

/// Whether rclone's configuration (`config dump`) holds the remote `name` of `kind` with a token, and for OneDrive the
/// drive to use: what a sign in that went through leaves.
fn signed_in(dump: &str, name: &str, kind: &str) -> bool {
    let Ok(config) = serde_json::from_str::<Value>(dump) else { return false };
    let remote = &config[name];
    let has = |key: &str| remote[key].as_str().is_some_and(|v| !v.is_empty());
    remote["type"] == kind && has("token") && (kind != "onedrive" || has("drive_id"))
}

/// Who is signed in to a remote, as the sidebar shows it, kept in `cloud-accounts.json` beside the settings so the
/// sidebar never waits on the network for it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Account {
    /// rclone's backend, to tell a remote made again under the same name for another cloud.
    pub backend: String,
    /// The kind of `KINDS`: OneDrive of an organisation is "onedrive_work", a SharePoint library "sharepoint".
    pub kind: String,
    /// The email, or the name, the cloud gives for the user.
    pub account: Option<String>,
}

fn accounts_path() -> PathBuf {
    data_file("cloud-accounts.json")
}

/// The accounts found so far, by remote.
pub fn accounts() -> BTreeMap<String, Account> {
    std::fs::read_to_string(accounts_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// Keeps the account of a remote, written through a temporary file.
pub fn remember(name: &str, account: Account) {
    let mut all = accounts();
    all.insert(name.to_owned(), account);
    let path = accounts_path();
    let partial = path.with_extension("json.partial");
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string_pretty(&all) {
        if std::fs::write(&partial, text).is_ok() {
            let _ = std::fs::rename(&partial, &path);
        }
    }
}

/// What the configuration of a remote says of it, for finding its account. The token stays in memory only: it is
/// never written out, put in an error or logged.
#[derive(Debug, Default, PartialEq)]
struct Remote {
    backend: String,
    access_token: Option<String>,
    drive_id: String,
    drive_type: String,
    region: String,
}

impl Remote {
    fn parse(dump: &str, name: &str) -> Option<Remote> {
        let config: Value = serde_json::from_str(dump).ok()?;
        let remote = config.get(name)?;
        let text = |key: &str| remote[key].as_str().unwrap_or_default().to_owned();
        // rclone keeps the token as JSON inside a string.
        let token: Value = serde_json::from_str(remote["token"].as_str().unwrap_or("null")).unwrap_or(Value::Null);
        Some(Remote {
            backend: text("type"),
            access_token: token["access_token"].as_str().filter(|t| !t.is_empty()).map(str::to_owned),
            drive_id: text("drive_id"),
            drive_type: text("drive_type"),
            region: text("region"),
        })
    }

    /// The kind of `KINDS` it was made as, as near as the configuration tells.
    fn kind(&self) -> String {
        match (self.backend.as_str(), self.drive_type.as_str()) {
            ("onedrive", "business") => "onedrive_work".into(),
            ("onedrive", "documentLibrary") => "sharepoint".into(),
            (backend, _) => backend.into(),
        }
    }

    /// Microsoft Graph of the remote's national cloud.
    fn graph(&self) -> &'static str {
        match self.region.as_str() {
            "us" => "https://graph.microsoft.us/v1.0",
            "de" => "https://graph.microsoft.de/v1.0",
            "cn" => "https://microsoftgraph.chinacloudapi.cn/v1.0",
            _ => "https://graph.microsoft.com/v1.0",
        }
    }
}

/// Finds who is signed in to the remote `name`: a cheap call (`about`) first makes rclone renew the token when it ran
/// out, then the cloud is asked with it who the user is. Google Drive, OneDrive, Dropbox and Box are asked through
/// their own APIs; the others through `rclone config userinfo`, where rclone can tell.
pub fn lookup(name: &str) -> Result<Account, String> {
    if !valid_remote(name) {
        return Err(format!("{}: {name}", tr("Tên remote không hợp lệ", "Not a valid remote name")));
    }
    let root = format!("{name}:");
    let _ = run(&["about", "--contimeout=15s", "--timeout=30s", &root]);
    let remote = Remote::parse(&run(&["config", "dump"])?, name).ok_or_else(|| format!("\"{name}\": {}", tr("không có remote này", "there is no such remote")))?;
    let account = who(&remote).or_else(|| run(&["config", "userinfo", "--json", &root]).ok().and_then(|text| serde_json::from_str(&text).ok()).and_then(|v| userinfo_user(&v)));
    Ok(Account { backend: remote.backend.clone(), kind: remote.kind(), account })
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(10)))
        .timeout_global(Some(Duration::from_secs(20)))
        .http_status_as_error(false)
        .user_agent("lazyspace")
        .build()
        .into()
}

/// The JSON a cloud answers to a call with the token, when it answers 200.
fn ask(url: &str, token: &str, post: bool) -> Option<Value> {
    let bearer = format!("Bearer {token}");
    let response = if post { agent().post(url).header("Authorization", &bearer).send_empty() } else { agent().get(url).header("Authorization", &bearer).call() };
    let response = response.ok()?;
    if response.status().as_u16() != 200 {
        return None;
    }
    serde_json::from_str(&response.into_body().read_to_string().ok()?).ok()
}

fn who(remote: &Remote) -> Option<String> {
    let token = remote.access_token.as_deref()?;
    match remote.backend.as_str() {
        "drive" => ask("https://www.googleapis.com/drive/v3/about?fields=user", token, false).and_then(|v| google_user(&v)),
        "dropbox" => ask("https://api.dropboxapi.com/2/users/get_current_account", token, true).and_then(|v| dropbox_user(&v)),
        "box" => ask("https://api.box.com/2.0/users/me?fields=login,name", token, false).and_then(|v| box_user(&v)),
        "onedrive" => {
            // A work or school token names its user itself; rclone's scopes leave out User.Read, which /me needs, so
            // the drive's owner is the next to ask.
            jwt_user(token)
                .or_else(|| ask(&format!("{}/me?$select=mail,userPrincipalName", remote.graph()), token, false).and_then(|v| graph_user(&v)))
                .or_else(|| ask(&format!("{}/me/drive?$select=owner", remote.graph()), token, false).and_then(|v| drive_owner(&v)))
        }
        _ => None,
    }
}

fn text_of(v: &Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|t| !t.is_empty()).map(str::to_owned)
}

fn google_user(v: &Value) -> Option<String> {
    text_of(&v["user"]["emailAddress"]).or_else(|| text_of(&v["user"]["displayName"]))
}

fn dropbox_user(v: &Value) -> Option<String> {
    text_of(&v["email"]).or_else(|| text_of(&v["name"]["display_name"]))
}

fn box_user(v: &Value) -> Option<String> {
    text_of(&v["login"]).or_else(|| text_of(&v["name"]))
}

fn graph_user(v: &Value) -> Option<String> {
    text_of(&v["mail"]).or_else(|| text_of(&v["userPrincipalName"]))
}

fn drive_owner(v: &Value) -> Option<String> {
    let user = &v["owner"]["user"];
    text_of(&user["email"]).or_else(|| text_of(&user["displayName"])).or_else(|| text_of(&v["owner"]["group"]["displayName"]))
}

/// What `rclone config userinfo --json` gives, which differs by cloud.
fn userinfo_user(v: &Value) -> Option<String> {
    ["Email", "email", "Login", "login", "Username", "username", "Name", "name"].iter().find_map(|key| text_of(&v[key]))
}

/// The user a token of Microsoft's work and school accounts names (a JWT: its middle part is base64url JSON). A
/// personal account's token is opaque, and gives None.
fn jwt_user(token: &str) -> Option<String> {
    use base64::Engine;
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    ["upn", "unique_name", "preferred_username", "email"].iter().find_map(|key| text_of(&claims[key])).filter(|user| user.contains('@'))
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
    wait(ctx, child, Duration::from_secs(900), None).map_err(Ended::message)?;
    binary().map(|_| Value::Null).ok_or_else(missing)
}

/// How a program `wait` waited for ended, when not well.
#[derive(Debug, PartialEq)]
enum Ended {
    /// It failed, saying this last.
    Failed(String),
    Stopped,
    TooLong,
}

impl Ended {
    fn message(self) -> String {
        match self {
            Ended::Failed(error) => error,
            Ended::Stopped => tr("Đã dừng", "Stopped").into(),
            Ended::TooLong => tr("Hết thời gian chờ", "It took too long").into(),
        }
    }
}

/// Waits for a program the user may stop or that may hang, reading what it says on stderr as it goes so a full pipe
/// never blocks it; its last line is the error when it fails. A `hint` replaces the job's text once it has waited
/// that long.
fn wait(ctx: &Ctx, mut child: Child, limit: Duration, hint: Option<(Duration, &str)>) -> Result<(), Ended> {
    let mut stderr = child.stderr.take();
    let said = thread::spawn(move || {
        let mut text = Vec::new();
        if let Some(stderr) = stderr.as_mut() {
            let _ = stderr.read_to_end(&mut text);
        }
        text
    });
    let started = Instant::now();
    let mut hinted = false;
    loop {
        if let Some(status) = child.try_wait().map_err(|e| Ended::Failed(e.to_string()))? {
            let said = said.join().unwrap_or_default();
            return if status.success() { Ok(()) } else { Err(Ended::Failed(last_line(&said))) };
        }
        if ctx.cancelled() || started.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            return Err(if ctx.cancelled() { Ended::Stopped } else { Ended::TooLong });
        }
        if let Some((after, text)) = hint {
            if !hinted && started.elapsed() > after {
                ctx.progress(0, 0, text);
                hinted = true;
            }
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
        let mut child = command()?.args(["cat", &target(uri)?]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
        let out = child.stdout.take().ok_or_else(|| "rclone".to_owned())?;
        Ok(Box::new(Download { child, out }))
    }

    fn write(&self, uri: &Uri) -> Result<Box<dyn Commit>, String> {
        let partial = uri.parent().map(|p| p.join(&format!(".lazyspace-partial-{}", uri.name()))).ok_or_else(|| tr("Không ghi được ở đây", "Nothing can be written here").to_owned())?;
        let mut child = command()?.args(["rcat", &target(&partial)?]).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
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
        let pair = |n: &str, k: &str| (n.to_owned(), k.to_owned());
        assert_eq!(parse_remotes("gdrive:        drive   \nwork onedrive: onedrive\n-bad: drive\n\n"), [pair("gdrive", "drive"), pair("work onedrive", "onedrive")]);
        assert_eq!(parse_remotes("gdrive:\n"), [pair("gdrive", "")]);
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

    #[test]
    fn microsoft_clouds_of_an_organisation_sign_in_as_onedrive_with_their_answers() {
        let none = Advanced::default();
        assert_eq!(create_args("drive", "gd", &none).unwrap(), ["config", "create", "gd", "drive"]);
        assert_eq!(create_args("onedrive", "od", &none).unwrap(), ["config", "create", "od", "onedrive"]);
        let work = create_args("onedrive_work", "work", &none).unwrap();
        assert_eq!(work[..4], ["config", "create", "work", "onedrive"]);
        assert!(work.contains(&"config_type=onedrive".to_owned()));
        assert!(work.iter().any(|a| a.starts_with("access_scopes=") && !a.contains("Sites.")));
        assert!(create_args("sharepoint", "sp", &none).unwrap().contains(&"config_type=sharepoint".to_owned()));
        let site = Advanced { site: " https://contoso.sharepoint.com/sites/team ".into(), ..Advanced::default() };
        let sp = create_args("sharepoint", "sp", &site).unwrap();
        assert!(sp.contains(&"config_type=url".to_owned()) && sp.contains(&"config_site_url=https://contoso.sharepoint.com/sites/team".to_owned()));
        let own = Advanced { client_id: "-id".into(), client_secret: "s=cret".into(), tenant: "contoso.onmicrosoft.com".into(), site: String::new() };
        let args = create_args("onedrive_work", "work", &own).unwrap();
        for arg in ["client_id=-id", "client_secret=s=cret", "tenant=contoso.onmicrosoft.com"] {
            assert!(args.contains(&arg.to_owned()), "{arg}");
        }
        assert!(args.iter().skip(4).all(|a| !a.starts_with('-')), "no value can read as an option");
        assert!(!create_args("drive", "gd", &own).unwrap().iter().any(|a| a.starts_with("tenant=")), "a tenant is Microsoft's");
        assert!(create_args("onedrive", "od", &Advanced { tenant: "a b".into(), ..Advanced::default() }).is_err());
        assert!(create_args("onedrive", "od", &Advanced { client_id: "a\nb".into(), ..Advanced::default() }).is_err());
    }

    #[test]
    fn a_refused_microsoft_sign_in_says_why_and_what_to_do() {
        assert!(needs_admin("AADSTS65001: The user or administrator has not consented") && needs_admin("error=access_denied"));
        assert!(!needs_admin("failed to get token: connection refused"));
        let refused = explain("onedrive_work", Ended::Failed("AADSTS90094: admin approval required".into()));
        assert!(refused.contains("Entra ID") && refused.contains("AADSTS90094"), "{refused}");
        let slow = explain("sharepoint", Ended::TooLong);
        assert!(slow.contains("Client ID") && slow.contains("OneDrive"), "{slow}");
        assert!(!explain("drive", Ended::TooLong).contains("Client ID"));
        assert_eq!(explain("drive", Ended::Failed("x".into())), "x");
        assert_eq!(explain("onedrive", Ended::Failed("network down".into())), "network down");
    }

    #[test]
    fn the_account_of_a_remote_is_read_from_its_cloud_answers() {
        let dump = r#"{"work": {"type": "onedrive", "token": "{\"access_token\":\"abc\",\"expiry\":\"2030-01-01T00:00:00Z\"}", "drive_id": "b!x", "drive_type": "business", "region": "us"},
                      "gd": {"type": "drive", "token": "{}"}, "sp": {"type": "onedrive", "drive_type": "documentLibrary"}}"#;
        let work = Remote::parse(dump, "work").unwrap();
        assert_eq!((work.access_token.as_deref(), work.kind().as_str(), work.graph()), (Some("abc"), "onedrive_work", "https://graph.microsoft.us/v1.0"));
        assert_eq!(Remote::parse(dump, "gd").unwrap().access_token, None);
        assert_eq!(Remote::parse(dump, "sp").unwrap().kind(), "sharepoint");
        assert_eq!(Remote::parse(dump, "missing"), None);
        assert_eq!(Remote::parse("not json", "gd"), None);
        assert_eq!(google_user(&json!({"user": {"displayName": "An", "emailAddress": "an@gmail.com"}})).as_deref(), Some("an@gmail.com"));
        assert_eq!(dropbox_user(&json!({"email": "", "name": {"display_name": "An"}})).as_deref(), Some("An"));
        assert_eq!(box_user(&json!({"login": "an@box.com"})).as_deref(), Some("an@box.com"));
        assert_eq!(graph_user(&json!({"mail": null, "userPrincipalName": "an@contoso.com"})).as_deref(), Some("an@contoso.com"));
        assert_eq!(drive_owner(&json!({"owner": {"user": {"displayName": "An Nguyen"}}})).as_deref(), Some("An Nguyen"));
        assert_eq!(drive_owner(&json!({"owner": {"group": {"displayName": "Team"}}})).as_deref(), Some("Team"));
        assert_eq!(userinfo_user(&json!({"Username": "an"})).as_deref(), Some("an"));
        use base64::Engine;
        let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"upn":"an@contoso.com","name":"An"}"#);
        assert_eq!(jwt_user(&format!("e30.{claims}.sig")).as_deref(), Some("an@contoso.com"));
        assert_eq!(jwt_user("EwBwA8l6BAAU-opaque"), None);
    }

    /// Two remotes of the rclone installed here, as aliases of local folders: a copy from one to the other goes
    /// through `rclone cat` and `rclone rcat`, as one between two cloud accounts does, and a move within one is
    /// rclone's own `moveto`. Skipped where rclone is not installed.
    #[test]
    fn files_go_from_one_remote_to_another() {
        use crate::{jobs::test_ctx, vfs::copy::transfer, vfs::local::tests::Temp, vfs::registry};
        use std::{fs, sync::Arc};
        if binary().is_none() {
            return;
        }
        let t = Temp::new("rclone-across");
        t.file("a/Tài liệu/one.txt", "one");
        t.file("a/two.txt", "two");
        fs::create_dir_all(t.0.join("b")).unwrap();
        let config = t.0.join("rclone.conf");
        fs::write(&config, format!("[one]\ntype = alias\nremote = {}\n\n[two]\ntype = alias\nremote = {}\n", t.0.join("a").display(), t.0.join("b").display())).unwrap();
        CONFIG.set(config).unwrap();
        registry().add("rclone", Arc::new(RcloneProvider));
        let (ctx, _answers, _) = test_ctx();
        let one = |p: &str| Uri::parse(&format!("rclone://one/{p}")).unwrap();
        let two = Uri::parse("rclone://two/").unwrap();
        transfer(&ctx, &[one("Tài liệu"), one("two.txt")], &two, false).unwrap();
        assert_eq!(fs::read_to_string(t.0.join("b/Tài liệu/one.txt")).unwrap(), "one");
        assert_eq!(fs::read_to_string(t.0.join("b/two.txt")).unwrap(), "two");
        assert!(t.0.join("a/two.txt").exists(), "a copy leaves the source");
        assert!(fs::read_dir(t.0.join("b")).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().starts_with(".lazyspace")), "no partial file is left");
        transfer(&ctx, &[one("two.txt")], &one("Tài liệu"), true).unwrap();
        assert!(!t.0.join("a/two.txt").exists() && t.0.join("a/Tài liệu/two.txt").exists(), "a move within a remote");
        transfer(&ctx, &[two.join("two.txt")], &one(""), true).unwrap();
        assert!(!t.0.join("b/two.txt").exists() && fs::read_to_string(t.0.join("a/two.txt")).unwrap() == "two", "a move across remotes");
    }
}
