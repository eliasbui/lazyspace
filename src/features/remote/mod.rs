//! Server connections (W8). A saved connection (connections.json, without its secret, which only the Keychain keeps)
//! is SFTP, FTP or FTPS, S3 or Aliyun OSS, or a network share the system mounts (SMB, AFP, NFS, WebDAV); the clouds
//! come through rclone, whose remotes are listed as rclone keeps them. A place on a server is
//! `<scheme>://<connection id>/<path>`; its provider keeps one session per connection while it is used, and makes a
//! new one when the old one broke.

mod connections;
mod ftp;
mod keychain;
mod netfs;
mod rclone;
mod s3;
mod sftp;
mod storage;

pub use connections::Connection;

use crate::{
    features::archive::NEEDS_PASSWORD,
    ipc::{Dispatcher, args, defer},
    native::workspace,
    tr,
    vfs::{Capabilities, Commit, Entry, Provider, Uri, registry},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, atomic::AtomicBool},
    time::{Duration, Instant},
};

/// The start of an error about a server's key never seen before; its fingerprint follows. The page shows it and
/// calls `remote.trust` when the user accepts it.
pub const NEEDS_TRUST: &str = "LZ-HOSTKEY:";

/// The error that makes the page ask for the secret of a connection (the same start as an archive's).
pub fn needs_password(name: &str) -> String {
    format!("{NEEDS_PASSWORD}{} \"{name}\"", tr("Cần mật khẩu để kết nối", "A password is needed to connect to"))
}

/// Secrets given for this run only, when the Keychain would not keep them, by connection id.
fn given() -> &'static Mutex<HashMap<String, String>> {
    static G: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    G.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The secret of a connection: its password, secret access key, or the passphrase of its key file.
pub fn secret_of(id: &str) -> Option<String> {
    given().lock().ok().and_then(|g| g.get(id).cloned()).or_else(|| keychain::get(id))
}

/// Nanoseconds of the clock, to tell temporary files apart.
pub fn stamp() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos())
}

/// An item of a folder on a server.
pub fn entry(dir: &Uri, name: &str, is_dir: bool, link: bool, size: u64, mtime: i64) -> Entry {
    let ext = if is_dir { String::new() } else { Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default() };
    let icon = if is_dir {
        "type:public.folder".to_owned()
    } else if ext.is_empty() {
        "type:public.data".to_owned()
    } else {
        format!("ext:{ext}")
    };
    Entry {
        name: name.into(),
        uri: dir.join(name).to_string(),
        kind: if link { "link" } else if is_dir { "dir" } else { "file" },
        is_dir,
        size: if is_dir { 0 } else { size },
        mtime,
        ctime: mtime,
        hidden: name.starts_with('.'),
        ext,
        icon,
    }
}

/// The entry of the top of a server, named after its connection.
pub fn folder(uri: &Uri, name: &str) -> Entry {
    Entry { name: name.into(), uri: uri.to_string(), kind: "dir", is_dir: true, size: 0, mtime: 0, ctime: 0, hidden: false, ext: String::new(), icon: "type:public.folder".into() }
}

/// The live sessions of a kind of server, by connection id, made on first use.
pub struct Sessions<T>(Mutex<HashMap<String, Arc<T>>>);

impl<T> Default for Sessions<T> {
    fn default() -> Self {
        Sessions(Mutex::new(HashMap::new()))
    }
}

impl<T> Sessions<T> {
    /// The session of connection `id`, made with `make` when there is none or the one there is `dead`. Connecting
    /// happens outside the lock, so a slow server holds up no other connection.
    pub fn get(&self, id: &str, dead: impl Fn(&T) -> bool, make: impl FnOnce() -> Result<T, String>) -> Result<Arc<T>, String> {
        let live = self.0.lock().map_err(|e| e.to_string())?.get(id).filter(|s| !dead(s)).cloned();
        if let Some(live) = live {
            return Ok(live);
        }
        let made = Arc::new(make()?);
        self.0.lock().map_err(|e| e.to_string())?.insert(id.to_owned(), made.clone());
        Ok(made)
    }

    pub fn put(&self, id: &str, session: T) {
        if let Ok(mut map) = self.0.lock() {
            map.insert(id.to_owned(), Arc::new(session));
        }
    }

    pub fn forget(&self, id: &str) {
        if let Ok(mut map) = self.0.lock() {
            map.remove(id);
        }
    }

