//! The files the app browses, wherever they are. A URI names a place; the provider of its scheme lists it and changes
//! it. The local disk is the provider of `file`; archives and servers add theirs (design.md section 7).

pub mod copy;
pub mod local;

use crate::tr;
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock, RwLock, atomic::AtomicBool},
};

/// A place: `scheme://authority/path`, with the path kept decoded (`/Users/me/a b.txt`) and encoded only on the way
/// out. An archive puts `!` between the archive and the place inside it, which is why `!` in a name is encoded.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Uri {
    pub scheme: String,
    pub authority: String,
    pub path: String,
}

impl Uri {
    /// Reads `file:///Users/me/a%20b.txt`, or a plain absolute path, which is taken as a local one.
    pub fn parse(text: &str) -> Result<Uri, String> {
        let bad = || format!("{}: {text}", tr("Địa chỉ không hợp lệ", "Not a valid address"));
        if text.starts_with('/') {
            return Ok(Uri::file(Path::new(text)));
        }
        let (scheme, rest) = text.split_once("://").ok_or_else(bad)?;
        if scheme.is_empty() || !scheme.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'+' || b == b'-') {
            return Err(bad());
        }
        let (authority, path) = match rest.find('/') {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, "/"),
        };
        let path = decode(path).ok_or_else(bad)?;
        if path.contains('\0') {
            return Err(bad());
        }
        Ok(Uri { scheme: scheme.into(), authority: decode(authority).ok_or_else(bad)?, path: normalize(&path) })
    }

    pub fn file(path: &Path) -> Uri {
        Uri { scheme: "file".into(), authority: String::new(), path: normalize(&path.to_string_lossy()) }
    }

    /// The place inside this one called `name`.
    pub fn join(&self, name: &str) -> Uri {
        let path = if self.path.ends_with('/') { format!("{}{name}", self.path) } else { format!("{}/{name}", self.path) };
        Uri { path, ..self.clone() }
    }

    /// The place that holds this one; None at the root.
    pub fn parent(&self) -> Option<Uri> {
        if self.path == "/" {
            return None;
        }
        let cut = self.path.rfind('/')?;
        Some(Uri { path: if cut == 0 { "/".into() } else { self.path[..cut].into() }, ..self.clone() })
    }

    /// The last part of the path; the authority at the root of a server, "/" at the root of the disk.
    pub fn name(&self) -> String {
        match self.path.rsplit('/').next() {
            Some(name) if !name.is_empty() => name.into(),
            _ if !self.authority.is_empty() => self.authority.clone(),
            _ => "/".into(),
        }
    }

    /// The path on this Mac's disk, for a local place.
    pub fn local_path(&self) -> Option<PathBuf> {
        (self.scheme == "file").then(|| PathBuf::from(&self.path))
    }
}

impl std::fmt::Display for Uri {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}://{}{}", self.scheme, encode(&self.authority, false), encode(&self.path, true))
    }
}

/// `/a//b/` as `/a/b`: one slash between parts and none at the end, except for the root itself.
fn normalize(path: &str) -> String {
    let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    format!("/{}", parts.join("/"))
}

