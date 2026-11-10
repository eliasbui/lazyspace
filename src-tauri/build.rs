use std::{fs, path::Path};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../ui");
    println!("cargo:rerun-if-changed=../dist-web");
    classic();
    tauri_build::build();
}

/// The classic page is `ui/index.html` with the scripts and styles of `ui/parts` put in where it marks them. Tauri serves
/// the folder `dist-web` (the build of the React front end), so the classic page is written beside it, as `classic.html`,
/// ahead of `tauri_build`, which needs the folder to exist. `LAZYSPACE_CLASSIC=1` opens it instead of the new page.
/// Each part goes in the order of its name, in a tag of its own so one that fails leaves the others running.
fn classic() {
    let mut files: Vec<_> = fs::read_dir("../ui/parts").map(|d| d.flatten().map(|e| e.path()).collect()).unwrap_or_default();
    files.sort();
    let mut parts = String::new();
    for path in &files {
        let text = fs::read_to_string(path).expect("a part of the page");
        assert!(!text.to_lowercase().contains("</script"), "{} must not contain </script>", path.display());
        match path.extension().and_then(|e| e.to_str()) {
            Some("css") => parts += &format!("<style>\n{text}</style>\n"),
            Some("js") => parts += &format!("<script>\n{text}</script>\n"),
            _ => {}
        }
    }
    let index = fs::read_to_string("../ui/index.html").expect("ui/index.html");
    assert!(index.contains("<!--parts-->"), "ui/index.html has lost the marker the parts go in at");
    let dir = Path::new("../dist-web");
    fs::create_dir_all(dir).expect("classic folder");
    // wry puts a frozen `window.ipc` on every page, and Tauri reads what it is given as its own messages, so the page's
    // `window.ipc.postMessage` is pointed at the host's bridge (`window.lazyHost`, made by main.rs `compat_script`).
    let page = index.replacen("<!--parts-->", &parts, 1).replace("window.ipc.postMessage(", "window.lazyHost.postMessage(");
    assert!(!page.contains("window.ipc"), "the page reaches window.ipc in a way the bridge does not cover");
    // Written only when it changed, so an unchanged page does not make Tauri embed its assets again.
    if fs::read_to_string(dir.join("classic.html")).ok().as_deref() != Some(page.as_str()) {
        fs::write(dir.join("classic.html"), page).expect("dist-web/classic.html");
    }
}
