//! Disks and devices as they are plugged in. Every window hears of a disk mounted, unmounted or renamed
//! (`volumes.changed`), so its sidebar follows; the main window in front gets a note of what came (`devices.volume`,
//! `devices.device`) with what can be done with it: open or eject a disk, install the app a disk image holds, or open
//! the apps that read a phone or a camera, which macOS mounts as no disk. An app is installed as Finder copies one, with
//! ditto, so it keeps its signature and the quarantine Gatekeeper checks at its first launch; its image is ejected after.

use crate::{
    App, Proxy, UserEvent,
    ipc::{Dispatcher, args, event},
    jobs::{Ctx, Then},
    native::{
        devices::{self, Disk, VolumeEvent},
        trash, workspace,
    },
    tr,
    vfs::Uri,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};

/// The apps that read a phone or a camera, by the name the page asks for them with, and their bundle identifiers.
const HELPERS: [(&str, &str); 3] = [("photos", "com.apple.Photos"), ("image-capture", "com.apple.Image_Capture"), ("finder", "com.apple.finder")];

pub fn register(d: &mut Dispatcher) {
    d.on_start(|app| watch(&app.proxy));
    d.on("devices.install", |app, window, a| {
        #[derive(Deserialize)]
        struct Install {
            app: String,
            /// Whether the disk image the app is on is ejected after; one with other apps to install stays.
            #[serde(default = "yes")]
            eject: bool,
        }
        let Install { app: source, eject } = args(a)?;
        let source = PathBuf::from(source);
        let name = source.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if !name.to_ascii_lowercase().ends_with(".app") || !source.join("Contents").is_dir() {
            return Err(format!("\"{name}\": {}", tr("không phải một ứng dụng", "is not an app")));
        }
        let target = applications_folder().join(&name);
        let shown = stem(&target);
        // Finder will not replace an app that runs either: its files are in use.
        if workspace::app_running(&target) {
            return Err(format!("{shown} {}", tr("đang chạy. Hãy thoát ứng dụng rồi cài lại.", "is running. Quit it, then install again.")));
        }
        let then: Then = Box::new(move |app: &mut App, result: &Result<Value, String>| {
            if let Ok(done) = result {
                app.post(window, event("devices.installed", done.clone()));
            }
        });
        let title = format!("{} {shown}", tr("Cài", "Install"));
        let job = app.jobs.spawn(&app.proxy, Some(window), "copy", title, move |ctx| install(ctx, &source, &target, eject), Some(then));
        Ok(json!({ "job": job }))
    });
    d.on("devices.open_app", |_, _, a| {
        #[derive(Deserialize)]
        struct OpenApp {
            app: String,
        }
        let wanted = args::<OpenApp>(a)?.app;
        let (_, id) = HELPERS.iter().find(|(name, _)| *name == wanted).ok_or_else(|| format!("{}: {wanted}", tr("Ứng dụng không rõ", "Unknown app")))?;
        workspace::open_app(id)?;
        Ok(Value::Null)
    });
}

/// Starts listening to the system for disks and devices, for the life of the app.
fn watch(proxy: &Proxy) {
    let pages = proxy.clone();
    devices::observe_volumes(move |change| changed(&pages, change));
    let (added, removed) = (proxy.clone(), proxy.clone());
    devices::watch_usb(
        move |device| {
            // The names of the apps are asked of the system on the main thread, as AppKit wants.
            added.send(UserEvent::Main(Box::new(move |app: &mut App| {
                let mut note = json!(device);
                note["helpers"] = helpers_of(device.kind);
                to_front(app, "devices.device", note);
            })));
        },
        move |id| {
            removed.send(UserEvent::Post { window: None, message: event("devices.removed", json!({ "id": id })) });
        },
    );
}

/// Posts to the main window in front, where a note is seen; the others keep quiet.
fn to_front(app: &mut App, name: &str, data: Value) {
    if let Some(window) = app.menu_target() {
        app.post(window, event(name, data));
    }
}

fn changed(proxy: &Proxy, change: VolumeEvent) {
    let data = match &change {
        VolumeEvent::Mounted(path) => json!({ "kind": "mounted", "path": path }),
        VolumeEvent::Unmounted(path) => json!({ "kind": "unmounted", "path": path }),
        VolumeEvent::Renamed { from, to } => json!({ "kind": "renamed", "path": to, "from": from }),
    };
    proxy.send(UserEvent::Post { window: None, message: event("volumes.changed", data) });
    if let VolumeEvent::Mounted(path) = change {
        let proxy = proxy.clone();
        // hdiutil takes a moment, and the apps of an image are read from its disk.
        thread::spawn(move || {
            let Some(note) = describe(&path) else { return };
            proxy.send(UserEvent::Main(Box::new(move |app: &mut App| to_front(app, "devices.volume", note))));
        });
    }
}