    pub fn has(&self, id: &str) -> bool {
        self.0.lock().is_ok_and(|map| map.contains_key(id))
    }
}

/// The provider of `ftp://` and `ftps://`: the pool of the place's connection answers.
struct FtpProvider(Sessions<ftp::Ftp>);

impl FtpProvider {
    fn get(&self, id: &str) -> Result<Arc<ftp::Ftp>, String> {
        self.0.get(id, |_| false, || Ok(ftp::Ftp::new(connections::find(id)?, secret_of(id))))
    }
}

impl Provider for FtpProvider {
    fn capabilities(&self, uri: &Uri) -> Capabilities {
        let _ = uri;
        Capabilities { write: true, rename: true, trash: false, watch: false, sizes: false, local_path: false }
    }
    fn list(&self, uri: &Uri, cancel: &AtomicBool) -> Result<Vec<Entry>, String> {
        self.get(&uri.authority)?.list(uri, cancel)
    }
    fn stat(&self, uri: &Uri) -> Result<Entry, String> {
        self.get(&uri.authority)?.stat(uri)
    }
    fn read(&self, uri: &Uri) -> Result<Box<dyn Read + Send>, String> {
        self.get(&uri.authority)?.read(uri)
    }
    fn write(&self, uri: &Uri) -> Result<Box<dyn Commit>, String> {
        self.get(&uri.authority)?.write(uri)
    }
    fn mkdir(&self, uri: &Uri) -> Result<(), String> {
        self.get(&uri.authority)?.mkdir(uri)
    }
    fn rename(&self, from: &Uri, to: &Uri) -> Result<(), String> {
        self.get(&from.authority)?.rename(from, to)
    }
    fn delete(&self, uri: &Uri, cancel: &AtomicBool) -> Result<(), String> {
        self.get(&uri.authority)?.delete(uri, cancel)
    }
}

struct Providers {
    ftp: Arc<FtpProvider>,
    sftp: Arc<sftp::SftpProvider>,
    s3: Arc<s3::S3Provider>,
    /// The shares mounted from a connection, by id, to eject on disconnect.
    mounts: Mutex<HashMap<String, PathBuf>>,
}

fn providers() -> &'static Providers {
    static P: OnceLock<Providers> = OnceLock::new();
    P.get_or_init(|| Providers { ftp: Arc::new(FtpProvider(Sessions::default())), sftp: Arc::new(sftp::SftpProvider::new()), s3: Arc::new(s3::S3Provider::new()), mounts: Mutex::new(HashMap::new()) })
}

/// Closes the sessions of a connection; the next use connects again with what is saved then.
fn forget(id: &str) {
    let p = providers();
    p.ftp.0.forget(id);
    p.sftp.forget(id);
    p.s3.forget(id);
}

fn live(id: &str) -> bool {
    let p = providers();
    p.ftp.0.has(id) || p.sftp.has(id) || p.s3.has(id) || p.mounts.lock().is_ok_and(|m| m.contains_key(id))
}

/// The place `path` on the server of connection `id`.
fn place(scheme: &str, id: &str, path: &str) -> Result<Uri, String> {
    let mut uri = Uri::parse(&format!("{scheme}://{id}/"))?;
    for part in path.split('/').filter(|p| !p.is_empty()) {
        uri = uri.join(part);
    }
    Ok(uri)
}

/// Connects (or mounts) and gives the place to open: the connection's folder, else the account's own.
fn connect(id: &str) -> Result<Value, String> {
    let conn = connections::find(id)?;
    let start = |home: String| if conn.path.is_empty() { home } else { conn.path.clone() };
    let uri = match conn.scheme.as_str() {
        scheme if connections::MOUNTED.contains(&scheme) => {
            let (root, open) = netfs::mount(&conn, secret_of(id).as_deref())?;
            if let Ok(mut mounts) = providers().mounts.lock() {
                mounts.insert(id.to_owned(), root);
            }
            Uri::file(&open)
        }
        "sftp" => place("sftp", id, &start(providers().sftp.session(id)?.home()?))?,
        "ftp" | "ftps" => place(&conn.scheme, id, &start(providers().ftp.get(id)?.home()?))?,
        scheme => place(scheme, id, &conn.bucket)?,
    };
    Ok(json!({ "uri": uri.to_string() }))
}

