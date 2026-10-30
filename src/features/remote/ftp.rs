//! FTP, and FTPS with explicit TLS (`AUTH TLS`), through suppaftp. A control connection does one thing at a time, so
//! each call takes one from a small pool, opening one when none is free, and a reader or writer keeps its own until it
//! is done with it. A connection the server closed while it idled is replaced once.

use super::{Connection, entry, folder, needs_password};
use crate::{
    tr,
    vfs::{Capabilities, Commit, Entry, Provider, Uri, local::partial_of},
};
use std::{
    io::{self, Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, UNIX_EPOCH},
};
use suppaftp::{FtpError, FtpResult, ImplFtpStream, NativeTlsConnector, NativeTlsFtpStream, Status, TlsStream, TransferStream, list::{File, ListParser}, native_tls::TlsConnector, types::FileType};

type Stream = NativeTlsFtpStream;
type Idle<T> = Arc<Mutex<Vec<ImplFtpStream<T>>>>;

/// How long a reply may take before the connection counts as lost.
const TIMEOUT: Duration = Duration::from_secs(30);
/// The most idle connections kept open.
const IDLE: usize = 3;

pub struct Ftp {
    conn: Connection,
    secret: Option<String>,
    idle: Idle<Tls>,
    /// The server answered that it has no MLSD or no MLST, so listings and lookups use LIST instead.
    no_mlsd: AtomicBool,
    no_mlst: AtomicBool,
}

/// The TLS type of a stream, so the pool and the transfers can name it (suppaftp keeps it private).
trait Pool {
    type Tls: TlsStream;
}
impl<T: TlsStream> Pool for ImplFtpStream<T> {
    type Tls = T;
}
type Tls = <Stream as Pool>::Tls;

/// Whether the error means the control connection is gone, rather than a refusal of the server.
fn broken(e: &FtpError) -> bool {
    match e {
        FtpError::ConnectionError(_) | FtpError::BadResponse | FtpError::SecureError(_) => true,
        FtpError::UnexpectedResponse(r) => r.status == Status::NotAvailable,
        _ => false,
    }
}

/// Whether the server does not know the command.
fn unsupported(e: &FtpError) -> bool {
    matches!(e, FtpError::UnexpectedResponse(r) if matches!(r.status, Status::BadCommand | Status::BadArguments | Status::NotImplemented | Status::NotImplementedParameter))
}

fn error(path: &str, e: &FtpError) -> String {
    let name = path.rsplit('/').find(|p| !p.is_empty()).unwrap_or(path);
    match e {
        FtpError::UnexpectedResponse(r) => format!("\"{name}\": {} {}", tr("máy chủ trả lời", "the server said"), String::from_utf8_lossy(&r.body).trim()),
        FtpError::ConnectionError(e) => format!("{}: {e}", tr("Mất kết nối tới máy chủ", "The connection to the server was lost")),
        other => other.to_string(),
    }
}

fn give<T: TlsStream>(idle: &Idle<T>, stream: ImplFtpStream<T>) {
    if let Ok(mut idle) = idle.lock() {
        if idle.len() < IDLE {
            idle.push(stream);
            return;
        }
    }
    let mut stream = stream;
    let _ = stream.quit();
}

impl Ftp {
    pub fn new(conn: Connection, secret: Option<String>) -> Ftp {
        Ftp { conn, secret, idle: Arc::new(Mutex::new(Vec::new())), no_mlsd: AtomicBool::new(false), no_mlst: AtomicBool::new(false) }
    }

