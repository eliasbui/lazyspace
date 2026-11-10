//! The icons of files as the system draws them, thumbnails of pictures, films and PDFs, and the name of a file's kind
//! in words ("JPEG image"), for the page. Icons are drawn at the size asked for and kept; files of one type share one.

use crate::{tr, vfs::Entry};
use block2::RcBlock;
use objc2::{AllocAnyThread, MainThreadMarker, Message};
use objc2_app_kit::{
    NSBitmapImageFileType, NSBitmapImageRep, NSCompositingOperation, NSDeviceRGBColorSpace, NSFontWeightBold, NSFontWeightLight, NSFontWeightMedium,
    NSFontWeightRegular, NSFontWeightSemibold, NSGraphicsContext, NSImage, NSImageSymbolConfiguration, NSWorkspace,
};
use objc2_core_foundation::CGSize;
use objc2_foundation::{NSDictionary, NSError, NSPoint, NSRect, NSSize, NSString, NSURL};
use objc2_quick_look_thumbnailing::{QLThumbnailGenerationRequest, QLThumbnailGenerationRequestRepresentationTypes, QLThumbnailGenerator, QLThumbnailRepresentation};
use objc2_uniform_type_identifiers::{UTType, UTTypeFolder};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex, OnceLock},
};

/// The most icons kept; past it the cache starts over.
const CACHE_MAX: usize = 4096;

fn cache() -> &'static Mutex<HashMap<(String, u32), Arc<Vec<u8>>>> {
    static CACHE: OnceLock<Mutex<HashMap<(String, u32), Arc<Vec<u8>>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The PNG of the icon `key` names (`ext:png`, `type:public.folder`, `path:/Applications/Mail.app`), `px` pixels
/// square. Draws on the main thread, where AppKit wants it; None elsewhere or when nothing can be drawn.
pub fn icon_png(key: &str, px: u32) -> Option<Arc<Vec<u8>>> {
    let px = px.clamp(16, 1024);
    if let Some(png) = cache().lock().ok()?.get(&(key.to_owned(), px)) {
        return Some(png.clone());
    }
    let mtm = MainThreadMarker::new()?;
    let workspace = NSWorkspace::sharedWorkspace();
    let image = if let Some(path) = key.strip_prefix("path:") {
        workspace.iconForFile(&NSString::from_str(path))
    } else {
        let ut = match (key.strip_prefix("ext:"), key.strip_prefix("type:")) {
            (Some(ext), _) => UTType::typeWithFilenameExtension(&NSString::from_str(ext)),
            (_, Some(id)) => UTType::typeWithIdentifier(&NSString::from_str(id)),
            _ => None,
        };
        let ut = ut.or_else(|| UTType::typeWithIdentifier(&NSString::from_str("public.data")))?;
        workspace.iconForContentType(&ut)
    };
    let png = Arc::new(png_at(mtm, &image, px)?);
    if let Ok(mut cache) = cache().lock() {
        if cache.len() >= CACHE_MAX {
            cache.clear();
        }
        cache.insert((key.to_owned(), px), png.clone());
    }
    Some(png)
}

/// The PNG of an SF Symbol, `px` pixels square, the symbol in proportion and centred, drawn in black on clear: the page
/// uses it as a mask and paints it in whatever colour the place wants. `spec` is `<name>` or `<weight>/<name>`, and the
/// name may list stand-ins after commas (`menubar.dock.rectangle,desktopcomputer`) for an older macOS that lacks the
/// first. None when this macOS has none of them.
pub fn symbol_png(spec: &str, px: u32) -> Option<Arc<Vec<u8>>> {
    let (weight, names) = parse_symbol(spec)?;
    let key = format!("symbol:{spec}");
    let px = px.clamp(16, 256);
    if let Some(png) = cache().lock().ok()?.get(&(key.clone(), px)) {
        return Some(png.clone());
    }
    let mtm = MainThreadMarker::new()?;
    let image = names.split(',').find_map(|name| NSImage::imageWithSystemSymbolName_accessibilityDescription(&NSString::from_str(name), None))?;
    // Drawn from a large point size, so the weight is the symbol's own at that weight rather than a thin one scaled up.
    let config = NSImageSymbolConfiguration::configurationWithPointSize_weight(64.0, weight);
    let image = image.imageWithSymbolConfiguration(&config).unwrap_or(image);
    let png = Arc::new(png_at(mtm, &image, px)?);
    if let Ok(mut cache) = cache().lock() {
        cache.insert((key, px), png.clone());
    }
    Some(png)
}