/// Tries a connection that may not be saved yet, with the secret typed for it.
fn test(conn: Connection, secret: Option<String>) -> Result<(), String> {
    let conn = connections::clean(conn)?;
    match conn.scheme.as_str() {
        "sftp" => sftp::Sftp::connect(&conn, secret)?.home().map(drop),
        "ftp" | "ftps" => ftp::Ftp::new(conn, secret).home().map(drop),
        "s3" | "oss" => s3::S3::new(conn, secret)?.test(),
        _ => Err(tr("Ổ chia sẻ được thử khi kết nối", "A share is tried by connecting to it").into()),
    }
}

/// Keeps a secret in the Keychain, or for this run only when the Keychain refuses; says whether it was kept for good.
fn keep(id: &str, secret: &str) -> bool {
    let kept = keychain::set(id, secret).is_ok();
    if let Ok(mut g) = given().lock() {
        if kept {
            g.remove(id);
        } else {
            g.insert(id.to_owned(), secret.to_owned());
        }
    }
    kept
}

/// The folder of the cloud a local place is in, if any (src/features/remote/storage.rs).
pub fn cloud_root(path: &Path) -> Option<PathBuf> {
    storage::cloud_root(&dirs::home_dir()?, path)
}

/// When each remote was last asked for its account in this run, so one whose cloud does not answer is asked again a
/// minute later rather than at every listing, or never.
fn asked() -> &'static Mutex<HashMap<String, Instant>> {
    static A: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    A.get_or_init(|| Mutex::new(HashMap::new()))
}

/// How long a remote whose account was not found waits before it is asked again.
const ASK_AGAIN: Duration = Duration::from_secs(60);

/// The names of rclone's remotes, and the account of each as far as it is known, by name. The accounts not known yet
/// are looked up on a thread of their own, one remote after another; every window hears `remote.changed` when they
/// are in, and lists again.
fn rclone_accounts(proxy: &crate::Proxy, listed: &[(String, String)]) -> (Vec<String>, Value) {
    let known = rclone::accounts();
    let mut accounts = serde_json::Map::new();
    let mut missing = Vec::new();
    for (name, backend) in listed {
        // An account kept without a user (from a version that kept the misses too) is asked for again.
        match known.get(name).filter(|a| &a.backend == backend && a.account.is_some()) {
            Some(account) => {
                accounts.insert(name.clone(), json!(account));
            }
            None => {
                accounts.insert(name.clone(), json!({ "backend": backend, "kind": backend, "account": null }));
                let due = asked().lock().is_ok_and(|mut a| {
                    let due = a.get(name).is_none_or(|at| at.elapsed() >= ASK_AGAIN);
                    if due {
                        a.insert(name.clone(), Instant::now());
                    }
                    due
                });
                if due {
                    missing.push(name.clone());
                }
            }
        }
    }
    if !missing.is_empty() {
        let proxy = proxy.clone();
        std::thread::spawn(move || {
            let mut found = false;
            for name in missing {
                // Only a user found is kept: a miss (no network, a token rclone could not renew) is tried again later.
                match rclone::lookup(&name) {
                    Ok(account) if account.account.is_some() => {
                        rclone::remember(&name, account);
                        found = true;
                    }
                    Ok(_) => eprintln!("cloud account: {name}: the cloud did not say who is signed in"),
                    Err(e) => eprintln!("cloud account: {name}: {e}"),
                }
            }
            if found {
                proxy.send(crate::UserEvent::Post { window: None, message: crate::ipc::event("remote.changed", Value::Null) });
            }
        });
    }
    (listed.iter().map(|(name, _)| name.clone()).collect(), Value::Object(accounts))
}

/// The bundle identifiers of Microsoft's OneDrive app: from the App Store, and the one Microsoft hands out itself.
const ONEDRIVE_APPS: [&str; 2] = ["com.microsoft.OneDrive-mac", "com.microsoft.OneDrive"];

/// The OneDrive app on this Mac, by its bundle identifier.
fn onedrive_app() -> Option<&'static str> {
    ONEDRIVE_APPS.into_iter().find(|id| crate::native::workspace::app_name(id).is_some())
}

/// The OneDrive app's page in the App Store, where it installs without an administrator's password.
const ONEDRIVE_STORE: &str = "macappstore://apps.apple.com/app/id823766827";