    /// Opens a control connection and signs in; anonymously when the connection has no user.
    fn open(&self) -> Result<Stream, String> {
        let host = self.conn.host.trim_start_matches('[').trim_end_matches(']');
        let lost = |e: &dyn std::fmt::Display| format!("{} \"{}\": {e}", tr("Không kết nối được", "Could not connect to"), self.conn.name);
        let addr = (host, self.conn.port.unwrap_or(21)).to_socket_addrs().map_err(|e| lost(&e))?.next().ok_or_else(|| lost(&"no address"))?;
        let stream = Stream::connect_timeout(addr, Duration::from_secs(15)).map_err(|e| lost(&e))?;
        let mut stream = stream.passive_stream_builder(|addr| {
            let data = TcpStream::connect_timeout(&addr, Duration::from_secs(15)).map_err(FtpError::ConnectionError)?;
            let _ = data.set_read_timeout(Some(TIMEOUT));
            let _ = data.set_write_timeout(Some(TIMEOUT));
            Ok(data)
        });
        // A server behind NAT often names its private address for the data connection; its public one is used.
        stream.set_passive_nat_workaround(true);
        let _ = stream.get_ref().set_read_timeout(Some(TIMEOUT));
        let _ = stream.get_ref().set_write_timeout(Some(TIMEOUT));
        if self.conn.scheme == "ftps" {
            let tls = TlsConnector::new().map_err(|e| lost(&e))?;
            stream = stream.into_secure(NativeTlsConnector::from(tls), host).map_err(|e| lost(&e))?;
        }
        let (user, password) = if self.conn.user.is_empty() {
            ("anonymous".to_owned(), "anonymous@".to_owned())
        } else {
            (self.conn.user.clone(), self.secret.clone().ok_or_else(|| needs_password(&self.conn.name))?)
        };
        match stream.login(&user, &password) {
            Ok(()) => {}
            Err(FtpError::UnexpectedResponse(r)) if matches!(r.status, Status::NotLoggedIn | Status::InvalidCredentials) && !self.conn.user.is_empty() => return Err(needs_password(&self.conn.name)),
            Err(e) => return Err(lost(&error("/", &e))),
        }
        stream.transfer_type(FileType::Binary).map_err(|e| lost(&e))?;
        Ok(stream)
    }

    /// A connection of the pool, and whether it was idle (so may have been closed by the server meanwhile).
    fn take(&self) -> Result<(Stream, bool), String> {
        if let Some(stream) = self.idle.lock().ok().and_then(|mut idle| idle.pop()) {
            return Ok((stream, true));
        }
        Ok((self.open()?, false))
    }

    /// Runs `f` on a connection of the pool. The outer error is about connecting; the inner one is the command's.
    fn with<T>(&self, f: impl Fn(&mut Stream) -> FtpResult<T>) -> Result<FtpResult<T>, String> {
        let mut retried = false;
        loop {
            // After one idle connection turned out closed the others likely are too, so the retry opens a new one.
            let (mut stream, was_idle) = if retried { (self.open()?, false) } else { self.take()? };
            let result = f(&mut stream);
            match &result {
                Err(e) if broken(e) && was_idle && !retried => {
                    retried = true;
                    continue;
                }
                Err(e) if broken(e) => {}
                _ => give(&self.idle, stream),
            }
            return Ok(result);
        }
    }

    fn run<T>(&self, path: &str, f: impl Fn(&mut Stream) -> FtpResult<T>) -> Result<T, String> {
        self.with(f)?.map_err(|e| error(path, &e))
    }

    /// The start folder of the account: where the server put us after signing in.
    pub fn home(&self) -> Result<String, String> {
        self.run("/", |s| s.pwd())
    }

    fn files(&self, path: &str) -> Result<Vec<File>, String> {
        if !self.no_mlsd.load(Ordering::Relaxed) {
            match self.with(|s| s.mlsd(Some(path)))? {
                Ok(lines) => return Ok(lines.iter().filter_map(|l| ListParser::parse_mlsd(l).ok()).collect()),
                Err(e) if unsupported(&e) => self.no_mlsd.store(true, Ordering::Relaxed),
                Err(e) => return Err(error(path, &e)),
            }
        }
        // LIST is given no path, which some servers would take for options; the folder is entered first.
        let lines = self.run(path, |s| {
            s.cwd(path)?;
            s.list(None)
        })?;
        Ok(lines.iter().filter_map(|l| File::try_from(l.as_str()).ok()).collect())
    }
}

/// The entry of `name` in the folder `dir`, as a listing or MLST describes it.
fn entry_of(dir: &Uri, name: &str, file: &File) -> Entry {
    let mtime = file.modified().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
    // A link's target is not looked up: one whose target ends in a slash opens as a folder.
    let link_to_dir = file.symlink().is_some_and(|t| t.to_string_lossy().ends_with('/'));
    entry(dir, name, file.is_directory() || link_to_dir, file.is_symlink(), file.size() as u64, mtime)
}

impl Provider for Ftp {
    fn capabilities(&self, _: &Uri) -> Capabilities {
        Capabilities { write: true, rename: true, trash: false, watch: false, sizes: false, local_path: false }
    }

    fn list(&self, uri: &Uri, _cancel: &AtomicBool) -> Result<Vec<Entry>, String> {
        // MLSD also lists the folder itself and its parent, under "." and ".." or under their paths.
        Ok(self.files(&uri.path)?.iter().filter(|f| f.name() != "." && f.name() != ".." && !f.name().contains('/')).map(|f| entry_of(uri, f.name(), f)).collect())
    }

