//! SFTP through russh. Each connection has a thread of its own running a small tokio runtime that owns the SSH
//! session; the provider's blocking calls send it commands over a channel and wait for the answer, so nothing async
//! leaves this file (design.md section 7.6).
//!
//! A server's key is trusted when ~/.ssh/known_hosts (read, never written) or the app's own known_hosts has it; a key
//! never seen is shown to the user first (`NEEDS_TRUST`), and a key that changed is refused. Signing in tries the
//! connection's key file, else its password, else the keys of ssh-agent and the usual ones in ~/.ssh.

use super::{Connection, NEEDS_TRUST, entry, folder, needs_password};
use crate::{
    features::data_file,
    tr,
    vfs::{Capabilities, Commit, Entry, Provider, Uri, local::partial_of},
};
use russh::{
    Disconnect, client,
    keys::{self, HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate, known_hosts},
};
use russh_sftp::client::SftpSession;
use std::{
    collections::HashSet,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
        mpsc as std_mpsc,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::mpsc,
};

type Reply<T> = std_mpsc::Sender<Result<T, String>>;

/// What the stat of an item says: a link also says whether it leads to a folder.
#[derive(Debug, Clone)]
struct Attrs {
    dir: bool,
    link: bool,
    size: u64,
    mtime: i64,
}

enum Chunk {
    Data(Vec<u8>),
    End,
}

enum Cmd {
    List(String, Reply<Vec<(String, Attrs)>>),
    Stat(String, Reply<Attrs>),
    Mkdir(String, Reply<()>),
    Rename(String, String, Reply<()>),
    Remove(String, bool, Reply<()>),
    Home(Reply<String>),
    /// Opens the file (the first reply), then sends its bytes in pieces until the end or until the reader goes.
    Read(String, mpsc::Sender<Result<Vec<u8>, String>>, Reply<()>),
    /// Creates the file (the first reply), writes what comes until `End`, and answers once it is closed; without
    /// `End` the file is removed.
    Write(String, mpsc::Receiver<Chunk>, Reply<()>, Reply<()>),
}

/// Keys the user accepted, by host, port and fingerprint, waiting for the next connection to learn them.
fn approved() -> &'static Mutex<HashSet<(String, u16, String)>> {
    static A: OnceLock<Mutex<HashSet<(String, u16, String)>>> = OnceLock::new();
    A.get_or_init(|| Mutex::new(HashSet::new()))
}

/// The user accepted the key with `fingerprint` for the server of `conn`.
pub fn approve(conn: &Connection, fingerprint: &str) {
    if let Ok(mut a) = approved().lock() {
        a.insert((conn.host.clone(), conn.port.unwrap_or(22), fingerprint.to_owned()));
    }
}

fn app_known_hosts() -> PathBuf {
    data_file("known_hosts")
}

#[derive(Debug, Clone, PartialEq)]
enum Seen {
    Fine,
    Unknown(String),
    Changed,
}

struct Check {
    host: String,
    port: u16,
    seen: Arc<Mutex<Seen>>,
}

impl client::Handler for Check {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let PublicKeyOrCertificate::PublicKey { key, .. } = key else { return Ok(false) };
        let seen = trust(&self.host, self.port, key, &[dirs::home_dir().unwrap_or_default().join(".ssh/known_hosts"), app_known_hosts()]);
        let fine = seen == Seen::Fine;
        if let Ok(mut s) = self.seen.lock() {
            *s = seen;
        }
        Ok(fine)
    }
}

