//! The `lazy://` protocol the page loads pictures through: `lazy://icon/<px>/<key>` (the icon of a file type or an
//! item, see `vfs::Entry::icon`), `lazy://symbol/<px>/<name>` (an SF Symbol, for the menu editor),
//! `lazy://thumb/<px>/<path>` (a Quick Look thumbnail) and `lazy://file/<path>` (the
//! file itself, with ranges, for previews). Thumbnails and files are served only from the folders the app has open
//! (`allow`), so a page that went wrong still cannot read the disk at large. Anything else is 404.

use crate::native::icons;
use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use wry::{
    RequestAsyncResponder,
    http::{Request, Response, StatusCode, header},
};

pub const SCHEME: &str = "lazy";

/// The most bytes one ranged answer carries; the player asks again for the rest.
const MAX_RANGE: u64 = 8 << 20;

/// The folders whose files may be served: those open in a tab, which change as the tabs move, and those allowed for
/// the rest of the run.
fn allowed() -> &'static Mutex<(HashSet<PathBuf>, HashSet<PathBuf>)> {
    static ALLOWED: OnceLock<Mutex<(HashSet<PathBuf>, HashSet<PathBuf>)>> = OnceLock::new();
    ALLOWED.get_or_init(|| Mutex::new((HashSet::new(), HashSet::new())))
}

/// The folders open in a tab now.
pub fn allow(folders: impl IntoIterator<Item = PathBuf>) {
    if let Ok(mut set) = allowed().lock() {
        set.0 = folders.into_iter().collect();
    }
}

/// Adds a folder to those served for the rest of the run: the copy of an item previewed from inside an archive, or
/// the folder of an item the user put on the shelf.
pub fn allow_also(folder: Option<PathBuf>) {
    if let (Some(folder), Ok(mut set)) = (folder, allowed().lock()) {
        set.1.insert(folder);
    }
}

/// Whether `path` is directly in an allowed folder, or is one.
pub fn is_allowed(path: &Path) -> bool {
    let Ok(set) = allowed().lock() else { return false };
    let has = |p: &Path| set.0.contains(p) || set.1.contains(p);
    has(path) || path.parent().is_some_and(has)
}

pub fn handle(request: Request<Vec<u8>>, responder: RequestAsyncResponder) {
    let uri = request.uri();
    let host = uri.host().unwrap_or_default().to_owned();
    let path = uri.path().to_owned();
    let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let mut parts = path.trim_start_matches('/').splitn(2, '/');
    let (first, rest) = (parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
    match host.as_str() {
        "icon" => {
            let png = first.parse().ok().zip(decode(rest)).and_then(|(px, key)| icons::icon_png(&key, px));
            match png {
                Some(png) => responder.respond(image((*png).clone())),
                None => responder.respond(status(StatusCode::NOT_FOUND)),
            }
        }
        "symbol" => {
            let png = first.parse().ok().zip(decode(rest)).and_then(|(px, name)| icons::symbol_png(&name, px));
            match png {
                Some(png) => responder.respond(image((*png).clone())),
                None => responder.respond(status(StatusCode::NOT_FOUND)),
            }
        }
        "thumb" => {
            let Some((px, file)) = first.parse::<u32>().ok().zip(decode(rest).map(PathBuf::from)).filter(|(_, f)| is_allowed(f)) else {
                return responder.respond(status(StatusCode::NOT_FOUND));
            };
            icons::thumbnail(
                &file,
                px,
                Box::new(move |png| match png {
                    Some(png) => responder.respond(image(png)),
                    None => responder.respond(status(StatusCode::NOT_FOUND)),
                }),
            );
        }
        "file" => {
            let file = decode(&path.trim_start_matches('/')).map(PathBuf::from).filter(|f| is_allowed(f));
            match file.and_then(|f| serve(&f, range.as_deref()).ok()) {
                Some(response) => responder.respond(response),
                None => responder.respond(status(StatusCode::NOT_FOUND)),
            }
        }
        _ => responder.respond(status(StatusCode::NOT_FOUND)),
    }
}

/// The path or key in the URL, as the page encoded it with encodeURIComponent.
fn decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            out.push(u8::from_str_radix(std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok().filter(|s| !s.is_empty() && !s.contains('\0'))
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = code;
    response
}

fn image(png: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .header(header::CONTENT_TYPE, "image/png")
        .header(header::CACHE_CONTROL, "max-age=3600")
        .body(png)
        .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR))
}

