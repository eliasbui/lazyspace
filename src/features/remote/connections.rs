//! The saved server connections, in connections.json beside settings.json. A connection never holds its secret: the
//! password, secret key or key passphrase goes to the Keychain under the connection's id (keychain.rs).

use crate::{features::data_file, tr};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

/// The kinds of connection: the schemes of places on a server, and of the shares the system mounts as disks.
pub const SCHEMES: &[&str] = &["sftp", "ftp", "ftps", "s3", "oss", "smb", "afp", "nfs", "dav", "davs"];
/// The kinds the system mounts as a disk under /Volumes (netfs.rs).
pub const MOUNTED: &[&str] = &["smb", "afp", "nfs", "dav", "davs"];
/// The most connections kept.
const MAX: usize = 200;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub scheme: String,
    pub host: String,
    pub port: Option<u16>,
    /// The user name, or the access key id of S3 and OSS.
    pub user: String,
    /// The folder to open first: a path on the server, or the share (and a folder in it) of a mounted one.
    pub path: String,
    pub region: String,
    /// The address of an S3-compatible service other than AWS and OSS, such as MinIO or Cloudflare R2.
    pub endpoint: String,
    pub bucket: String,
    /// The private key of SFTP, such as ~/.ssh/id_ed25519; its passphrase is the connection's secret.
    pub key_file: String,
    /// A share opened as a guest, with no account.
    pub guest: bool,
}

pub fn path() -> PathBuf {
    data_file("connections.json")
}

pub fn load(path: &Path) -> Vec<Connection> {
    fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn save(path: &Path, list: &[Connection]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_string_pretty(list).map_err(|e| e.to_string())?).and_then(|()| fs::rename(&temp, path)).map_err(|e| e.to_string())
}

/// The saved connection with the id `id`.
pub fn find(id: &str) -> Result<Connection, String> {
    load(&path()).into_iter().find(|c| c.id == id).ok_or_else(|| tr("Kết nối này không còn nữa", "This connection is not there any more").to_owned())
}

/// Adds `connection`, or replaces the one with its id; a connection without an id gets a new one.
pub fn put(path: &Path, connection: Connection) -> Result<Connection, String> {
    let mut connection = clean(connection)?;
    let mut list = load(path);
    if connection.id.is_empty() {
        connection.id = new_id();
    }
    match list.iter().position(|c| c.id == connection.id) {
        Some(i) => list[i] = connection.clone(),
        None if list.len() >= MAX => return Err(tr("Đã có quá nhiều kết nối", "There are too many connections").into()),
        None => list.push(connection.clone()),
    }
    save(path, &list)?;
    Ok(connection)
}

pub fn remove(path: &Path, id: &str) -> Result<(), String> {
    let mut list = load(path);
    list.retain(|c| c.id != id);
    save(path, &list)
}