    fn stat(&self, uri: &Uri) -> Result<Entry, String> {
        let Some(parent) = uri.parent() else { return Ok(folder(uri, &self.conn.name)) };
        let name = uri.name();
        if !self.no_mlst.load(Ordering::Relaxed) {
            match self.with(|s| s.mlst(Some(&uri.path)))? {
                Ok(line) => {
                    if let Ok(file) = ListParser::parse_mlst(&line) {
                        return Ok(entry_of(&parent, &name, &file));
                    }
                }
                Err(e) if unsupported(&e) => self.no_mlst.store(true, Ordering::Relaxed),
                Err(e) => return Err(error(&uri.path, &e)),
            }
        }
        self.files(&parent.path)?.iter().find(|f| f.name() == name).map(|f| entry_of(&parent, &name, f)).ok_or_else(|| format!("\"{name}\": {}", tr("không còn ở đó", "is not there any more")))
    }

    fn read(&self, uri: &Uri) -> Result<Box<dyn Read + Send>, String> {
        let (mut stream, _) = self.take()?;
        match stream.retr_as_stream(&uri.path) {
            Ok(transfer) => Ok(Box::new(Download { transfer: Some(transfer), stream: Some(stream), idle: self.idle.clone() })),
            Err(e) => {
                if !broken(&e) {
                    give(&self.idle, stream);
                }
                Err(error(&uri.path, &e))
            }
        }
    }

    fn write(&self, uri: &Uri) -> Result<Box<dyn Commit>, String> {
        let partial = partial_of(Path::new(&uri.path)).to_string_lossy().into_owned();
        let (mut stream, _) = self.take()?;
        match stream.put_with_stream(&partial) {
            Ok(transfer) => Ok(Box::new(Upload { transfer: Some(transfer), stream: Some(stream), idle: self.idle.clone(), partial, target: uri.path.clone() })),
            Err(e) => {
                if !broken(&e) {
                    give(&self.idle, stream);
                }
                Err(error(&uri.path, &e))
            }
        }
    }

    fn mkdir(&self, uri: &Uri) -> Result<(), String> {
        self.run(&uri.path, |s| s.mkdir(&uri.path))
    }

    fn rename(&self, from: &Uri, to: &Uri) -> Result<(), String> {
        if self.stat(to).is_ok() {
            return Err(format!("\"{}\": {}", to.name(), tr("đã có một mục cùng tên", "an item with that name is already there")));
        }
        self.run(&from.path, |s| s.rename(&from.path, &to.path))
    }

    fn delete(&self, uri: &Uri, cancel: &AtomicBool) -> Result<(), String> {
        if uri.parent().is_none() {
            return Err(tr("Không xóa được thư mục gốc", "The top folder cannot be deleted").into());
        }
        if self.stat(uri)?.kind == "dir" {
            for child in self.list(uri, cancel)? {
                if cancel.load(Ordering::Relaxed) {
                    return Err(tr("Đã hủy", "Cancelled").into());
                }
                self.delete(&uri.join(&child.name), cancel)?;
            }
            return self.run(&uri.path, |s| s.rmdir(&uri.path));
        }
        self.run(&uri.path, |s| s.rm(&uri.path))
    }
}

/// A download: reads from the data connection, and gives the control connection back once the server has said the
/// transfer is complete. Dropped early, it gives up the connection, which is in the middle of a transfer.
struct Download<T: TlsStream> {
    transfer: Option<TransferStream<T>>,
    stream: Option<ImplFtpStream<T>>,
    idle: Idle<T>,
}

impl<T: TlsStream> Read for Download<T> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let Some(transfer) = self.transfer.as_mut() else { return Ok(0) };
        let n = transfer.read(buf)?;
        if n == 0 && !buf.is_empty() {
            if let Some(transfer) = self.transfer.take() {
                transfer.finish().map_err(|e| io::Error::other(error("", &e)))?;
            }
            if let Some(stream) = self.stream.take() {
                give(&self.idle, stream);
            }
        }
        Ok(n)
    }
}

/// An upload to a partial name beside the target, moved onto it by `commit`. Dropped without `commit`, the partial
/// file is removed.
struct Upload<T: TlsStream> {
    transfer: Option<TransferStream<T>>,
    stream: Option<ImplFtpStream<T>>,
    idle: Idle<T>,
    partial: String,
    target: String,
}

impl<T: TlsStream> Write for Upload<T> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.transfer.as_mut().map_or(Ok(0), |t| t.write(buf))
    }

    fn flush(&mut self) -> io::Result<()> {
        self.transfer.as_mut().map_or(Ok(()), |t| t.flush())
    }
}