/// What the note of a disk just mounted says: its name, kind and space, and for a disk image the file it was opened
/// from and the apps and installers at its top. None for a disk the sidebar does not show (hidden, or the system's),
/// and for the image Time Machine mounts for each backup to a server, which is no news.
fn describe(path: &Path) -> Option<Value> {
    let volume = workspace::volumes().into_iter().find(|v| Path::new(&v.path) == path)?;
    let image = devices::disk_image(path);
    if image.as_deref().is_some_and(time_machine) {
        return None;
    }
    let kind = kind_of(image.is_some(), devices::disk_of(path).as_ref());
    let (apps, packages) = if kind == "image" { contents(path, &applications_folder()) } else { (Vec::new(), Vec::new()) };
    Some(json!({
        "path": path,
        "uri": Uri::file(path).to_string(),
        "name": volume.name,
        "kind": kind,
        "ejectable": volume.ejectable,
        "total": volume.total,
        "free": volume.free,
        "image": image,
        "apps": apps,
        "packages": packages,
    }))
}

/// Whether a disk image is a backup of Time Machine on a server, which it opens from a hidden folder of its own.
fn time_machine(image: &Path) -> bool {
    image.starts_with("/Volumes/.timemachine") || image.extension().is_some_and(|e| e.eq_ignore_ascii_case("backupbundle"))
}

/// What a disk is, as its note names it: "image", "network", "internal", "usb", "card" (a memory card in the Mac's
/// own slot), "thunderbolt", or "external" for the rest. A file system with no disk under it is on the network.
fn kind_of(image: bool, disk: Option<&Disk>) -> &'static str {
    let Some(disk) = disk else { return if image { "image" } else { "network" } };
    let protocol = disk.protocol.to_ascii_lowercase();
    if image || protocol.contains("disk image") || protocol.contains("virtual") {
        "image"
    } else if disk.network {
        "network"
    } else if disk.internal {
        "internal"
    } else if protocol.contains("usb") {
        "usb"
    } else if protocol.contains("secure digital") || protocol == "sd" {
        "card"
    } else if protocol.contains("thunderbolt") || protocol.contains("pci") {
        "thunderbolt"
    } else {
        "external"
    }
}

/// The apps and the installer packages at the top of a disk image, by name, each app with the version it is and the
/// one installed in `folder`, if any. The shortcut to Applications an image offers to drag onto is a link, left out.
fn contents(volume: &Path, folder: &Path) -> (Vec<Value>, Vec<Value>) {
    let Ok(dir) = fs::read_dir(volume) else { return (Vec::new(), Vec::new()) };
    let mut items: Vec<(String, PathBuf, bool)> = dir
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let kind = e.file_type().ok()?;
            (!name.starts_with('.') && !kind.is_symlink()).then(|| (name, e.path(), kind.is_dir()))
        })
        .collect();
    items.sort_by_key(|(name, ..)| name.to_lowercase());
    let (mut apps, mut packages) = (Vec::new(), Vec::new());
    for (name, path, is_dir) in items {
        let ext = Path::new(&name).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        if ext == "app" && is_dir {
            let target = folder.join(&name);
            apps.push(json!({
                "path": path,
                "uri": Uri::file(&path).to_string(),
                "name": stem(&path),
                "version": devices::app_version(&path),
                "target": target,
                "installed": target.exists().then(|| devices::app_version(&target).unwrap_or_default()),
            }));
        } else if ext == "pkg" || ext == "mpkg" {
            packages.push(json!({ "path": path, "uri": Uri::file(&path).to_string(), "name": name }));
        }
    }
    (apps, packages)
}

/// Where an app is installed: the Mac's Applications folder, as Finder does, or the one in the home folder for a user
/// who may not write there (a standard account).
fn applications_folder() -> PathBuf {
    // SAFETY: the path is a C string that lives for the call.
    if unsafe { libc::access(c"/Applications".as_ptr(), libc::W_OK) } == 0 { PathBuf::from("/Applications") } else { dirs::home_dir().unwrap_or_default().join("Applications") }
}

fn yes() -> bool {
    true
}