/// Whether a server's key is known in one of the `files` (or was just approved, and is then learnt into the app's
/// own), never seen, or changed.
fn trust(host: &str, port: u16, key: &PublicKey, files: &[PathBuf]) -> Seen {
    for file in files {
        match known_hosts::check_known_hosts_path(host, port, key, file) {
            Ok(true) => return Seen::Fine,
            Err(keys::Error::KeyChanged { .. }) => return Seen::Changed,
            _ => {}
        }
    }
    let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
    let accepted = approved().lock().is_ok_and(|mut a| a.remove(&(host.to_owned(), port, fingerprint.clone())));
    if accepted {
        if let Some(own) = files.last() {
            if let Some(dir) = own.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = known_hosts::learn_known_hosts_path(host, port, key, own);
        }
        return Seen::Fine;
    }
    Seen::Unknown(fingerprint)
}

fn expand(path: &str) -> PathBuf {
    match path.strip_prefix("~/") {
        Some(rest) => dirs::home_dir().unwrap_or_default().join(rest),
        None => PathBuf::from(path),
    }
}

async fn sign_in(handle: &mut client::Handle<Check>, conn: &Connection, secret: Option<&str>) -> Result<(), String> {
    let user = conn.user.as_str();
    let rsa = handle.best_supported_rsa_hash().await.ok().flatten().flatten();
    let with = |key: PrivateKey| PrivateKeyWithHashAlg::new(Arc::new(key), rsa);
    let denied = || format!("{} \"{}\"", tr("Máy chủ không nhận khóa của", "The server refused the key of"), conn.name);
    if !conn.key_file.is_empty() {
        let file = expand(&conn.key_file);
        let key = match keys::load_secret_key(&file, secret) {
            Ok(key) => key,
            Err(keys::Error::KeyIsEncrypted) => return Err(needs_password(&conn.name)),
            Err(e) => return Err(format!("\"{}\": {e}", file.display())),
        };
        return match handle.authenticate_publickey(user, with(key)).await {
            Ok(r) if r.success() => Ok(()),
            _ => Err(denied()),
        };
    }
    if let Some(password) = secret {
        return match handle.authenticate_password(user, password).await {
            Ok(r) if r.success() => Ok(()),
            _ => Err(needs_password(&conn.name)),
        };
    }
    if let Ok(mut agent) = keys::agent::client::AgentClient::connect_env().await {
        for identity in agent.request_identities().await.unwrap_or_default() {
            let key = identity.public_key().into_owned();
            if handle.authenticate_publickey_with(user, key, rsa, &mut agent).await.is_ok_and(|r| r.success()) {
                return Ok(());
            }
        }
    }
    let ssh = dirs::home_dir().unwrap_or_default().join(".ssh");
    for name in ["id_ed25519", "id_ecdsa", "id_rsa"] {
        if let Ok(key) = keys::load_secret_key(ssh.join(name), None) {
            if handle.authenticate_publickey(user, with(key)).await.is_ok_and(|r| r.success()) {
                return Ok(());
            }
        }
    }
    Err(needs_password(&conn.name))
}

async fn open(conn: &Connection, secret: Option<&str>) -> Result<(client::Handle<Check>, SftpSession), String> {
    let port = conn.port.unwrap_or(22);
    let host = conn.host.trim_start_matches('[').trim_end_matches(']').to_owned();
    let config = Arc::new(client::Config { keepalive_interval: Some(Duration::from_secs(30)), keepalive_max: 3, ..Default::default() });
    let seen = Arc::new(Mutex::new(Seen::Fine));
    let check = Check { host: conn.host.clone(), port, seen: seen.clone() };
    let lost = |e: &dyn std::fmt::Display| format!("{} \"{}\": {e}", tr("Không kết nối được", "Could not connect to"), conn.name);
    let mut handle = match client::connect(config, (host.as_str(), port), check).await {
        Ok(handle) => handle,
        Err(e) => {
            return Err(match seen.lock().map(|s| s.clone()).unwrap_or(Seen::Fine) {
                Seen::Unknown(fingerprint) => format!("{NEEDS_TRUST}{fingerprint}"),
                Seen::Changed => format!(
                    "{} \"{}\" {}",
                    tr("Khóa của máy chủ", "The key of the server"),
                    conn.host,
                    tr("đã đổi so với lần trước. Có thể có người đang chen vào giữa; LazySpace không kết nối.", "changed since last time. Someone may be in the middle; LazySpace does not connect.")
                ),
                Seen::Fine => lost(&e),
            });
        }
    };
    sign_in(&mut handle, conn, secret).await?;
    let channel = handle.channel_open_session().await.map_err(|e| lost(&e))?;
    channel.request_subsystem(true, "sftp").await.map_err(|e| lost(&e))?;
    let sftp = SftpSession::new(channel.into_stream()).await.map_err(|e| lost(&e))?;
    Ok((handle, sftp))
}

