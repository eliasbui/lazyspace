//! What the system does with files for the app: opening them, the apps that can open one, showing them in Finder, the
//! disks with their space, and ejecting one; and which app the system shows files and opens folders with. Ported in
//! part from figghost's volumes.rs.

use crate::tr;
use block2::RcBlock;
use objc2::{msg_send, rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSWorkspace, NSWorkspaceOpenConfiguration};
use objc2_foundation::{
    NSArray, NSBundle, NSError, NSFileManager, NSGlobalDomain, NSString, NSURL, NSURLVolumeAvailableCapacityForImportantUsageKey, NSURLVolumeIsEjectableKey,
    NSURLVolumeIsInternalKey, NSURLVolumeLocalizedNameKey, NSURLVolumeTotalCapacityKey, NSUserDefaults, NSVolumeEnumerationOptions,
};
use objc2_uniform_type_identifiers::UTTypeFolder;
use serde::Serialize;
use std::{path::Path, process::Command};

fn url_of(path: &Path) -> Retained<NSURL> {
    NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()))
}

fn number(value: Option<Retained<AnyObject>>) -> Option<i64> {
    // SAFETY: the volume capacities are NSNumbers.
    value.map(|v| unsafe { msg_send![&*v, longLongValue] })
}

fn flag(value: Option<Retained<AnyObject>>) -> bool {
    // SAFETY: the volume flags are NSNumber booleans.
    value.is_some_and(|v| unsafe { msg_send![&*v, boolValue] })
}

fn text(value: Option<Retained<AnyObject>>) -> Option<String> {
    value.and_then(|v| {
        // SAFETY: the localized name is an NSString.
        let s: Option<Retained<NSString>> = unsafe { msg_send![&*v, description] };
        s.map(|s| s.to_string())
    })
}

/// Opens each item with the app the system names for it.
pub fn open(paths: &[impl AsRef<Path>]) -> Result<(), String> {
    let workspace = NSWorkspace::sharedWorkspace();
    for path in paths {
        if !workspace.openURL(&url_of(path.as_ref())) {
            return Err(format!("\"{}\": {}", path.as_ref().display(), tr("không mở được", "could not be opened")));
        }
    }
    Ok(())
}