/// Percent-encodes every byte but the unreserved ones of RFC 3986, the slash in a path, and the `@` and `:` of an
/// authority (`user@host:22`).
fn encode(text: &str, path: bool) -> String {
    let mut out = String::with_capacity(text.len());
    for b in text.bytes() {
        let keep = match b {
            b'/' => path,
            b'@' | b':' => !path,
            _ => b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~'),
        };
        if keep {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// One item of a folder as the page shows it.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Entry {
    pub name: String,
    pub uri: String,
    /// "dir", "file", "app", "package" (a folder Finder shows as one item) or "link".
    pub kind: &'static str,
    /// Whether opening it goes inside: a folder, or a link to one.
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub size: u64,
    /// Seconds since 1970.
    pub mtime: i64,
    pub ctime: i64,
    pub hidden: bool,
    pub ext: String,
    /// What `lazy://icon` draws for it: `ext:png`, `type:public.folder`, or `path:<path>` for an item with an icon of
    /// its own (an app, a special folder).
    pub icon: String,
}

impl Entry {
    /// The lower-case name, as sorting and finding by typing compare it.
    pub fn key(&self) -> String {
        self.name.to_lowercase()
    }
}

/// What a place allows, so the page can leave out what cannot be done there.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct Capabilities {
    pub write: bool,
    pub rename: bool,
    pub trash: bool,
    pub watch: bool,
    pub sizes: bool,
    #[serde(rename = "localPath")]
    pub local_path: bool,
}

/// A source of files for one scheme. Every method blocks; callers run them off the main thread.
pub trait Provider: Send + Sync {
    fn capabilities(&self, uri: &Uri) -> Capabilities;
    fn list(&self, uri: &Uri, cancel: &AtomicBool) -> Result<Vec<Entry>, String>;
    fn stat(&self, uri: &Uri) -> Result<Entry, String>;
    fn read(&self, uri: &Uri) -> Result<Box<dyn std::io::Read + Send>, String>;
    /// A writer that puts the file in place only when `commit` is called, so a cut-short copy leaves nothing.
    fn write(&self, uri: &Uri) -> Result<Box<dyn Commit>, String>;
    fn mkdir(&self, uri: &Uri) -> Result<(), String>;
    /// Within one provider and one authority.
    fn rename(&self, from: &Uri, to: &Uri) -> Result<(), String>;
    /// Removes a file or a whole folder for good.
    fn delete(&self, uri: &Uri, cancel: &AtomicBool) -> Result<(), String>;
}

/// A file being written: bytes go in, and `commit` puts it in its place.
pub trait Commit: std::io::Write + Send {
    fn commit(self: Box<Self>) -> Result<(), String>;
}

/// The providers by scheme.
pub struct Registry {
    by_scheme: RwLock<HashMap<String, Arc<dyn Provider>>>,
}

impl Registry {
    pub fn add(&self, scheme: &str, provider: Arc<dyn Provider>) {
        if let Ok(mut map) = self.by_scheme.write() {
            map.insert(scheme.into(), provider);
        }
    }

    pub fn get(&self, uri: &Uri) -> Result<Arc<dyn Provider>, String> {
        let map = self.by_scheme.read().map_err(|e| e.to_string())?;
        map.get(&uri.scheme).cloned().ok_or_else(|| format!("{} {}://", tr("Không mở được địa chỉ", "Cannot open addresses of"), uri.scheme))
    }
}

/// The providers of the app, with the local disk's already in.
pub fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let registry = Registry { by_scheme: RwLock::new(HashMap::new()) };
        registry.add("file", Arc::new(local::Local));
        registry
    })
}

/// Whether `name` can be the name of an item: not empty, not `.` or `..`, no slash and no NUL.
pub fn valid_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\0') {
        return Err(tr("Tên không hợp lệ: không được trống và không được chứa \"/\"", "Not a valid name: it cannot be empty or contain \"/\"").into());
    }
    if name.len() > 255 {
        return Err(tr("Tên quá dài", "The name is too long").into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uri_roundtrips_percent_encoding() {
        let uri = Uri::parse("file:///Users/me/a%20b%21/T%C3%A0i%20li%E1%BB%87u.txt").unwrap();
        assert_eq!((uri.scheme.as_str(), uri.authority.as_str(), uri.path.as_str()), ("file", "", "/Users/me/a b!/Tài liệu.txt"));
        assert_eq!(uri.to_string(), "file:///Users/me/a%20b%21/T%C3%A0i%20li%E1%BB%87u.txt");
        assert_eq!(Uri::parse(&uri.to_string()).unwrap(), uri);
        let remote = Uri::parse("sftp://me@host:22/srv/x").unwrap();
        assert_eq!((remote.authority.as_str(), remote.path.as_str()), ("me@host:22", "/srv/x"));
        assert_eq!(remote.to_string(), "sftp://me@host:22/srv/x");
        assert_eq!(Uri::parse("/Users/me/").unwrap(), Uri::file(Path::new("/Users/me")));
        for bad in ["", "Users/me", "file:/x", "FILE:///x", "file:///a%2", "file:///a%00b", "file:///%FF"] {
            assert!(Uri::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn uri_parts() {
        let uri = Uri::parse("file:///Users/me").unwrap();
        assert_eq!(uri.join("a.txt").path, "/Users/me/a.txt");
        assert_eq!(uri.parent().unwrap().path, "/Users");
        assert_eq!(uri.parent().unwrap().parent().unwrap().path, "/");
        assert_eq!(Uri::parse("file:///").unwrap().parent(), None);
        assert_eq!(Uri::parse("file:///").unwrap().join("Users").path, "/Users");
        assert_eq!((uri.name(), Uri::parse("file:///").unwrap().name()), ("me".into(), "/".into()));
        assert_eq!(Uri::parse("ftp://host/").unwrap().name(), "host");
        assert_eq!(uri.local_path(), Some(PathBuf::from("/Users/me")));
        assert_eq!(Uri::parse("ftp://host/x").unwrap().local_path(), None);
    }

    #[test]
    fn names_with_a_slash_or_nothing_are_refused() {
        for bad in ["", "  ", ".", "..", "a/b", "a\0b", &"x".repeat(256)] {
            assert!(valid_name(bad).is_err(), "{bad:?}");
        }
        for good in ["a", ".hidden", "Tài liệu", "a b.txt", "..x"] {
            assert!(valid_name(good).is_ok(), "{good:?}");
        }
    }
}