fn error(path: &str, e: &russh_sftp::client::error::Error) -> String {
    let name = path.rsplit('/').find(|p| !p.is_empty()).unwrap_or(path);
    format!("\"{name}\": {e}")
}

async fn stat(sftp: &SftpSession, path: &str) -> Result<Attrs, String> {
    let meta = sftp.symlink_metadata(path).await.map_err(|e| error(path, &e))?;
    let link = meta.is_symlink();
    let dir = if link { sftp.metadata(path).await.is_ok_and(|m| m.is_dir()) } else { meta.is_dir() };
    Ok(Attrs { dir, link, size: meta.len(), mtime: meta.mtime.map_or(0, i64::from) })
}

async fn run(sftp: Arc<SftpSession>, cmd: Cmd) {
    match cmd {
        Cmd::List(path, reply) => {
            let listed = async {
                let mut out = Vec::new();
                for item in sftp.read_dir(path.as_str()).await.map_err(|e| error(&path, &e))? {
                    let name = item.file_name();
                    if name == "." || name == ".." {
                        continue;
                    }
                    let meta = item.metadata();
                    let link = meta.is_symlink();
                    let dir = if link { sftp.metadata(format!("{}/{name}", path.trim_end_matches('/'))).await.is_ok_and(|m| m.is_dir()) } else { meta.is_dir() };
                    out.push((name, Attrs { dir, link, size: meta.len(), mtime: meta.mtime.map_or(0, i64::from) }));
                }
                Ok(out)
            };
            let _ = reply.send(listed.await);
        }
        Cmd::Stat(path, reply) => {
            let _ = reply.send(stat(&sftp, &path).await);
        }
        Cmd::Mkdir(path, reply) => {
            let _ = reply.send(sftp.create_dir(path.as_str()).await.map_err(|e| error(&path, &e)));
        }
        Cmd::Rename(from, to, reply) => {
            let _ = reply.send(sftp.rename(from.as_str(), to.as_str()).await.map_err(|e| error(&from, &e)));
        }
        Cmd::Remove(path, dir, reply) => {
            let removed = if dir { sftp.remove_dir(path.as_str()).await } else { sftp.remove_file(path.as_str()).await };
            let _ = reply.send(removed.map_err(|e| error(&path, &e)));
        }
        Cmd::Home(reply) => {
            let _ = reply.send(sftp.canonicalize(".").await.map_err(|e| error(".", &e)));
        }
        Cmd::Read(path, pieces, opened) => {
            let mut file = match sftp.open(path.as_str()).await {
                Ok(file) => file,
                Err(e) => {
                    let _ = opened.send(Err(error(&path, &e)));
                    return;
                }
            };
            let _ = opened.send(Ok(()));
            let mut buf = vec![0u8; 256 << 10];
            loop {
                match file.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if pieces.send(Ok(buf[..n].to_vec())).await.is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        let _ = pieces.send(Err(format!("\"{path}\": {e}"))).await;
                        break;
                    }
                }
            }
        }
        Cmd::Write(path, mut pieces, created, done) => {
            let mut file = match sftp.create(path.as_str()).await {
                Ok(file) => file,
                Err(e) => {
                    let _ = created.send(Err(error(&path, &e)));
                    return;
                }
            };
            let _ = created.send(Ok(()));
            let mut ended = false;
            let mut failed = None;
            while let Some(piece) = pieces.recv().await {
                match piece {
                    Chunk::Data(bytes) => {
                        if let Err(e) = file.write_all(&bytes).await {
                            failed = Some(format!("\"{path}\": {e}"));
                            break;
                        }
                    }
                    Chunk::End => {
                        ended = true;
                        break;
                    }
                }
            }
            let closed = file.shutdown().await;
            drop(file);
            let result = match (failed, closed) {
                (Some(e), _) => Err(e),
                (None, Err(e)) => Err(format!("\"{path}\": {e}")),
                (None, Ok(())) if ended => Ok(()),
                (None, Ok(())) => Err(tr("Đã hủy", "Cancelled").into()),
            };
            if result.is_err() {
                let _ = sftp.remove_file(path.as_str()).await;
            }
            let _ = done.send(result);
        }
    }
}