/// Opens the items with the app at `app`.
pub fn open_with(paths: &[impl AsRef<Path>], app: &Path) -> Result<(), String> {
    if !app.join("Contents").is_dir() {
        return Err(format!("\"{}\": {}", app.display(), tr("không phải một ứng dụng", "is not an app")));
    }
    let urls: Vec<Retained<NSURL>> = paths.iter().map(|p| url_of(p.as_ref())).collect();
    let urls = NSArray::from_retained_slice(&urls);
    let configuration = NSWorkspaceOpenConfiguration::configuration();
    NSWorkspace::sharedWorkspace().openURLs_withApplicationAtURL_configuration_completionHandler(&urls, &url_of(app), &configuration, None);
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct App {
    pub path: String,
    pub name: String,
    #[serde(rename = "default")]
    pub is_default: bool,
}

/// The apps that can open the item, the system's choice first, then the rest by name.
pub fn apps_for(path: &Path) -> Vec<App> {
    let workspace = NSWorkspace::sharedWorkspace();
    let url = url_of(path);
    let default = workspace.URLForApplicationToOpenURL(&url).and_then(|u| u.path()).map(|p| p.to_string());
    let manager = NSFileManager::defaultManager();
    let name_of = |p: &str| manager.displayNameAtPath(&NSString::from_str(p)).to_string().trim_end_matches(".app").to_owned();
    let mut apps: Vec<App> = workspace
        .URLsForApplicationsToOpenURL(&url)
        .iter()
        .filter_map(|u| u.path().map(|p| p.to_string()))
        .map(|p| App { name: name_of(&p), is_default: Some(&p) == default.as_ref(), path: p })
        .collect();
    apps.sort_by(|a, b| b.is_default.cmp(&a.is_default).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    apps.dedup_by(|a, b| a.path == b.path);
    apps
}

/// Shows the items selected in a Finder window. NSWorkspace hands them to the app the global `NSFileViewer` names,
/// which is LazySpace itself once it is the Mac's file viewer (or another Finder replacement); Finder is then asked by
/// name, as `get_info` does, with the paths as arguments of the script, not in its text.
pub fn reveal(paths: &[impl AsRef<Path>]) -> Result<(), String> {
    if file_viewer().is_none_or(|id| id.eq_ignore_ascii_case(FINDER_ID)) {
        let urls: Vec<Retained<NSURL>> = paths.iter().map(|p| url_of(p.as_ref())).collect();
        NSWorkspace::sharedWorkspace().activateFileViewerSelectingURLs(&NSArray::from_retained_slice(&urls));
        return Ok(());
    }
    let script = [
        "on run argv",
        "set found to {}",
        "repeat with p in argv",
        "set end of found to (POSIX file (contents of p) as alias)",
        "end repeat",
        "tell application \"Finder\"",
        "activate",
        "reveal found",
        "end tell",
        "end run",
    ];
    let mut command = Command::new("/usr/bin/osascript");
    for line in script {
        command.args(["-e", line]);
    }
    command.args(paths.iter().map(AsRef::as_ref)).spawn().map(drop).map_err(|e| e.to_string())
}

/// Finder's bundle identifier, and where it is.
pub const FINDER_ID: &str = "com.apple.finder";
const FINDER_APP: &str = "/System/Library/CoreServices/Finder.app";

/// The app the global `NSFileViewer` default names: the one every app's NSWorkspace asks to show a file
/// (`activateFileViewerSelectingURLs`, `selectFile:inFileViewerRootedAtPath:`), with a kAEOpenDocuments event of the
/// file itself. None while it is Finder by default.
pub fn file_viewer() -> Option<String> {
    // SAFETY: NSGlobalDomain is a process-lifetime constant.
    let global = NSUserDefaults::standardUserDefaults().persistentDomainForName(unsafe { NSGlobalDomain })?;
    let value = global.objectForKey(&NSString::from_str("NSFileViewer"))?;
    value.downcast::<NSString>().ok().map(|id| id.to_string()).filter(|id| !id.is_empty())
}

/// Names `id` as the file viewer of every app, or gives the role back to Finder when `id` is None. Written with
/// `defaults`, as NSUserDefaults can only replace the whole global domain, not one key of it.
pub fn set_file_viewer(id: Option<&str>) -> Result<(), String> {
    let mut command = Command::new("/usr/bin/defaults");
    match id {
        Some(id) => command.args(["write", "-g", "NSFileViewer", "-string", id]),
        None => command.args(["delete", "-g", "NSFileViewer"]),
    };
    let done = command.output().map_err(|e| e.to_string())?;
    // Deleting a key that is not there fails, and still leaves what was wanted.
    if done.status.success() || (id.is_none() && file_viewer().is_none()) {
        Ok(())
    } else {
        Err(tr("Không đổi được trình xem tệp của macOS", "The file viewer of macOS could not be changed").into())
    }
}

/// The bundle identifier of the app the system opens folders with (`open ~/Documents`, a folder another app opens):
/// Finder unless it was changed.
pub fn folder_app() -> Option<String> {
    // SAFETY: UTTypeFolder is a process-lifetime constant.
    let app = NSWorkspace::sharedWorkspace().URLForApplicationToOpenContentType(unsafe { UTTypeFolder })?;
    NSBundle::bundleWithURL(&app)?.bundleIdentifier().map(|id| id.to_string())
}

/// Makes the app at `app` the one the system opens folders with, or Finder when `app` is None. The app must declare
/// `public.folder` in its Info.plist (scripts/bundle-macos.sh). It waits for LaunchServices to answer, which may come
/// on the main thread, so it is called off it.
pub fn set_folder_app(app: Option<&Path>) -> Result<(), String> {
    let app = url_of(app.unwrap_or(Path::new(FINDER_APP)));
    let (sender, answer) = std::sync::mpsc::channel();
    let done = RcBlock::new(move |error: *mut NSError| {
        // SAFETY: the error, when there is one, lives for the call of the handler.
        let _ = sender.send(unsafe { error.as_ref() }.map(|e| e.localizedDescription().to_string()));
    });
    // SAFETY: UTTypeFolder is a process-lifetime constant.
    NSWorkspace::sharedWorkspace().setDefaultApplicationAtURL_toOpenContentType_completionHandler(&app, unsafe { UTTypeFolder }, Some(&done));
    match answer.recv_timeout(std::time::Duration::from_secs(20)) {
        Ok(None) => Ok(()),
        Ok(Some(error)) => Err(error),
        Err(_) => Err(tr("macOS không trả lời khi đổi ứng dụng mở thư mục", "macOS did not answer when the app for folders was changed").into()),
    }
}

/// Opens Finder's Get Info window of the item; the path goes in as an argument of the script, not into its text.
pub fn get_info(path: &Path) -> Result<(), String> {
    let script = ["on run argv", "tell application \"Finder\"", "activate", "open information window of (POSIX file (item 1 of argv) as alias)", "end tell", "end run"];
    let mut command = Command::new("/usr/bin/osascript");
    for line in script {
        command.args(["-e", line]);
    }
    command.arg(path).spawn().map(drop).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Volume {
    pub name: String,
    pub path: String,
    pub ejectable: bool,
    pub internal: bool,
    pub total: i64,
    pub free: i64,
}

/// The disks the system shows: the startup disk, then the others by name.
pub fn volumes() -> Vec<Volume> {
    // SAFETY: the keys are process-lifetime constants.
    let keys = unsafe {
        NSArray::from_slice(&[NSURLVolumeLocalizedNameKey, NSURLVolumeIsEjectableKey, NSURLVolumeIsInternalKey, NSURLVolumeTotalCapacityKey, NSURLVolumeAvailableCapacityForImportantUsageKey])
    };
    let Some(urls) = NSFileManager::defaultManager().mountedVolumeURLsIncludingResourceValuesForKeys_options(Some(&keys), NSVolumeEnumerationOptions::SkipHiddenVolumes) else {
        return Vec::new();
    };
    let mut volumes: Vec<Volume> = urls
        .iter()
        .filter_map(|url| {
            let path = url.path()?.to_string();
            let values = url.resourceValuesForKeys_error(&keys).ok()?;
            // SAFETY: the keys are process-lifetime constants.
            let get = |key: &NSString| values.objectForKey(key);
            let name = text(get(unsafe { NSURLVolumeLocalizedNameKey })).filter(|n| !n.is_empty()).unwrap_or_else(|| Path::new(&path).file_name().map_or(path.clone(), |n| n.to_string_lossy().into_owned()));
            Some(Volume {
                name,
                ejectable: flag(get(unsafe { NSURLVolumeIsEjectableKey })),
                internal: flag(get(unsafe { NSURLVolumeIsInternalKey })),
                total: number(get(unsafe { NSURLVolumeTotalCapacityKey })).unwrap_or(0),
                free: number(get(unsafe { NSURLVolumeAvailableCapacityForImportantUsageKey })).unwrap_or(0),
                path,
            })
        })
        .collect();
    volumes.sort_by(|a, b| (b.path == "/").cmp(&(a.path == "/")).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    volumes
}

/// The bytes free for the user on the disk that holds `path`.
pub fn free_space(path: &Path) -> Option<i64> {
    // SAFETY: the key is a process-lifetime constant.
    let key = unsafe { NSURLVolumeAvailableCapacityForImportantUsageKey };
    let values = url_of(path).resourceValuesForKeys_error(&NSArray::from_slice(&[key])).ok()?;
    number(values.objectForKey(key))
}

/// Unmounts the disk and lets it be unplugged; the error is the system's own sentence.
pub fn eject(path: &Path) -> Result<(), String> {
    NSWorkspace::sharedWorkspace().unmountAndEjectDeviceAtURL_error(&url_of(path)).map_err(|e| e.localizedDescription().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_startup_disk_comes_first_with_its_space() {
        let volumes = volumes();
        let first = volumes.first().expect("at least the startup disk");
        assert_eq!(first.path, "/");
        assert!(first.total > 0 && first.free > 0 && first.free <= first.total);
        assert!(free_space(Path::new("/")).unwrap_or(0) > 0);
    }

    #[test]
    fn text_files_have_an_app_to_open_them() {
        let file = std::env::temp_dir().join(format!("lazyspace-test-apps-{}.txt", std::process::id()));
        std::fs::write(&file, "x").unwrap();
        let apps = apps_for(&file);
        std::fs::remove_file(&file).unwrap();
        assert!(!apps.is_empty());
        assert!(apps[0].is_default, "the system's choice comes first");
        assert!(apps.iter().all(|a| a.path.ends_with(".app")));
    }
}