/// Checks a connection the page sends and puts it in the form it is kept in.
pub fn clean(mut c: Connection) -> Result<Connection, String> {
    for field in [&mut c.id, &mut c.name, &mut c.scheme, &mut c.host, &mut c.user, &mut c.path, &mut c.region, &mut c.endpoint, &mut c.bucket, &mut c.key_file] {
        *field = field.trim().to_owned();
    }
    let bad = |what: (&str, &str)| Err(format!("{}: {}", tr("Không hợp lệ", "Not valid"), tr(what.0, what.1)));
    if !SCHEMES.contains(&c.scheme.as_str()) {
        return bad(("loại kết nối", "the kind of connection"));
    }
    if !c.id.is_empty() && !c.id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return bad(("mã kết nối", "the connection id"));
    }
    let host_ok = |h: &str| !h.is_empty() && h.len() <= 253 && h.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b':' | b'[' | b']' | b'%'));
    let s3 = matches!(c.scheme.as_str(), "s3" | "oss");
    if !s3 && !host_ok(&c.host) {
        return bad(("máy chủ", "the server"));
    }
    if s3 {
        c.host.clear();
        if c.scheme == "oss" && c.region.is_empty() {
            return bad(("vùng (region), ví dụ cn-hangzhou", "the region, such as cn-hangzhou"));
        }
        if !c.region.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
            return bad(("vùng (region)", "the region"));
        }
        if !c.bucket.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-' | b'_')) {
            return bad(("bucket", "the bucket"));
        }
        let endpoint_ok = c.endpoint.is_empty() || ((c.endpoint.starts_with("https://") || c.endpoint.starts_with("http://")) && host_ok(c.endpoint.split("://").nth(1).unwrap_or("").trim_end_matches('/')));
        if !endpoint_ok {
            return bad(("địa chỉ dịch vụ, ví dụ https://minio.local:9000", "the service address, such as https://minio.local:9000"));
        }
        if c.user.is_empty() {
            return bad(("access key id", "the access key id"));
        }
    }
    if c.user.chars().any(char::is_control) || c.user.len() > 256 || c.key_file.chars().any(char::is_control) {
        return bad(("tên người dùng", "the user name"));
    }
    if c.port == Some(0) {
        c.port = None;
    }
    if c.path.chars().any(char::is_control) {
        return bad(("thư mục", "the folder"));
    }
    if !c.path.is_empty() && !c.path.starts_with('/') {
        c.path.insert(0, '/');
    }
    if c.name.is_empty() {
        c.name = [&c.host, &c.bucket, &c.endpoint].into_iter().find(|s| !s.is_empty()).cloned().unwrap_or_else(|| c.scheme.to_uppercase());
    }
    if c.name.chars().count() > 80 {
        return bad(("tên, dài quá 80 ký tự", "the name, longer than 80 characters"));
    }
    Ok(c)
}

/// A new id: random enough that two connections never share one, and plain in an address (`sftp://<id>/`).
fn new_id() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos()));
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;

    #[test]
    fn connections_json_never_contains_secret_fields() {
        let t = Temp::new("connections");
        let file = t.0.join("connections.json");
        // What a page might send, with a secret in it by mistake: the fields that are not a connection's are dropped.
        let sent: Connection = serde_json::from_str(r#"{"name":"NAS","scheme":"sftp","host":"nas.local","user":"me","password":"hunter2","secret":"s3cr3t"}"#).unwrap();
        let saved = put(&file, sent).unwrap();
        assert_eq!(saved.id.len(), 16);
        let text = fs::read_to_string(&file).unwrap();
        for secret in ["hunter2", "s3cr3t", "password", "secret"] {
            assert!(!text.contains(secret), "{secret} in {text}");
        }
        let again = put(&file, Connection { name: "NAS 2".into(), ..saved.clone() }).unwrap();
        assert_eq!(load(&file), vec![again.clone()], "saving under the same id replaces");
        remove(&file, &again.id).unwrap();
        assert!(load(&file).is_empty());
    }

    #[test]
    fn connections_are_checked_before_they_are_kept() {
        let ok = clean(Connection { scheme: "ftp".into(), host: " ftp.example.com ".into(), path: "pub".into(), port: Some(0), ..Default::default() }).unwrap();
        assert_eq!((ok.host.as_str(), ok.path.as_str(), ok.port, ok.name.as_str()), ("ftp.example.com", "/pub", None, "ftp.example.com"));
        for bad in [
            Connection { scheme: "gopher".into(), host: "h".into(), ..Default::default() },
            Connection { scheme: "sftp".into(), host: "a b".into(), ..Default::default() },
            Connection { scheme: "sftp".into(), host: "h/../x".into(), ..Default::default() },
            Connection { scheme: "sftp".into(), host: "h".into(), id: "../x".into(), ..Default::default() },
            Connection { scheme: "oss".into(), user: "k".into(), ..Default::default() },
            Connection { scheme: "s3".into(), user: "k".into(), endpoint: "ftp://x".into(), ..Default::default() },
            Connection { scheme: "s3".into(), ..Default::default() },
        ] {
            assert!(clean(bad.clone()).is_err(), "{bad:?}");
        }
        let s3 = clean(Connection { scheme: "s3".into(), user: "AKID".into(), endpoint: "https://minio.local:9000/".into(), host: "ignored".into(), ..Default::default() }).unwrap();
        assert_eq!((s3.host.as_str(), s3.name.as_str()), ("", "https://minio.local:9000/"));
    }
}