/// The weight and the names of a symbol's spec; None for a weight not known, or a name with anything but letters,
/// digits, dots and the commas between stand-ins.
fn parse_symbol(spec: &str) -> Option<(f64, &str)> {
    let (weight, names) = spec.split_once('/').unwrap_or(("regular", spec));
    let plain = !names.is_empty() && names.len() <= 160 && names.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == ',');
    plain.then_some(())?;
    Some((symbol_weight(weight)?, names))
}

/// The weight of a symbol by the name CSS would give it.
fn symbol_weight(name: &str) -> Option<f64> {
    // SAFETY: the weights are constants of AppKit, alive for the process.
    let weight = unsafe {
        match name {
            "light" => NSFontWeightLight,
            "regular" => NSFontWeightRegular,
            "medium" => NSFontWeightMedium,
            "semibold" => NSFontWeightSemibold,
            "bold" => NSFontWeightBold,
            _ => return None,
        }
    };
    Some(weight)
}

/// Draws `image` into a bitmap of `px` pixels square, in proportion and centred, and returns it as PNG; the image picks
/// its own best representation for that size, so the result is sharp.
fn png_at(_mtm: MainThreadMarker, image: &NSImage, px: u32) -> Option<Vec<u8>> {
    let side = px as isize;
    // SAFETY: a null planes pointer asks AppKit to allocate the pixels; the colour space name is a framework constant.
    let rep = unsafe {
        NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
            NSBitmapImageRep::alloc(),
            std::ptr::null_mut(),
            side,
            side,
            8,
            4,
            true,
            false,
            NSDeviceRGBColorSpace,
            0,
            0,
        )
    }?;
    let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&rep)?;
    NSGraphicsContext::saveGraphicsState_class();
    NSGraphicsContext::setCurrentContext(Some(&context));
    let side = px as f64;
    let size = image.size();
    let scale = (side / size.width.max(1.0)).min(side / size.height.max(1.0));
    let (w, h) = (size.width * scale, size.height * scale);
    let rect = NSRect::new(NSPoint::new((side - w) / 2.0, (side - h) / 2.0), NSSize::new(w, h));
    image.drawInRect_fromRect_operation_fraction(rect, NSRect::ZERO, NSCompositingOperation::SourceOver, 1.0);
    context.flushGraphics();
    NSGraphicsContext::restoreGraphicsState_class();
    png_of_rep(&rep)
}

fn png_of_rep(rep: &NSBitmapImageRep) -> Option<Vec<u8>> {
    // SAFETY: an empty properties dictionary is valid for PNG output.
    let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }?;
    Some(png.to_vec())
}

