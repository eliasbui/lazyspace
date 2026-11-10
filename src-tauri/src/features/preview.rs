//! The side preview (W4): what an item is (a picture, a film, a sound, a PDF, text, a folder or anything else) and
//! what the page shows beside it, with a film's size, frame rate, data rate and length from AVFoundation. The page
//! draws pictures, films, sounds and PDFs from `lazy://file`, and reads and saves small text through `fs.read_text`
//! and `fs.write_text`.

use crate::{
    UserEvent,
    ipc::{Dispatcher, args, event},
    tr,
    vfs::{Uri, registry},
};
use objc2_av_foundation::{AVAsset, AVMediaTypeAudio, AVMediaTypeVideo, AVURLAsset};
use objc2_foundation::{NSString, NSURL};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{fs::File, io::Read, path::Path, thread};

/// The largest text the preview edits; a larger file shows its start, read only.
pub const TEXT_MAX: u64 = 1 << 20;

const IMAGES: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp", "svg", "ico", "avif"];
const VIDEOS: &[&str] = &["mp4", "m4v", "mov", "webm", "mkv", "avi", "3gp"];
const AUDIOS: &[&str] = &["mp3", "m4a", "aac", "wav", "aiff", "aif", "flac", "ogg", "opus", "caf"];
const TEXTS: &[&str] = &[
    "txt", "md", "markdown", "json", "js", "mjs", "cjs", "ts", "tsx", "jsx", "rs", "py", "rb", "go", "java", "kt", "swift", "c", "h", "cc", "cpp", "hpp", "m", "mm", "cs", "php",
    "sh", "zsh", "bash", "fish", "html", "htm", "css", "scss", "less", "xml", "plist", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "log", "csv", "tsv", "sql", "lua",
    "vue", "svelte", "gradle", "properties", "gitignore", "dockerfile", "makefile", "tex", "srt", "vtt",
];

/// What the preview shows for an item, from its kind and extension, and for a file without a known extension from
/// its first bytes (text has no NUL and is UTF-8).
pub fn kind_of(path: &Path, is_dir: bool) -> &'static str {
    if is_dir {
        return "folder";
    }
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if IMAGES.contains(&ext.as_str()) {
        "image"
    } else if VIDEOS.contains(&ext.as_str()) {
        "video"
    } else if AUDIOS.contains(&ext.as_str()) {
        "audio"
    } else if ext == "pdf" {
        "pdf"
    } else if TEXTS.contains(&ext.as_str()) || looks_like_text(path) {
        "text"
    } else {
        "other"
    }
}

fn looks_like_text(path: &Path) -> bool {
    let mut head = [0u8; 4096];
    let Ok(n) = File::open(path).and_then(|mut f| f.read(&mut head)) else { return false };
    let head = &head[..n];
    if n == 0 || head.contains(&0) {
        return n == 0;
    }
    // A cut in the middle of a character at the end of the sample is not a reason to call it binary.
    match std::str::from_utf8(head) {
        Ok(_) => true,
        Err(e) => e.valid_up_to() + 4 >= n,
    }
}

/// The size, frame rate, data rate and length of a film or sound; nothing for a file AVFoundation cannot read.
#[allow(deprecated)]
pub fn media_info(path: &Path) -> Value {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    // SAFETY: an asset made from a file URL with no options, read on this thread only.
    let asset: objc2::rc::Retained<AVAsset> = objc2::rc::Retained::into_super(unsafe { AVURLAsset::URLAssetWithURL_options(&url, None) });
    // SAFETY: the duration of an asset is a plain CMTime.
    let time = unsafe { asset.duration() };
    let duration = if time.timescale > 0 { time.value as f64 / f64::from(time.timescale) } else { 0.0 };
    let mut info = json!({ "duration": duration });
    // SAFETY: the media type constants are process-lifetime values of AVFoundation.
    if let Some(video) = unsafe { AVMediaTypeVideo } {
        // SAFETY: the tracks of a loaded asset, asked for synchronously on a thread of the app's own.
        let tracks = unsafe { asset.tracksWithMediaType(video) };
        if let Some(track) = tracks.firstObject() {
            // SAFETY: plain values of a track.
            let (size, fps, rate) = unsafe { (track.naturalSize(), track.nominalFrameRate(), track.estimatedDataRate()) };
            info["video"] = json!({ "width": size.width.round(), "height": size.height.round(), "fps": (f64::from(fps) * 100.0).round() / 100.0, "dataRate": rate.round() });
        }
    }
    // SAFETY: as above.
    if let Some(audio) = unsafe { AVMediaTypeAudio } {
        // SAFETY: as above.
        let tracks = unsafe { asset.tracksWithMediaType(audio) };
        if let Some(track) = tracks.firstObject() {
            // SAFETY: a plain value of a track.
            info["audio"] = json!({ "dataRate": unsafe { track.estimatedDataRate() }.round() });
        }
    }
    info
}

