//! S3, Aliyun OSS through its S3-compatible interface, and S3-compatible services at an address of their own (MinIO,
//! Cloudflare R2), with requests signed by hand (AWS Signature Version 4, with sha2 and hmac) and sent with ureq. A
//! place is `s3://<connection id>/<bucket>/<key>`; folders are the prefixes of keys up to a slash, as the consoles of
//! these services show them, and a new folder is an empty object whose key ends in a slash.

use super::{Connection, entry, folder, needs_password};
use crate::{
    features::{civil, unix},
    tr,
    vfs::{Capabilities, Commit, Entry, Provider, Uri, cache_dir},
};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{self, Read, Seek, Write},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use ureq::http;

/// The hash of nothing, the payload of a request without a body.
const EMPTY: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
/// The largest object one PUT may send.
const PUT_MAX: u64 = 5 << 30;

pub struct Key<'a> {
    pub access: &'a str,
    pub secret: &'a str,
    pub region: &'a str,
    pub service: &'a str,
}

fn hmac(key: &[u8], data: &str) -> Vec<u8> {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC takes a key of any length");
    mac.update(data.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Percent-encoding as Signature Version 4 wants it: every byte but the unreserved ones, and a slash too unless it
/// separates the parts of a path.
pub fn encode(text: &str, keep_slash: bool) -> String {
    text.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') || (keep_slash && b == b'/') { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

/// The query as it is signed and sent: names and values encoded, in the order of the names.
pub fn query_string(query: &[(&str, &str)]) -> String {
    let mut pairs: Vec<(String, String)> = query.iter().map(|(k, v)| (encode(k, false), encode(v, false))).collect();
    pairs.sort();
    pairs.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&")
}

/// The Authorization header of a request signed with Signature Version 4. `path` and `query` are encoded already;
/// `headers` are the signed ones, with names in lower case; `date` is `20150830T123600Z`.
pub fn authorization(method: &str, path: &str, query: &str, headers: &[(&str, &str)], payload: &str, key: &Key, date: &str) -> String {
    let mut headers = headers.to_vec();
    headers.sort();
    let canonical: String = headers.iter().map(|(k, v)| format!("{k}:{}\n", v.trim())).collect();
    let signed = headers.iter().map(|(k, _)| *k).collect::<Vec<_>>().join(";");
    let request = format!("{method}\n{path}\n{query}\n{canonical}\n{signed}\n{payload}");
    let day = date.get(..8).unwrap_or(date);
    let scope = format!("{day}/{}/{}/aws4_request", key.region, key.service);
    let to_sign = format!("AWS4-HMAC-SHA256\n{date}\n{scope}\n{}", hex(&Sha256::digest(request.as_bytes())));
    let mut signing = hmac(format!("AWS4{}", key.secret).as_bytes(), day);
    for part in [key.region, key.service, "aws4_request"] {
        signing = hmac(&signing, part);
    }
    format!("AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed}, Signature={}", key.access, hex(&hmac(&signing, &to_sign)))
}

fn amz_date(secs: i64) -> String {
    let (y, mo, d, h, mi, s) = civil(secs);
    format!("{y:04}{mo:02}{d:02}T{h:02}{mi:02}{s:02}Z")
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// `2009-10-12T17:50:30.000Z` in seconds since 1970.
fn iso_time(text: &str) -> i64 {
    let n = |a: usize, b: usize| text.get(a..b).and_then(|t| t.parse::<u32>().ok()).unwrap_or(0);
    let year = text.get(..4).and_then(|t| t.parse().ok()).unwrap_or(1970);
    unix(year, n(5, 7).max(1), n(8, 10).max(1), n(11, 13), n(14, 16), n(17, 19))
}

/// `Wed, 12 Oct 2009 17:50:00 GMT` in seconds since 1970.
fn http_time(text: &str) -> i64 {
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let parts: Vec<&str> = text.split_whitespace().collect();
    let [_, day, month, year, time, ..] = parts.as_slice() else { return 0 };
    let month = MONTHS.iter().position(|m| m == month).map_or(1, |i| i as u32 + 1);
    let t: Vec<u32> = time.split(':').filter_map(|p| p.parse().ok()).collect();
    let [h, mi, s] = t.as_slice() else { return 0 };
    unix(year.parse().unwrap_or(1970), month, day.parse().unwrap_or(1), *h, *mi, *s)
}

/// What a listing of a bucket says: the keys with their size and time, the prefixes one level down, and where the
/// next page starts.
#[derive(Debug, Default, PartialEq)]
pub struct Listing {
    pub keys: Vec<(String, u64, i64)>,
    pub prefixes: Vec<String>,
    pub buckets: Vec<(String, i64)>,
    pub next: Option<String>,
    pub error: Option<(String, String)>,
}

/// Reads the XML of ListObjectsV2, ListBuckets or an error.
pub fn parse(xml: &str) -> Result<Listing, String> {
    use quick_xml::{Reader, escape::resolve_predefined_entity, events::Event};
    let mut reader = Reader::from_str(xml);
    let mut path: Vec<String> = Vec::new();
    let mut text = String::new();
    let mut out = Listing::default();
    let (mut key, mut size, mut time, mut truncated) = (String::new(), 0u64, 0i64, false);
    loop {
        match reader.read_event().map_err(|e| format!("S3: {e}"))? {
            Event::Start(e) => {
                path.push(e.local_name().as_ref().to_owned());
                text.clear();
            }
            Event::Text(e) => text.push_str(&e.xml10_content()),
            Event::CData(e) => text.push_str(&e),
            Event::GeneralRef(r) => match r.resolve_char_ref() {
                Ok(Some(c)) => text.push(c),
                _ => text.push_str(resolve_predefined_entity(&r.xml10_content()).unwrap_or_default()),
            },
            Event::End(_) => {
                let tail: Vec<&str> = path.iter().rev().take(2).map(String::as_str).collect();
                match tail.as_slice() {
                    ["Key", "Contents"] => key = text.clone(),
                    ["Size", "Contents"] => size = text.trim().parse().unwrap_or(0),
                    ["LastModified", "Contents"] => time = iso_time(text.trim()),
                    ["Contents", _] => {
                        out.keys.push((std::mem::take(&mut key), size, time));
                        (size, time) = (0, 0);
                    }
                    ["Prefix", "CommonPrefixes"] => out.prefixes.push(text.clone()),
                    ["Name", "Bucket"] => key = text.clone(),
                    ["CreationDate", "Bucket"] => time = iso_time(text.trim()),
                    ["Bucket", _] => {
                        out.buckets.push((std::mem::take(&mut key), time));
                        time = 0;
                    }
                    ["IsTruncated", _] => truncated = text.trim() == "true",
                    ["NextContinuationToken", _] => out.next = Some(text.clone()),
                    ["Code", "Error"] => out.error = Some((text.clone(), out.error.take().map(|e| e.1).unwrap_or_default())),
                    ["Message", "Error"] => out.error = Some((out.error.take().map(|e| e.0).unwrap_or_default(), text.clone())),
                    _ => {}
                }
                path.pop();
                text.clear();
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !truncated {
        out.next = None;
    }
    Ok(out)
}

/// A connection to a bucket service.
pub struct S3 {
    conn: Connection,
    secret: String,
    agent: ureq::Agent,
    /// The region of each bucket found to live elsewhere than the connection's, from the answers of AWS.
    regions: Mutex<HashMap<String, String>>,
}

/// A request's body: none, or a file of known size with the hash of its bytes.
enum Body {
    Empty,
    File(File, String),
}

impl S3 {
    pub fn new(conn: Connection, secret: Option<String>) -> Result<S3, String> {
        let secret = secret.ok_or_else(|| needs_password(&conn.name))?;
        let agent = ureq::Agent::config_builder()
            .timeout_connect(Some(Duration::from_secs(15)))
            .timeout_recv_response(Some(Duration::from_secs(60)))
            .max_redirects(0)
            .http_status_as_error(false)
            .user_agent("lazyspace")
            .build()
            .into();
        Ok(S3 { conn, secret, agent, regions: Mutex::new(HashMap::new()) })
    }

    fn region(&self, bucket: Option<&str>) -> String {
        let learnt = bucket.and_then(|b| self.regions.lock().ok()?.get(b).cloned());
        learnt.unwrap_or_else(|| if self.conn.region.is_empty() { "us-east-1".into() } else { self.conn.region.clone() })
    }

    /// The scheme, host and path before the key for a bucket, or for the service itself. AWS and OSS put the bucket
    /// in the host name (OSS only allows that); another service gets it in the path, which they all take.
    fn target(&self, bucket: Option<&str>) -> (String, String, String) {
        let in_path = |b: Option<&str>| b.map(|b| format!("/{}", encode(b, false))).unwrap_or_default();
        if !self.conn.endpoint.is_empty() {
            let (scheme, host) = self.conn.endpoint.split_once("://").unwrap_or(("https", &self.conn.endpoint));
            return (scheme.into(), host.trim_end_matches('/').into(), in_path(bucket));
        }
        let base = if self.conn.scheme == "oss" { format!("s3.oss-{}.aliyuncs.com", self.conn.region) } else { format!("s3.{}.amazonaws.com", self.region(bucket)) };
        match bucket {
            // A bucket with a dot in its name would not match the certificate of a host name.
            Some(b) if b.contains('.') && self.conn.scheme != "oss" => ("https".into(), base, in_path(bucket)),
            Some(b) => ("https".into(), format!("{b}.{base}"), String::new()),
            None => ("https".into(), base, String::new()),
        }
    }

    /// Sends a signed request; a bucket found to be in another region of AWS is asked again there.
    fn send(&self, method: &str, bucket: Option<&str>, key: &str, query: &[(&str, &str)], extra: &[(&str, String)], mut body: Body) -> Result<http::Response<ureq::Body>, String> {
        for attempt in 0..2 {
            let (scheme, host, prefix) = self.target(bucket);
            let path = if bucket.is_some() || !key.is_empty() { format!("{prefix}/{}", encode(key, true)) } else { "/".into() };
            let query = query_string(query);
            let url = if query.is_empty() { format!("{scheme}://{host}{path}") } else { format!("{scheme}://{host}{path}?{query}") };
            let date = amz_date(now());
            let payload = match &body {
                Body::Empty => EMPTY.to_owned(),
                Body::File(_, hash) => hash.clone(),
            };
            let region = self.region(bucket);
            let mut signed: Vec<(&str, &str)> = vec![("host", &host), ("x-amz-content-sha256", &payload), ("x-amz-date", &date)];
            signed.extend(extra.iter().map(|(k, v)| (*k, v.as_str())));
            let auth = authorization(method, &path, &query, &signed, &payload, &Key { access: &self.conn.user, secret: &self.secret, region: &region, service: "s3" }, &date);
            let mut request = http::Request::builder().method(method).uri(&url).header("authorization", auth);
            for (k, v) in signed.iter().filter(|(k, _)| *k != "host") {
                request = request.header(*k, *v);
            }
            let sent = match &mut body {
                // A PUT without a body still says its length, which S3 requires.
                Body::Empty if method == "PUT" => self.agent.run(request.body(&[][..]).map_err(|e| e.to_string())?),
                Body::Empty => self.agent.run(request.body(()).map_err(|e| e.to_string())?),
                Body::File(file, _) => {
                    file.rewind().map_err(|e| e.to_string())?;
                    self.agent.run(request.body(&*file).map_err(|e| e.to_string())?)
                }
            };
            let response = sent.map_err(|e| format!("{} \"{}\": {e}", tr("Không kết nối được", "Could not connect to"), self.conn.name))?;
            let moved = matches!(response.status().as_u16(), 301 | 400);
            let elsewhere = response.headers().get("x-amz-bucket-region").and_then(|v| v.to_str().ok()).filter(|r| *r != region).map(str::to_owned);
            if let (0, true, Some(b), Some(r)) = (attempt, moved, bucket, elsewhere) {
                if let Ok(mut regions) = self.regions.lock() {
                    regions.insert(b.to_owned(), r);
                }
                continue;
            }
            return Ok(response);
        }
        Err(tr("Máy chủ chuyển hướng quá nhiều lần", "The server redirected too many times").into())
    }

    /// The error of a response that is not a success, in words.
    fn failure(&self, what: &str, response: http::Response<ureq::Body>) -> String {
        let status = response.status().as_u16();
        let text = response.into_body().read_to_string().unwrap_or_default();
        let (code, message) = parse(&text).ok().and_then(|l| l.error).unwrap_or_default();
        match (status, code.as_str()) {
            (403, "InvalidAccessKeyId" | "SignatureDoesNotMatch") => format!("{} \"{}\": {code}", tr("Access key hoặc secret key không đúng cho", "The access key or secret key is wrong for"), self.conn.name),
            (404, _) => format!("\"{what}\": {}", tr("không còn ở đó", "is not there any more")),
            _ => format!("\"{what}\": {status} {code} {message}").trim_end().to_owned(),
        }
    }

    fn ok(&self, what: &str, response: http::Response<ureq::Body>) -> Result<http::Response<ureq::Body>, String> {
        if response.status().is_success() { Ok(response) } else { Err(self.failure(what, response)) }
    }

    /// One page of the keys under `prefix`: one level down with `delimiter`, else all of them.
    fn page(&self, bucket: &str, prefix: &str, delimiter: bool, token: Option<&str>) -> Result<Listing, String> {
        let mut query = vec![("list-type", "2"), ("prefix", prefix)];
        if delimiter {
            query.push(("delimiter", "/"));
        }
        if let Some(token) = token {
            query.push(("continuation-token", token));
        }
        let response = self.ok(bucket, self.send("GET", Some(bucket), "", &query, &[], Body::Empty)?)?;
        parse(&response.into_body().read_to_string().map_err(|e| e.to_string())?)
    }

    /// Every key under `prefix`, page after page.
    fn all_keys(&self, bucket: &str, prefix: &str, cancel: &AtomicBool) -> Result<Vec<String>, String> {
        let (mut keys, mut token) = (Vec::new(), None);
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(tr("Đã hủy", "Cancelled").into());
            }
            let page = self.page(bucket, prefix, false, token.as_deref())?;
            keys.extend(page.keys.into_iter().map(|(k, _, _)| k));
            match page.next {
                Some(next) => token = Some(next),
                None => return Ok(keys),
            }
        }
    }

    fn head(&self, bucket: &str, key: &str) -> Result<Option<(u64, i64)>, String> {
        let response = self.send("HEAD", Some(bucket), key, &[], &[], Body::Empty)?;
        if response.status().as_u16() == 404 {
            return Ok(None);
        }
        let response = self.ok(key, response)?;
        let header = |name: &str| response.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("").to_owned();
        Ok(Some((header("content-length").parse().unwrap_or(0), http_time(&header("last-modified")))))
    }

    fn delete_key(&self, bucket: &str, key: &str) -> Result<(), String> {
        let response = self.send("DELETE", Some(bucket), key, &[], &[], Body::Empty)?;
        self.ok(key, response).map(drop)
    }

    fn copy_key(&self, bucket: &str, from: &str, to: &str) -> Result<(), String> {
        let source = format!("/{}/{}", encode(bucket, false), encode(from, true));
        let response = self.send("PUT", Some(bucket), to, &[], &[("x-amz-copy-source", source)], Body::Empty)?;
        self.ok(from, response).map(drop)
    }

    /// Tries the connection: lists the buckets, or the one bucket it is for.
    pub fn test(&self) -> Result<(), String> {
        match self.conn.bucket.as_str() {
            "" => self.ok(&self.conn.name, self.send("GET", None, "", &[], &[], Body::Empty)?).map(drop),
            bucket => self.page(bucket, "", true, None).map(drop),
        }
    }
}

/// The bucket and key of a place: `/photos/2024/a.jpg` is `photos` and `2024/a.jpg`.
fn split(uri: &Uri) -> (Option<String>, String) {
    let path = uri.path.trim_start_matches('/');
    match path.split_once('/') {
        Some((bucket, key)) => (Some(bucket.to_owned()), key.to_owned()),
        None if path.is_empty() => (None, String::new()),
        None => (Some(path.to_owned()), String::new()),
    }
}

/// The provider of `s3://` and `oss://`.
pub struct S3Provider {
    sessions: super::Sessions<S3>,
}

impl S3Provider {
    pub fn new() -> S3Provider {
        S3Provider { sessions: super::Sessions::default() }
    }

    fn session(&self, uri: &Uri) -> Result<Arc<S3>, String> {
        let id = &uri.authority;
        self.sessions.get(id, |_| false, || S3::new(super::connections::find(id)?, super::secret_of(id)))
    }

    pub fn forget(&self, id: &str) {
        self.sessions.forget(id);
    }

    pub fn put(&self, id: &str, session: S3) {
        self.sessions.put(id, session);
    }

    pub fn has(&self, id: &str) -> bool {
        self.sessions.has(id)
    }
}

impl Provider for S3Provider {
    fn capabilities(&self, uri: &Uri) -> Capabilities {
        // The list of buckets is not a folder things can be put in.
        let in_bucket = split(uri).0.is_some();
        Capabilities { write: in_bucket, rename: in_bucket, trash: false, watch: false, sizes: false, local_path: false }
    }

    fn list(&self, uri: &Uri, cancel: &AtomicBool) -> Result<Vec<Entry>, String> {
        let s3 = self.session(uri)?;
        let (bucket, key) = split(uri);
        let Some(bucket) = bucket else {
            if !s3.conn.bucket.is_empty() {
                return Ok(vec![entry(uri, &s3.conn.bucket, true, false, 0, 0)]);
            }
            let response = s3.ok(&s3.conn.name, s3.send("GET", None, "", &[], &[], Body::Empty)?)?;
            let listing = parse(&response.into_body().read_to_string().map_err(|e| e.to_string())?)?;
            return Ok(listing.buckets.iter().map(|(name, time)| entry(uri, name, true, false, 0, *time)).collect());
        };
        let prefix = if key.is_empty() { String::new() } else { format!("{key}/") };
        let (mut out, mut token) = (Vec::new(), None);
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(tr("Đã hủy", "Cancelled").into());
            }
            let page = s3.page(&bucket, &prefix, true, token.as_deref())?;
            for p in &page.prefixes {
                let name = p[prefix.len().min(p.len())..].trim_end_matches('/');
                if !name.is_empty() {
                    out.push(entry(uri, name, true, false, 0, 0));
                }
            }
            for (k, size, time) in &page.keys {
                let name = &k[prefix.len().min(k.len())..];
                // The key of the folder itself, the marker a new folder is made with, is not an item in it.
                if !name.is_empty() && !name.contains('/') {
                    out.push(entry(uri, name, false, false, *size, *time));
                }
            }
            match page.next {
                Some(next) => token = Some(next),
                None => return Ok(out),
            }
        }
    }

    fn stat(&self, uri: &Uri) -> Result<Entry, String> {
        let s3 = self.session(uri)?;
        let (Some(bucket), key) = split(uri) else { return Ok(folder(uri, &s3.conn.name)) };
        let Some(parent) = uri.parent() else { return Ok(folder(uri, &s3.conn.name)) };
        if key.is_empty() {
            return Ok(entry(&parent, &bucket, true, false, 0, 0));
        }
        if let Some((size, time)) = s3.head(&bucket, &key)? {
            return Ok(entry(&parent, &uri.name(), false, false, size, time));
        }
        let page = s3.page(&bucket, &format!("{key}/"), true, None)?;
        if !page.keys.is_empty() || !page.prefixes.is_empty() {
            return Ok(entry(&parent, &uri.name(), true, false, 0, 0));
        }
        Err(format!("\"{}\": {}", uri.name(), tr("không còn ở đó", "is not there any more")))
    }

    fn read(&self, uri: &Uri) -> Result<Box<dyn Read + Send>, String> {
        let s3 = self.session(uri)?;
        let (Some(bucket), key) = split(uri) else { return Err(tr("Đây là một thư mục", "This is a folder").into()) };
        let response = s3.ok(&uri.name(), s3.send("GET", Some(&bucket), &key, &[], &[], Body::Empty)?)?;
        Ok(Box::new(response.into_body().into_reader()))
    }

    fn write(&self, uri: &Uri) -> Result<Box<dyn Commit>, String> {
        let s3 = self.session(uri)?;
        let (Some(bucket), key) = split(uri) else { return Err(tr("Hãy mở một bucket trước", "Open a bucket first").into()) };
        if key.is_empty() {
            return Err(tr("Hãy mở một bucket trước", "Open a bucket first").into());
        }
        let dir = cache_dir().join("upload");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(format!("{}-{}", std::process::id(), super::stamp()));
        let file = File::options().read(true).write(true).create_new(true).open(&path).map_err(|e| e.to_string())?;
        Ok(Box::new(Upload { file: Some(file), path, hash: Sha256::new(), size: 0, s3, bucket, key }))
    }

    fn mkdir(&self, uri: &Uri) -> Result<(), String> {
        let s3 = self.session(uri)?;
        let (Some(bucket), key) = split(uri) else { return Err(tr("Không tạo được bucket ở đây", "Buckets are not made here").into()) };
        if key.is_empty() {
            return Err(tr("Không tạo được bucket ở đây", "Buckets are not made here").into());
        }
        let response = s3.send("PUT", Some(&bucket), &format!("{key}/"), &[], &[], Body::Empty)?;
        s3.ok(&uri.name(), response).map(drop)
    }

    fn rename(&self, from: &Uri, to: &Uri) -> Result<(), String> {
        let s3 = self.session(from)?;
        let ((Some(bucket), key), (Some(to_bucket), to_key)) = (split(from), split(to)) else { return Err(tr("Không đổi tên được bucket", "A bucket cannot be renamed").into()) };
        if bucket != to_bucket || key.is_empty() || to_key.is_empty() {
            return Err(tr("Không đổi tên được bucket", "A bucket cannot be renamed").into());
        }
        if self.stat(to).is_ok() {
            return Err(format!("\"{}\": {}", to.name(), tr("đã có một mục cùng tên", "an item with that name is already there")));
        }
        // S3 has no rename: each object is copied to its new key, then the old one removed.
        if s3.head(&bucket, &key)?.is_some() {
            s3.copy_key(&bucket, &key, &to_key)?;
            return s3.delete_key(&bucket, &key);
        }
        let prefix = format!("{key}/");
        for old in s3.all_keys(&bucket, &prefix, &AtomicBool::new(false))? {
            let new = format!("{to_key}/{}", &old[prefix.len()..]);
            s3.copy_key(&bucket, &old, &new)?;
            s3.delete_key(&bucket, &old)?;
        }
        Ok(())
    }

    fn delete(&self, uri: &Uri, cancel: &AtomicBool) -> Result<(), String> {
        let s3 = self.session(uri)?;
        let (Some(bucket), key) = split(uri) else { return Err(tr("Không xóa được ở đây", "Nothing can be deleted here").into()) };
        if key.is_empty() {
            return Err(tr("LazySpace không xóa cả bucket", "LazySpace does not delete whole buckets").into());
        }
        if s3.head(&bucket, &key)?.is_some() {
            return s3.delete_key(&bucket, &key);
        }
        for old in s3.all_keys(&bucket, &format!("{key}/"), cancel)? {
            if cancel.load(Ordering::Relaxed) {
                return Err(tr("Đã hủy", "Cancelled").into());
            }
            s3.delete_key(&bucket, &old)?;
        }
        Ok(())
    }
}

/// An upload kept in a file of the cache until `commit` sends it in one PUT, whose signature needs the hash of the
/// whole body first.
struct Upload {
    file: Option<File>,
    path: PathBuf,
    hash: Sha256,
    size: u64,
    s3: Arc<S3>,
    bucket: String,
    key: String,
}

impl Write for Upload {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let file = self.file.as_mut().ok_or_else(|| io::Error::other("closed"))?;
        let n = file.write(buf)?;
        self.hash.update(&buf[..n]);
        self.size += n as u64;
        if self.size > PUT_MAX {
            return Err(io::Error::other(tr("Tệp lớn hơn 5 GB, mức S3 nhận trong một lần gửi", "The file is larger than 5 GB, the most S3 takes in one upload")));
        }
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.as_mut().map_or(Ok(()), Write::flush)
    }
}

impl Commit for Upload {
    fn commit(mut self: Box<Self>) -> Result<(), String> {
        let file = self.file.take().ok_or_else(|| tr("Đã đóng", "Already closed").to_owned())?;
        let hash = hex(&std::mem::take(&mut self.hash).finalize());
        let response = self.s3.send("PUT", Some(&self.bucket), &self.key, &[], &[], Body::File(file, hash))?;
        self.s3.ok(&self.key, response).map(drop)
    }
}

impl Drop for Upload {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sigv4_matches_aws_test_vector() {
        // get-vanilla of the AWS Signature Version 4 test suite.
        let key = Key { access: "AKIDEXAMPLE", secret: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", region: "us-east-1", service: "service" };
        let headers = [("host", "example.amazonaws.com"), ("x-amz-date", "20150830T123600Z")];
        assert_eq!(
            authorization("GET", "/", "", &headers, EMPTY, &key, "20150830T123600Z"),
            "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
        );
        // GET Object and GET Bucket of the S3 documentation's examples.
        let key = Key { access: "AKIAIOSFODNN7EXAMPLE", secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", service: "s3" };
        let date = "20130524T000000Z";
        let object = [("host", "examplebucket.s3.amazonaws.com"), ("range", "bytes=0-9"), ("x-amz-content-sha256", EMPTY), ("x-amz-date", date)];
        assert!(authorization("GET", "/test.txt", "", &object, EMPTY, &key, date).ends_with("Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"));
        let list = [("host", "examplebucket.s3.amazonaws.com"), ("x-amz-content-sha256", EMPTY), ("x-amz-date", date)];
        let query = query_string(&[("prefix", "J"), ("max-keys", "2")]);
        assert_eq!(query, "max-keys=2&prefix=J");
        assert!(authorization("GET", "/", &query, &list, EMPTY, &key, date).ends_with("Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"));
        assert_eq!(encode("Tài liệu/a b+c.txt", true), "T%C3%A0i%20li%E1%BB%87u/a%20b%2Bc.txt");
        assert_eq!(amz_date(1_440_938_160), "20150830T123600Z");
    }

    #[test]
    fn list_objects_xml_parses_prefixes_and_keys() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>photos</Name><Prefix>2024/</Prefix><KeyCount>3</KeyCount>
<IsTruncated>true</IsTruncated><NextContinuationToken>1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM=</NextContinuationToken>
<Contents><Key>2024/</Key><LastModified>2024-02-29T12:00:00.000Z</LastModified><Size>0</Size></Contents>
<Contents><Key>2024/Hè &amp; Thu.jpg</Key><LastModified>2024-02-29T12:00:00.000Z</LastModified><ETag>"x"</ETag><Size>434234</Size><StorageClass>STANDARD</StorageClass></Contents>
<CommonPrefixes><Prefix>2024/Đà Lạt/</Prefix></CommonPrefixes></ListBucketResult>"#;
        let listing = parse(xml).unwrap();
        let t = unix(2024, 2, 29, 12, 0, 0);
        assert_eq!(listing.keys, vec![("2024/".into(), 0, t), ("2024/Hè & Thu.jpg".into(), 434_234, t)]);
        assert_eq!(listing.prefixes, ["2024/Đà Lạt/"]);
        assert_eq!(listing.next.as_deref(), Some("1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM="));
        let buckets = parse("<ListAllMyBucketsResult><Buckets><Bucket><Name>a</Name><CreationDate>2019-12-11T23:32:47+00:00</CreationDate></Bucket><Bucket><Name>b</Name></Bucket></Buckets></ListAllMyBucketsResult>").unwrap();
        assert_eq!(buckets.buckets.iter().map(|b| b.0.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        let error = parse("<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>").unwrap();
        assert_eq!(error.error, Some(("NoSuchBucket".into(), "The specified bucket does not exist".into())));
        assert_eq!(http_time("Wed, 12 Oct 2009 17:50:00 GMT"), unix(2009, 10, 12, 17, 50, 0));
        let s3 = S3::new(Connection { scheme: "oss".into(), region: "cn-hangzhou".into(), name: "x".into(), ..Default::default() }, Some("k".into())).unwrap();
        assert_eq!(s3.target(Some("photos")), ("https".into(), "photos.s3.oss-cn-hangzhou.aliyuncs.com".into(), String::new()));
        let minio = S3::new(Connection { scheme: "s3".into(), endpoint: "http://127.0.0.1:9000/".into(), name: "x".into(), ..Default::default() }, Some("k".into())).unwrap();
        assert_eq!(minio.target(Some("photos")), ("http".into(), "127.0.0.1:9000".into(), "/photos".into()));
        let aws = S3::new(Connection { scheme: "s3".into(), region: "ap-southeast-1".into(), name: "x".into(), ..Default::default() }, Some("k".into())).unwrap();
        assert_eq!(aws.target(Some("my.photos")).1, "s3.ap-southeast-1.amazonaws.com");
        assert_eq!(split(&Uri::parse("s3://id/photos/2024/a.jpg").unwrap()), (Some("photos".into()), "2024/a.jpg".into()));
    }
}