/// A file, or the range of it the player asked for (`bytes=a-b`, `bytes=a-`), with the type its extension names.
fn serve(path: &Path, range: Option<&str>) -> std::io::Result<Response<Vec<u8>>> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let mime = mime_of(path);
    let (start, end, partial) = match range.and_then(|r| parse_range(r, len)) {
        Some((start, end)) => (start, end.min(start + MAX_RANGE - 1), true),
        None if len > MAX_RANGE => (0, MAX_RANGE - 1, true),
        None => (0, len.saturating_sub(1), false),
    };
    let mut body = vec![0; if len == 0 { 0 } else { (end - start + 1) as usize }];
    file.seek(SeekFrom::Start(start))?;
    file.read_exact(&mut body)?;
    let mut builder = Response::builder().header(header::CONTENT_TYPE, mime).header(header::ACCEPT_RANGES, "bytes");
    if partial {
        builder = builder.status(StatusCode::PARTIAL_CONTENT).header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"));
    }
    builder.body(body).map_err(std::io::Error::other)
}

/// `bytes=a-b` or `bytes=a-` within a file of `len` bytes, as `(a, b)`.
fn parse_range(range: &str, len: u64) -> Option<(u64, u64)> {
    let (a, b) = range.strip_prefix("bytes=")?.split_once('-')?;
    let start: u64 = a.trim().parse().ok()?;
    let end = if b.trim().is_empty() { len.checked_sub(1)? } else { b.trim().parse::<u64>().ok()?.min(len.checked_sub(1)?) };
    (start <= end).then_some((start, end))
}

fn mime_of(path: &Path) -> &'static str {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" => "image/heic",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "pdf" => "application/pdf",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "m4a" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "txt" | "md" | "log" | "csv" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_are_read_as_players_send_them() {
        assert_eq!(parse_range("bytes=0-1", 100), Some((0, 1)));
        assert_eq!(parse_range("bytes=10-", 100), Some((10, 99)));
        assert_eq!(parse_range("bytes=90-500", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=50-10", 100), None);
        assert_eq!(parse_range("bytes=0-1", 0), None);
        assert_eq!(parse_range("items=0-1", 100), None);
    }

    #[test]
    fn only_files_of_open_folders_are_served() {
        allow([PathBuf::from("/open/folder")]);
        assert!(is_allowed(Path::new("/open/folder/a.png")));
        assert!(is_allowed(Path::new("/open/folder")));
        assert!(!is_allowed(Path::new("/open/folder/sub/a.png")));
        assert!(!is_allowed(Path::new("/etc/hosts")));
        assert_eq!(decode("%2FUsers%2Fme%2Fa%20b.png").as_deref(), Some("/Users/me/a b.png"));
        assert_eq!(decode("a%00b"), None);
        assert_eq!(decode("%zz"), None);
    }

    #[test]
    fn a_range_of_a_file_is_served_with_its_length() {
        let dir = std::env::temp_dir().join(format!("lazyspace-test-serve-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("clip.mp4");
        std::fs::write(&file, b"0123456789").unwrap();
        let whole = serve(&file, None).unwrap();
        assert_eq!((whole.status(), whole.body().len()), (StatusCode::OK, 10));
        let part = serve(&file, Some("bytes=2-4")).unwrap();
        assert_eq!(part.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(part.body().as_slice(), b"234");
        assert_eq!(part.headers()[header::CONTENT_RANGE], "bytes 2-4/10");
        assert_eq!(part.headers()[header::CONTENT_TYPE], "video/mp4");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