impl<T: TlsStream + Send + 'static> Commit for Upload<T> {
    fn commit(mut self: Box<Self>) -> Result<(), String> {
        let (Some(transfer), Some(mut stream)) = (self.transfer.take(), self.stream.take()) else { return Err(tr("Đã đóng", "Already closed").into()) };
        if let Err(e) = transfer.finish() {
            let _ = stream.rm(&self.partial);
            return Err(error(&self.target, &e));
        }
        // RNTO onto an existing file replaces it on most servers; the others are given the old file's removal first.
        let mut moved = stream.rename(&self.partial, &self.target);
        if moved.is_err() && stream.size(&self.target).is_ok() {
            moved = stream.rm(&self.target).and_then(|()| stream.rename(&self.partial, &self.target));
        }
        if let Err(e) = moved {
            let _ = stream.rm(&self.partial);
            give(&self.idle, stream);
            return Err(error(&self.target, &e));
        }
        give(&self.idle, stream);
        Ok(())
    }
}

impl<T: TlsStream> Drop for Upload<T> {
    fn drop(&mut self) {
        if let Some(transfer) = self.transfer.take() {
            drop(transfer);
            if let Some(mut stream) = self.stream.take() {
                let _ = stream.rm(&self.partial);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ftp_list_line_parses_unix_and_mlsd() {
        let dir = Uri::parse("ftp://abc/pub").unwrap();
        let unix = File::try_from("-rw-r--r--   1 ftp  ftp     1048576 Mar 14  2023 Tài liệu 2024.pdf").unwrap();
        let e = entry_of(&dir, unix.name(), &unix);
        assert_eq!((e.name.as_str(), e.kind, e.size, e.ext.as_str()), ("Tài liệu 2024.pdf", "file", 1_048_576, "pdf"));
        assert_eq!(e.uri, "ftp://abc/pub/T%C3%A0i%20li%E1%BB%87u%202024.pdf");
        let folder = File::try_from("drwxr-xr-x   2 ftp  ftp        4096 Jan  2 10:30 incoming").unwrap();
        assert!(entry_of(&dir, folder.name(), &folder).is_dir);
        let mlsd = ListParser::parse_mlsd("type=file;size=42;modify=20240229120000; notes.txt").unwrap();
        let e = entry_of(&dir, mlsd.name(), &mlsd);
        assert_eq!((e.name.as_str(), e.size, e.mtime), ("notes.txt", 42, crate::features::unix(2024, 2, 29, 12, 0, 0)));
        let dos = File::try_from("02-29-24  12:00PM       <DIR>          Báo cáo").unwrap();
        let e = entry_of(&dir, dos.name(), &dos);
        assert!(e.is_dir && e.name == "Báo cáo");
    }

    /// A round trip with a real server, run by hand: `LZ_TEST_FTP=user:password@host cargo test ftp_roundtrip -- --ignored`.
    #[test]
    #[ignore]
    fn ftp_roundtrip_small_file() {
        let Ok(target) = std::env::var("LZ_TEST_FTP") else { return };
        let (auth, host) = target.rsplit_once('@').unwrap_or(("", &target));
        let (user, password) = auth.split_once(':').unwrap_or((auth, ""));
        let (host, port) = host.split_once(':').map_or((host, None), |(h, p)| (h, p.parse().ok()));
        let conn = Connection { name: "test".into(), scheme: "ftp".into(), host: host.into(), port, user: user.into(), ..Default::default() };
        let ftp = Ftp::new(conn, Some(password.into()));
        let home = Uri { scheme: "ftp".into(), authority: "test".into(), path: ftp.home().unwrap() };
        let dir = home.join(&format!("lazyspace-test-{}", std::process::id()));
        ftp.mkdir(&dir).unwrap();
        let file = dir.join("hello world.txt");
        let mut w = ftp.write(&file).unwrap();
        w.write_all(b"xin chao").unwrap();
        w.commit().unwrap();
        let mut text = String::new();
        ftp.read(&file).unwrap().read_to_string(&mut text).unwrap();
        assert_eq!(text, "xin chao");
        assert_eq!(ftp.stat(&file).unwrap().size, 8);
        ftp.rename(&file, &dir.join("b.txt")).unwrap();
        assert_eq!(ftp.list(&dir, &AtomicBool::new(false)).unwrap().iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["b.txt"]);
        ftp.delete(&dir, &AtomicBool::new(false)).unwrap();
        assert!(ftp.stat(&dir).is_err());
    }
}