/// Asks Quick Look for a thumbnail of the file at `path`, `px` pixels on its longer side, and hands its PNG to `done`
/// on a thread of Quick Look's, or None when it has none (then the page keeps the icon).
pub fn thumbnail(path: &Path, px: u32, done: Box<dyn FnOnce(Option<Vec<u8>>) + Send>) {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let side = f64::from(px.clamp(16, 1024));
    // SAFETY: the request is made from a file URL, a size and a scale, as its initializer documents.
    let request = unsafe {
        QLThumbnailGenerationRequest::initWithFileAtURL_size_scale_representationTypes(
            QLThumbnailGenerationRequest::alloc(),
            &url,
            CGSize::new(side, side),
            1.0,
            QLThumbnailGenerationRequestRepresentationTypes::Thumbnail,
        )
    };
    let done = Mutex::new(Some(done));
    let handler = RcBlock::new(move |representation: *mut QLThumbnailRepresentation, _error: *mut NSError| {
        // SAFETY: Quick Look passes a live representation or null for the length of the call.
        let png = unsafe { representation.as_ref() }.and_then(|representation| {
            // SAFETY: a representation that was made has its image.
            let image = unsafe { representation.CGImage() };
            png_of_rep(&NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &image))
        });
        if let Some(done) = done.lock().ok().and_then(|mut d| d.take()) {
            done(png);
        }
    });
    // SAFETY: the shared generator lives for the process; the handler is a block of the documented signature.
    unsafe { QLThumbnailGenerator::sharedGenerator().generateBestRepresentationForRequest_completionHandler(&request, &handler) };
}

/// The kind of an item in words, as Finder's Kind column says it, with a capital first letter.
pub fn describe(entry: &Entry) -> String {
    static KINDS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    let kinds = KINDS.get_or_init(|| Mutex::new(HashMap::new()));
    let key = match entry.kind {
        "dir" | "app" | "link" => entry.kind.to_owned(),
        _ => format!("ext:{}", entry.ext),
    };
    if let Some(text) = kinds.lock().ok().and_then(|k| k.get(&key).cloned()) {
        return text;
    }
    let of = |ut: Option<objc2::rc::Retained<UTType>>| ut.and_then(|ut| ut.localizedDescription()).map(|d| d.to_string());
    let text = match entry.kind {
        // SAFETY: UTTypeFolder is a constant of the framework, alive for the process.
        "dir" => of(Some(unsafe { UTTypeFolder }.retain())),
        "app" => of(UTType::typeWithIdentifier(&NSString::from_str("com.apple.application-bundle"))),
        "link" => Some(tr("Liên kết", "Symbolic link").to_owned()),
        _ if entry.ext.is_empty() => None,
        _ => of(UTType::typeWithFilenameExtension(&NSString::from_str(&entry.ext))),
    }
    .unwrap_or_else(|| tr("Tài liệu", "Document").to_owned());
    let mut chars = text.chars();
    let text = chars.next().map(|c| c.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default();
    if let Ok(mut kinds) = kinds.lock() {
        kinds.insert(key, text.clone());
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(kind: &'static str, ext: &str) -> Entry {
        Entry { name: "x".into(), uri: "file:///x".into(), kind, is_dir: kind == "dir", size: 0, mtime: 0, ctime: 0, hidden: false, ext: ext.into(), icon: String::new() }
    }

    #[test]
    fn a_symbol_is_named_with_a_weight_and_stand_ins() {
        assert_eq!(parse_symbol("folder").map(|(_, n)| n), Some("folder"));
        assert_eq!(parse_symbol("medium/menubar.dock.rectangle,desktopcomputer").map(|(_, n)| n), Some("menubar.dock.rectangle,desktopcomputer"));
        assert!(parse_symbol("medium/folder").unwrap().0 > parse_symbol("folder").unwrap().0, "medium is heavier than regular");
        assert_eq!(parse_symbol("wide/folder"), None, "a weight not known");
        assert_eq!(parse_symbol("regular/"), None);
        assert_eq!(parse_symbol("folder/../x"), None);
        assert_eq!(parse_symbol("folder?x=1"), None);
    }

    #[test]
    fn kinds_are_described_in_words_with_a_capital() {
        let jpeg = describe(&entry("file", "jpg"));
        assert!(jpeg.to_lowercase().contains("jpeg"), "{jpeg}");
        let folder = describe(&entry("dir", ""));
        assert!(folder.chars().next().unwrap().is_uppercase(), "{folder}");
        assert!(!describe(&entry("file", "")).is_empty());
        assert!(!describe(&entry("file", "nosuchextensionatall")).is_empty());
    }
}