/// Everything the preview needs to know of an item, worked out off the main thread.
fn info(uri: &Uri) -> Result<Value, String> {
    let entry = registry().get(uri)?.stat(uri)?;
    // An item inside an archive is previewed from a copy on this Mac, when it is not too big to copy for a look.
    let path = match uri.local_path() {
        Some(path) => path,
        None if entry.is_dir => return Ok(json!({ "uri": uri.to_string(), "kind": "folder", "type": crate::native::icons::describe(&entry), "entry": entry })),
        None if entry.size <= 256 << 20 => crate::vfs::materialize(uri)?,
        None => return Err(tr("Tệp quá lớn để xem trước từ đây", "The file is too large to preview from here").into()),
    };
    let is_dir = entry.kind == "dir" || (entry.kind == "link" && entry.is_dir);
    let kind = if entry.kind == "app" || entry.kind == "package" { "other" } else { kind_of(&path, is_dir) };
    let mut out = json!({ "uri": uri.to_string(), "kind": kind, "type": crate::native::icons::describe(&entry), "entry": entry, "local": Uri::file(&path).to_string() });
    if uri.local_path().is_none() {
        crate::protocol::allow_also(path.parent().map(Path::to_path_buf));
    }
    match kind {
        "video" | "audio" => out["media"] = media_info(&path),
        "folder" => out["items"] = json!(std::fs::read_dir(&path).map(|d| d.flatten().filter(|e| !e.file_name().to_string_lossy().starts_with('.')).count()).ok()),
        "text" => out["editable"] = json!(entry.size <= TEXT_MAX),
        _ => {}
    }
    Ok(out)
}

pub fn register(d: &mut Dispatcher) {
    d.on("preview.info", |app, window, a| {
        #[derive(Deserialize)]
        struct Info {
            uri: String,
        }
        let uri = Uri::parse(&args::<Info>(a)?.uri)?;
        let proxy = app.proxy.clone();
        thread::spawn(move || {
            let message = match info(&uri) {
                Ok(info) => event("preview.ready", info),
                Err(error) => event("preview.ready", json!({ "uri": uri.to_string(), "error": error })),
            };
            proxy.send(UserEvent::Post { window: Some(window), message });
        });
        Ok(Value::Null)
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;

    #[test]
    fn info_detects_kind_by_extension_and_content() {
        let t = Temp::new("preview-kind");
        assert_eq!(kind_of(&t.file("a.PNG", ""), false), "image");
        assert_eq!(kind_of(&t.file("a.mov", ""), false), "video");
        assert_eq!(kind_of(&t.file("a.pdf", ""), false), "pdf");
        assert_eq!(kind_of(&t.file("main.rs", "fn main() {}"), false), "text");
        assert_eq!(kind_of(&t.file("README", "plain words, Tiếng Việt"), false), "text");
        let binary = t.0.join("blob");
        std::fs::write(&binary, [0u8, 1, 2, 3, 255]).unwrap();
        assert_eq!(kind_of(&binary, false), "other");
        assert_eq!(kind_of(&t.0, true), "folder");
    }

    #[test]
    fn a_film_tells_its_size_frame_rate_data_rate_and_length() {
        // A film macOS ships; the test says nothing on a system without it.
        let film = Path::new("/System/Library/PrivateFrameworks/SiriSetup.framework/Versions/A/Resources/Siri Is Ready - 480 x 250.mp4");
        if !film.exists() {
            return;
        }
        let info = media_info(film);
        let (w, h) = (info["video"]["width"].as_f64().unwrap(), info["video"]["height"].as_f64().unwrap());
        assert!((w / h - 480.0 / 250.0).abs() < 0.01, "the shape its name gives: {info}");
        assert!(info["video"]["fps"].as_f64().unwrap() > 1.0 && info["video"]["dataRate"].as_f64().unwrap() > 1000.0, "{info}");
        assert!(info["duration"].as_f64().unwrap() > 0.5, "{info}");
    }

    #[test]
    fn a_file_avfoundation_cannot_read_gives_no_tracks() {
        let t = Temp::new("preview-media");
        let info = media_info(&t.file("fake.mp4", "not a film"));
        assert!(info.get("video").is_none());
    }
}