/// Runs the connection: answers commands, each in a task of its own, until every sender is gone or the server hangs
/// up.
async fn serve(conn: Connection, secret: Option<String>, mut commands: mpsc::UnboundedReceiver<Cmd>, ready: Reply<()>) {
    let (handle, sftp) = match tokio::time::timeout(Duration::from_secs(45), open(&conn, secret.as_deref())).await {
        Ok(Ok(pair)) => pair,
        Ok(Err(e)) => {
            let _ = ready.send(Err(e));
            return;
        }
        Err(_) => {
            let _ = ready.send(Err(format!("\"{}\": {}", conn.name, tr("máy chủ không trả lời", "the server did not answer"))));
            return;
        }
    };
    let _ = ready.send(Ok(()));
    let sftp = Arc::new(sftp);
    loop {
        tokio::select! {
            command = commands.recv() => match command {
                Some(command) => drop(tokio::spawn(run(sftp.clone(), command))),
                None => break,
            },
            () = tokio::time::sleep(Duration::from_secs(5)) => if handle.is_closed() { break },
        }
    }
    let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
}

/// A live SFTP connection.
pub struct Sftp {
    commands: mpsc::UnboundedSender<Cmd>,
}

fn gone() -> String {
    tr("Mất kết nối tới máy chủ", "The connection to the server was lost").into()
}

impl Sftp {
    /// Connects, checks the server's key and signs in; an error starting with `NEEDS_PASSWORD` or `NEEDS_TRUST` wants
    /// the user.
    pub fn connect(conn: &Connection, secret: Option<String>) -> Result<Sftp, String> {
        let (commands, receiver) = mpsc::unbounded_channel();
        let (ready, started) = std_mpsc::channel();
        let conn = conn.clone();
        std::thread::Builder::new()
            .name(format!("sftp {}", conn.host))
            .spawn(move || match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                Ok(runtime) => runtime.block_on(serve(conn, secret, receiver, ready)),
                Err(e) => drop(ready.send(Err(e.to_string()))),
            })
            .map_err(|e| e.to_string())?;
        started.recv().map_err(|_| gone())??;
        Ok(Sftp { commands })
    }

    /// Whether the connection ended, so the next call must make a new one.
    pub fn closed(&self) -> bool {
        self.commands.is_closed()
    }

    fn ask<T>(&self, make: impl FnOnce(Reply<T>) -> Cmd) -> Result<T, String> {
        let (reply, answer) = std_mpsc::channel();
        self.commands.send(make(reply)).map_err(|_| gone())?;
        answer.recv().map_err(|_| gone())?
    }

    pub fn home(&self) -> Result<String, String> {
        self.ask(Cmd::Home)
    }
}

/// The provider of `sftp://<connection id>/path`.
pub struct SftpProvider {
    sessions: super::Sessions<Sftp>,
}

impl SftpProvider {
    pub fn new() -> SftpProvider {
        SftpProvider { sessions: super::Sessions::default() }
    }