/// The name of an app without ".app".
fn stem(app: &Path) -> String {
    app.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// The apps that read a device of `kind`, the likeliest first, with the names the Mac gives them.
fn helpers_of(kind: &str) -> Value {
    let wanted: &[&str] = match kind {
        "apple" => &["photos", "image-capture", "finder"],
        "camera" => &["image-capture", "photos"],
        _ => &["image-capture"],
    };
    let named = |id: &&str| {
        let bundle = HELPERS.iter().find(|(name, _)| name == id)?.1;
        Some(json!({ "id": id, "name": workspace::app_name(bundle)? }))
    };
    wanted.iter().filter_map(named).collect()
}

/// Copies the app at `source` to `target`, under a hidden name until it is whole, so a copy cut short leaves nothing
/// that looks like the app; the copy it replaces goes to the Trash. The disk image it came from is ejected after when
/// `eject` says so.
fn install(ctx: &Ctx, source: &Path, target: &Path, eject: bool) -> Result<Value, String> {
    let folder = target.parent().ok_or_else(|| tr("Không có thư mục chứa", "There is no enclosing folder").to_owned())?;
    fs::create_dir_all(folder).map_err(|e| format!("{}: {e}", folder.display()))?;
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let partial = folder.join(format!(".{name}.lazyspace-partial"));
    let _ = fs::remove_dir_all(&partial);
    let placed = copy_app(ctx, source, &partial, count_files(source).max(1)).and_then(|()| {
        if target.exists() {
            trash::trash(target)?;
        }
        fs::rename(&partial, target).map_err(|e| format!("{}: {e}", target.display()))
    });
    if let Err(e) = placed {
        let _ = fs::remove_dir_all(&partial);
        return Err(e);
    }
    let volume = workspace::volumes().into_iter().map(|v| PathBuf::from(v.path)).filter(|v| v != Path::new("/") && source.starts_with(v)).max_by_key(|v| v.as_os_str().len());
    let image = volume.as_deref().and_then(devices::disk_image);
    let ejected = match (&volume, &image) {
        (Some(volume), Some(_)) if eject => workspace::eject(volume).map(|()| true),
        _ => Ok(false),
    };
    Ok(json!({
        "name": stem(target),
        "path": target,
        "uri": Uri::file(target).to_string(),
        "folder": folder,
        "volume": volume,
        "image": image,
        "ejected": ejected == Ok(true),
        "ejectError": ejected.err(),
    }))
}

/// Copies with ditto, which keeps what an app needs (its links, modes and extended attributes, the quarantine among
/// them), counting the files it reports as it goes. A cancel stops it at once, even inside a large file.
fn copy_app(ctx: &Ctx, source: &Path, to: &Path, total: u64) -> Result<(), String> {
    let mut child = Command::new("/usr/bin/ditto").arg("-V").arg(source).arg(to).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let pid = child.id() as libc::pid_t;
    let lines = BufReader::new(child.stderr.take().ok_or("ditto")?);
    let (cancel, over) = (ctx.cancel_flag(), AtomicBool::new(false));
    let mut error = String::new();
    thread::scope(|scope| {
        scope.spawn(|| {
            while !over.load(Ordering::Relaxed) {
                if cancel.load(Ordering::Relaxed) {
                    // SAFETY: the child is ours and is not reaped before this thread ends.
                    unsafe { libc::kill(pid, libc::SIGTERM) };
                    break;
                }
                thread::sleep(Duration::from_millis(100));
            }
        });
        let mut done = 0;
        for line in lines.lines().map_while(Result::ok) {
            if let Some(file) = line.strip_prefix("copying file ").or_else(|| line.strip_prefix("copying symlink ")) {
                done += 1;
                let file = file.trim_end_matches('.').trim();
                ctx.progress(done.min(total), total, file.rsplit('/').next().unwrap_or(file));
            } else if let Some(said) = line.strip_prefix("ditto: ") {
                error = said.to_owned();
            }
        }
        over.store(true, Ordering::Relaxed);
    });
    let status = child.wait().map_err(|e| e.to_string())?;
    if ctx.cancelled() {
        return Err("cancelled".into());
    }
    if !status.success() {
        return Err(if error.is_empty() { tr("Không chép được ứng dụng", "The app could not be copied").into() } else { error });
    }
    Ok(())
}

/// The files and links in a folder and all it holds, for the progress of a copy.
fn count_files(path: &Path) -> u64 {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => fs::read_dir(path).map(|d| d.flatten().map(|e| count_files(&e.path())).sum()).unwrap_or(0),
        Ok(_) => 1,
        Err(_) => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{jobs::test_ctx, vfs::local::tests::Temp};

    fn info(version: &str) -> String {
        format!(r#"<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>{version}</string></dict></plist>"#)
    }

    #[test]
    fn a_disk_is_named_by_how_it_is_attached() {
        let disk = |protocol: &str| Disk { protocol: protocol.into(), ..Disk::default() };
        assert_eq!(kind_of(false, Some(&disk("USB"))), "usb");
        assert_eq!(kind_of(false, Some(&disk("Secure Digital"))), "card");
        assert_eq!(kind_of(false, Some(&disk("Thunderbolt"))), "thunderbolt");
        assert_eq!(kind_of(false, Some(&disk("PCI-Express"))), "thunderbolt");
        assert_eq!(kind_of(false, Some(&disk("SATA"))), "external");
        assert_eq!(kind_of(false, Some(&disk("Disk Image"))), "image", "DiskArbitration's word is enough");
        assert_eq!(kind_of(true, Some(&disk("USB"))), "image", "hdiutil's word wins");
        assert_eq!(kind_of(false, Some(&Disk { internal: true, ..disk("Apple Fabric") })), "internal");
        assert_eq!(kind_of(false, Some(&Disk { network: true, ..Disk::default() })), "network");
        assert_eq!(kind_of(false, None), "network");
    }

    #[test]
    fn the_images_of_time_machine_raise_no_note() {
        assert!(time_machine(Path::new("/Volumes/.timemachine/nas.local/5F1A/Backups/Mac.sparsebundle")));
        assert!(time_machine(Path::new("/Volumes/Share/Mac.backupbundle")));
        assert!(!time_machine(Path::new("/Users/me/Downloads/App.dmg")));
        assert!(!time_machine(Path::new("/Users/me/Work.sparsebundle")), "a sparse bundle of the user's own");
    }

    #[test]
    fn a_disk_image_offers_its_apps_and_installers_but_not_its_shortcut() {
        let t = Temp::new("devices-contents");
        t.file("Image/Zeta.app/Contents/Info.plist", &info("2.0"));
        t.file("Image/Alpha.app/Contents/Info.plist", &info("1.5"));
        t.file("Image/Setup.pkg", "xar");
        t.file("Image/Read Me.txt", "");
        t.file("Image/.background/back.png", "");
        t.file("Image/Fake.app", "a file, not a bundle");
        std::os::unix::fs::symlink("/Applications", t.0.join("Image/Applications")).unwrap();
        t.file("Installed/Zeta.app/Contents/Info.plist", &info("1.9"));
        let (apps, packages) = contents(&t.0.join("Image"), &t.0.join("Installed"));
        let names: Vec<&str> = apps.iter().filter_map(|a| a["name"].as_str()).collect();
        assert_eq!(names, ["Alpha", "Zeta"]);
        assert_eq!((apps[0]["version"].as_str(), &apps[0]["installed"]), (Some("1.5"), &Value::Null));
        assert_eq!((apps[1]["version"].as_str(), apps[1]["installed"].as_str()), (Some("2.0"), Some("1.9")));
        assert_eq!(apps[1]["target"], json!(t.0.join("Installed/Zeta.app")));
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0]["name"], "Setup.pkg");
        assert_eq!(contents(&t.0.join("Nowhere"), &t.0), (Vec::new(), Vec::new()));
    }

    #[test]
    fn an_app_is_installed_whole_with_its_links() {
        let t = Temp::new("devices-install");
        t.file("Image/Tool.app/Contents/Info.plist", &info("3.1"));
        t.file("Image/Tool.app/Contents/MacOS/tool", "#!/bin/sh\n");
        t.file("Image/Tool.app/Contents/Frameworks/F.framework/Versions/A/F", "lib");
        std::os::unix::fs::symlink("A", t.0.join("Image/Tool.app/Contents/Frameworks/F.framework/Versions/Current")).unwrap();
        let (ctx, _, _) = test_ctx();
        let target = t.0.join("Apps/Tool.app");
        let done = install(&ctx, &t.0.join("Image/Tool.app"), &target, true).unwrap();
        assert_eq!(done["name"], "Tool");
        assert_eq!(done["ejected"], false, "a folder is no disk image");
        assert_eq!(devices::app_version(&target).as_deref(), Some("3.1"));
        assert_eq!(fs::read_link(target.join("Contents/Frameworks/F.framework/Versions/Current")).unwrap(), Path::new("A"));
        assert_eq!(count_files(&target), 4);
        let left: Vec<String> = fs::read_dir(t.0.join("Apps")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(left, ["Tool.app"], "no partial copy is left beside it");
    }

    #[test]
    fn a_copy_that_fails_or_is_stopped_leaves_nothing() {
        let t = Temp::new("devices-install-stop");
        t.file("Image/Tool.app/Contents/Info.plist", &info("1.0"));
        t.file("Apps/keep.txt", "");
        let (ctx, _, cancel) = test_ctx();
        assert!(install(&ctx, &t.0.join("Image/Gone.app"), &t.0.join("Apps/Gone.app"), true).is_err());
        cancel.store(true, Ordering::Relaxed);
        assert_eq!(install(&ctx, &t.0.join("Image/Tool.app"), &t.0.join("Apps/Tool.app"), true), Err("cancelled".into()));
        let left: Vec<String> = fs::read_dir(t.0.join("Apps")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(left, ["keep.txt"]);
    }
}