fn open_store() -> Result<(), String> {
    // A fixed address, given to `open` as one argument, never through a shell.
    let status = std::process::Command::new("/usr/bin/open").arg(ONEDRIVE_STORE).status().map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err(tr("Không mở được App Store", "The App Store did not open").into()) }
}

pub fn register(d: &mut Dispatcher) {
    let p = providers();
    registry().add("ftp", p.ftp.clone());
    registry().add("ftps", p.ftp.clone());
    registry().add("sftp", p.sftp.clone());
    registry().add("s3", p.s3.clone());
    registry().add("oss", p.s3.clone());
    registry().add("rclone", Arc::new(rclone::RcloneProvider));

    d.on("remote.list", |app, _, _| {
        let proxy = app.proxy.clone();
        defer(app, move || {
            let list: Vec<Value> = connections::load(&connections::path())
                .into_iter()
                .filter_map(|c| {
                    let live = live(&c.id);
                    let mut value = serde_json::to_value(c).ok()?;
                    value["live"] = json!(live);
                    Some(value)
                })
                .collect();
            let installed = rclone::binary().is_some();
            let listed = if installed { rclone::listed().unwrap_or_default() } else { Vec::new() };
            let (remotes, accounts) = rclone_accounts(&proxy, &listed);
            Ok(json!({ "connections": list, "rclone": { "installed": installed, "remotes": remotes, "accounts": accounts, "kinds": rclone::KINDS } }))
        })
    });
    d.on("remote.save", |app, _, a| {
        #[derive(Deserialize)]
        struct Save {
            connection: Connection,
            secret: Option<String>,
        }
        let a: Save = args(a)?;
        defer(app, move || {
            let saved = connections::put(&connections::path(), a.connection)?;
            forget(&saved.id);
            let kept = match a.secret.as_deref() {
                Some("") => {
                    keychain::delete(&saved.id);
                    if let Ok(mut g) = given().lock() {
                        g.remove(&saved.id);
                    }
                    true
                }
                Some(secret) => keep(&saved.id, secret),
                None => true,
            };
            Ok(json!({ "connection": saved, "kept": kept }))
        })
    });
    d.on("remote.delete", |app, _, a| {
        #[derive(Deserialize)]
        struct Delete {
            id: String,
        }
        let id = args::<Delete>(a)?.id;
        defer(app, move || {
            connections::remove(&connections::path(), &id)?;
            keychain::delete(&id);
            forget(&id);
            Ok(Value::Null)
        })
    });
    d.on("remote.connect", |app, _, a| {
        #[derive(Deserialize)]
        struct Connect {
            id: String,
        }
        let id = args::<Connect>(a)?.id;
        defer(app, move || connect(&id))
    });
    d.on("remote.disconnect", |app, _, a| {
        #[derive(Deserialize)]
        struct Disconnect {
            id: String,
        }
        let id = args::<Disconnect>(a)?.id;
        forget(&id);
        let mount = providers().mounts.lock().ok().and_then(|mut m| m.remove(&id));
        match mount {
            Some(root) => defer(app, move || workspace::eject(&root).map(|()| Value::Null)),
            None => Ok(Value::Null),
        }
    });
    d.on("remote.test", |app, _, a| {
        #[derive(Deserialize)]
        struct Test {
            connection: Connection,
            secret: Option<String>,
        }
        let a: Test = args(a)?;
        defer(app, move || test(a.connection, a.secret.filter(|s| !s.is_empty())).map(|()| Value::Null))
    });
    d.on("remote.password", |app, _, a| {
        #[derive(Deserialize)]
        struct Password {
            id: String,
            password: String,
        }
        let a: Password = args(a)?;
        defer(app, move || {
            let conn = connections::find(&a.id)?;
            let wrong = |e: String| if e.starts_with(NEEDS_PASSWORD) { tr("Sai mật khẩu", "Wrong password").to_owned() } else { e };
            let p = providers();
            // The session made to check the password is the one the pane then uses.
            match conn.scheme.as_str() {
                "sftp" => p.sftp.put(&a.id, sftp::Sftp::connect(&conn, Some(a.password.clone())).map_err(wrong)?),
                "ftp" | "ftps" => {
                    let ftp = ftp::Ftp::new(conn, Some(a.password.clone()));
                    ftp.home().map_err(wrong)?;
                    p.ftp.0.put(&a.id, ftp);
                }
                "s3" | "oss" => {
                    let s3 = s3::S3::new(conn, Some(a.password.clone()))?;
                    s3.test().map_err(wrong)?;
                    p.s3.put(&a.id, s3);
                }
                _ => {}
            }
            Ok(json!({ "kept": keep(&a.id, &a.password) }))
        })
    });
    d.on("remote.trust", |_, _, a| {
        #[derive(Deserialize)]
        struct Trust {
            host: String,
            port: Option<u16>,
            fingerprint: String,
        }
        let a: Trust = args(a)?;
        if !a.fingerprint.starts_with("SHA256:") {
            return Err(tr("Dấu vân tay không hợp lệ", "Not a valid fingerprint").into());
        }
        sftp::approve(&Connection { host: a.host, port: a.port, ..Default::default() }, &a.fingerprint);
        Ok(Value::Null)
    });
    // The folders of the clouds' own apps (src/features/remote/storage.rs).
    d.on("remote.clouds", |_, _, _| {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
        Ok(json!(storage::clouds(&home).into_iter().map(|c| json!({ "name": c.name, "account": c.account, "service": c.service, "uri": Uri::file(Path::new(&c.path)).to_string() })).collect::<Vec<_>>()))
    });
    // OneDrive through Microsoft's own app: an organisation that lets only approved apps reach its OneDrive approves
    // Microsoft's, so a work or school account signs in there without an administrator; the app keeps the files in
    // ~/Library/CloudStorage, which the Cloud section shows by itself. `remote.onedrive_app` says whether it is on this
    // Mac; `remote.onedrive_open` opens it, or its page in the App Store when it is not.
    d.on("remote.onedrive_app", |_, _, _| Ok(json!({ "installed": onedrive_app().is_some() })));
    d.on("remote.onedrive_open", |_, _, _| match onedrive_app() {
        Some(id) => crate::native::workspace::open_app(id).map(|()| json!({ "opened": "app" })),
        None => open_store().map(|()| json!({ "opened": "store" })),
    });
        // Signing in to a cloud through rclone, and installing rclone first, are jobs: they wait on the browser or on
    // Homebrew, show in the jobs panel, and can be stopped there. The page hears `jobs.finished` with the job's id.
    d.on("remote.rclone_add", |app, window, a| {
        #[derive(Deserialize)]
        struct Add {
            kind: String,
            name: String,
            #[serde(default)]
            advanced: rclone::Advanced,
        }
        let a: Add = args(a)?;
        let title = format!("{} {}", tr("Đăng nhập", "Signing in to"), a.name);
        let job = app.jobs.spawn(&app.proxy, Some(window), "cloud", title, move |ctx| rclone::sign_in(ctx, &a.kind, &a.name, &a.advanced), None);
        Ok(json!({ "job": job }))
    });
    d.on("remote.rclone_install", |app, window, _| {
        let job = app.jobs.spawn(&app.proxy, Some(window), "cloud", tr("Đang cài rclone", "Installing rclone").into(), rclone::install, None);
        Ok(json!({ "job": job }))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_and_entries_of_a_server() {
        let uri = place("sftp", "0123abcd", "/home/an/Tài liệu/").unwrap();
        assert_eq!(uri.to_string(), "sftp://0123abcd/home/an/T%C3%A0i%20li%E1%BB%87u");
        assert_eq!(place("s3", "0123abcd", "").unwrap().to_string(), "s3://0123abcd/");
        let e = entry(&uri, ".env", false, false, 12, 5);
        assert!(e.hidden && e.icon == "type:public.data" && e.kind == "file");
        let d = entry(&uri, "src", true, true, 4096, 5);
        assert!(d.is_dir && d.kind == "link" && d.size == 0);
        assert!(needs_password("NAS").starts_with(NEEDS_PASSWORD));
    }

    #[test]
    fn sessions_are_made_once_and_again_when_dead() {
        let sessions: Sessions<std::cell::Cell<bool>> = Sessions::default();
        let made = std::cell::Cell::new(0);
        let get = |dead: bool| {
            sessions.get("a", |s| dead && s.get(), || {
                made.set(made.get() + 1);
                Ok(std::cell::Cell::new(true))
            })
        };
        get(false).unwrap();
        get(false).unwrap();
        assert_eq!(made.get(), 1);
        get(true).unwrap();
        assert_eq!(made.get(), 2, "a dead session is made again");
        assert!(sessions.has("a"));
        sessions.forget("a");
        assert!(!sessions.has("a"));
    }
}