    pub fn session(&self, id: &str) -> Result<Arc<Sftp>, String> {
        self.sessions.get(id, |s| s.closed(), || Sftp::connect(&super::connections::find(id)?, super::secret_of(id)))
    }

    pub fn forget(&self, id: &str) {
        self.sessions.forget(id);
    }

    pub fn put(&self, id: &str, session: Sftp) {
        self.sessions.put(id, session);
    }

    pub fn has(&self, id: &str) -> bool {
        self.sessions.has(id)
    }

    /// Runs `f` on the connection of `uri`, once more on a new one if the old one turned out to be closed.
    fn call<T>(&self, uri: &Uri, f: impl Fn(&Sftp) -> Result<T, String>) -> Result<T, String> {
        let session = self.session(&uri.authority)?;
        match f(&session) {
            Err(_) if session.closed() => f(&*self.session(&uri.authority)?),
            result => result,
        }
    }

    fn attrs(&self, uri: &Uri) -> Result<Attrs, String> {
        self.call(uri, |s| s.ask(|r| Cmd::Stat(uri.path.clone(), r)))
    }

    fn exists(&self, uri: &Uri) -> Result<(), String> {
        match self.attrs(uri) {
            Ok(_) => Err(format!("\"{}\": {}", uri.name(), tr("đã có một mục cùng tên", "an item with that name is already there"))),
            Err(_) => Ok(()),
        }
    }
}

impl Provider for SftpProvider {
    fn capabilities(&self, _: &Uri) -> Capabilities {
        Capabilities { write: true, rename: true, trash: false, watch: false, sizes: false, local_path: false }
    }

    fn list(&self, uri: &Uri, _cancel: &AtomicBool) -> Result<Vec<Entry>, String> {
        let items = self.call(uri, |s| s.ask(|r| Cmd::List(uri.path.clone(), r)))?;
        Ok(items.into_iter().map(|(name, a)| entry(uri, &name, a.dir, a.link, a.size, a.mtime)).collect())
    }

    fn stat(&self, uri: &Uri) -> Result<Entry, String> {
        let a = self.attrs(uri)?;
        match uri.parent() {
            Some(parent) => Ok(entry(&parent, &uri.name(), a.dir, a.link, a.size, a.mtime)),
            None => Ok(folder(uri, "/")),
        }
    }

    fn read(&self, uri: &Uri) -> Result<Box<dyn Read + Send>, String> {
        let session = self.session(&uri.authority)?;
        let (sender, pieces) = mpsc::channel(4);
        session.ask(|r| Cmd::Read(uri.path.clone(), sender, r))?;
        Ok(Box::new(Download { pieces, piece: Vec::new(), at: 0, _session: session }))
    }

    fn write(&self, uri: &Uri) -> Result<Box<dyn Commit>, String> {
        let session = self.session(&uri.authority)?;
        let partial = partial_of(Path::new(&uri.path)).to_string_lossy().into_owned();
        let (pieces, receiver) = mpsc::channel(8);
        let (done, finished) = std_mpsc::channel();
        session.ask(|r| Cmd::Write(partial.clone(), receiver, r, done))?;
        Ok(Box::new(Upload { pieces: Some(pieces), finished, partial, target: uri.clone(), session }))
    }

    fn mkdir(&self, uri: &Uri) -> Result<(), String> {
        self.call(uri, |s| s.ask(|r| Cmd::Mkdir(uri.path.clone(), r)))
    }

    fn rename(&self, from: &Uri, to: &Uri) -> Result<(), String> {
        self.exists(to)?;
        self.call(from, |s| s.ask(|r| Cmd::Rename(from.path.clone(), to.path.clone(), r)))
    }

    fn delete(&self, uri: &Uri, cancel: &AtomicBool) -> Result<(), String> {
        if uri.parent().is_none() {
            return Err(tr("Không xóa được thư mục gốc", "The top folder cannot be deleted").into());
        }
        let a = self.attrs(uri)?;
        if a.dir && !a.link {
            for child in self.list(uri, cancel)? {
                if cancel.load(Ordering::Relaxed) {
                    return Err(tr("Đã hủy", "Cancelled").into());
                }
                self.delete(&uri.join(&child.name), cancel)?;
            }
        }
        self.call(uri, |s| s.ask(|r| Cmd::Remove(uri.path.clone(), a.dir && !a.link, r)))
    }
}

/// A download in pieces from the connection's thread. It holds the connection, so the thread lives while it reads.
struct Download {
    pieces: mpsc::Receiver<Result<Vec<u8>, String>>,
    piece: Vec<u8>,
    at: usize,
    _session: Arc<Sftp>,
}

impl Read for Download {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        while self.at >= self.piece.len() {
            match self.pieces.blocking_recv() {
                Some(Ok(piece)) => {
                    self.piece = piece;
                    self.at = 0;
                }
                Some(Err(e)) => return Err(io::Error::other(e)),
                None => return Ok(0),
            }
        }
        let n = buf.len().min(self.piece.len() - self.at);
        buf[..n].copy_from_slice(&self.piece[self.at..self.at + n]);
        self.at += n;
        Ok(n)
    }
}

/// An upload to a partial name beside the target, moved onto it by `commit`; dropped without `commit`, the thread
/// removes the partial file.
struct Upload {
    pieces: Option<mpsc::Sender<Chunk>>,
    finished: std_mpsc::Receiver<Result<(), String>>,
    partial: String,
    target: Uri,
    session: Arc<Sftp>,
}

impl Write for Upload {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let pieces = self.pieces.as_ref().ok_or_else(|| io::Error::other(gone()))?;
        // The thread stops taking pieces when writing failed; its answer says why.
        pieces.blocking_send(Chunk::Data(buf.to_vec())).map_err(|_| io::Error::other(match self.finished.try_recv() {
            Ok(Err(e)) => e,
            _ => gone(),
        }))?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Commit for Upload {
    fn commit(mut self: Box<Self>) -> Result<(), String> {
        let pieces = self.pieces.take().ok_or_else(gone)?;
        pieces.blocking_send(Chunk::End).map_err(|_| gone())?;
        drop(pieces);
        self.finished.recv().map_err(|_| gone())??;
        let s = &self.session;
        // SFTP's rename does not replace, so a file being saved over is removed first.
        let mut moved = s.ask(|r| Cmd::Rename(self.partial.clone(), self.target.path.clone(), r));
        if moved.is_err() && s.ask(|r| Cmd::Stat(self.target.path.clone(), r)).is_ok_and(|a| !a.dir) {
            moved = s.ask(|r| Cmd::Remove(self.target.path.clone(), false, r)).and_then(|()| s.ask(|r| Cmd::Rename(self.partial.clone(), self.target.path.clone(), r)));
        }
        if moved.is_err() {
            let _ = s.ask(|r| Cmd::Remove(self.partial.clone(), false, r));
        }
        moved
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;

    #[test]
    fn a_key_is_known_unknown_changed_or_approved() {
        let t = Temp::new("known-hosts");
        let key = keys::parse_public_key_base64("AAAAC3NzaC1lZDI1NTE5AAAAIHwwIURrs6LTW3M3GZdZURNmcyvhcZeDV5+wqqiPgWtG").unwrap();
        let other = keys::parse_public_key_base64("AAAAC3NzaC1lZDI1NTE5AAAAIOA08Efe1foIVgzLtqjbbiDZV2KuaxdBtH47XsG9FqoJ").unwrap();
        let user = t.file("user_known_hosts", "nas.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHwwIURrs6LTW3M3GZdZURNmcyvhcZeDV5+wqqiPgWtG\n");
        let own = t.0.join("app/known_hosts");
        let files = [user, own.clone()];
        assert_eq!(trust("nas.local", 22, &key, &files), Seen::Fine);
        assert_eq!(trust("nas.local", 22, &other, &files), Seen::Changed, "a known host with another key is refused");
        let Seen::Unknown(fingerprint) = trust("vps.example.com", 2222, &key, &files) else { panic!("a new host is unknown") };
        assert!(fingerprint.starts_with("SHA256:"), "{fingerprint}");
        approve(&Connection { host: "vps.example.com".into(), port: Some(2222), ..Default::default() }, &fingerprint);
        assert_eq!(trust("vps.example.com", 2222, &key, &files), Seen::Fine, "an approved key is accepted and learnt");
        assert!(std::fs::read_to_string(&own).unwrap().contains("[vps.example.com]:2222"));
        assert_eq!(trust("vps.example.com", 2222, &key, &files), Seen::Fine, "and known from then on");
    }

    /// A round trip with a real server, run by hand: `LZ_TEST_SFTP=user@host[:port] cargo test sftp_roundtrip --
    /// --ignored`, signing in with `LZ_TEST_SFTP_KEY`, `LZ_TEST_SFTP_PASSWORD`, ssh-agent or a key of ~/.ssh, in the
    /// folder `LZ_TEST_SFTP_DIR` or the account's own.
    #[test]
    #[ignore]
    fn sftp_roundtrip_small_file() {
        let Ok(target) = std::env::var("LZ_TEST_SFTP") else { return };
        let (user, host) = target.split_once('@').unwrap_or(("", &target));
        let (host, port) = host.split_once(':').map_or((host, None), |(h, p)| (h, p.parse().ok()));
        let conn = Connection { name: "test".into(), scheme: "sftp".into(), host: host.into(), port, user: user.into(), key_file: std::env::var("LZ_TEST_SFTP_KEY").unwrap_or_default(), ..Default::default() };
        let session = match Sftp::connect(&conn, std::env::var("LZ_TEST_SFTP_PASSWORD").ok()) {
            Err(e) if e.starts_with(NEEDS_TRUST) => {
                approve(&conn, &e[NEEDS_TRUST.len()..]);
                Sftp::connect(&conn, std::env::var("LZ_TEST_SFTP_PASSWORD").ok()).unwrap()
            }
            other => other.unwrap(),
        };
        let provider = SftpProvider::new();
        provider.put("test", session);
        // A folder for the test on the server: the one `LZ_TEST_SFTP_DIR` names, else the account's own.
        let base = std::env::var("LZ_TEST_SFTP_DIR").unwrap_or_else(|_| provider.session("test").unwrap().home().unwrap());
        let home = Uri { scheme: "sftp".into(), authority: "test".into(), path: base };
        let dir = home.join(&format!("lazyspace-test-{}", std::process::id()));
        provider.mkdir(&dir).unwrap();
        let file = dir.join("Tài liệu.txt");
        let mut w = provider.write(&file).unwrap();
        w.write_all(&vec![7u8; 3 << 20]).unwrap();
        w.commit().unwrap();
        let mut back = Vec::new();
        provider.read(&file).unwrap().read_to_end(&mut back).unwrap();
        assert_eq!(back.len(), 3 << 20);
        let mut w = provider.write(&file).unwrap();
        w.write_all(b"saved over").unwrap();
        w.commit().unwrap();
        assert_eq!(provider.stat(&file).unwrap().size, 10, "a save replaces the file");
        provider.rename(&file, &dir.join("b.txt")).unwrap();
        assert_eq!(provider.list(&dir, &AtomicBool::new(false)).unwrap().iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["b.txt"]);
        let dropped = provider.write(&dir.join("c.txt")).unwrap();
        drop(dropped);
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(provider.list(&dir, &AtomicBool::new(false)).unwrap().len(), 1, "an upload dropped early leaves nothing");
        provider.delete(&dir, &AtomicBool::new(false)).unwrap();
        assert!(provider.stat(&dir).is_err());
    }
}
