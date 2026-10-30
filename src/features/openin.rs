//! Opening the current folder, or an item, in a terminal or a code editor (W2): the well-known apps found by their
//! bundle ids, apps the user adds, and one of each kind chosen as the default for the toolbar's buttons.

use crate::{
    features::data_file,
    ipc::{Dispatcher, args},
    tr,
    vfs::Uri,
};
use objc2_app_kit::NSWorkspace;
use objc2_foundation::NSString;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Command,
};

/// The apps LazySpace knows: id, name, kind, bundle id.
const KNOWN: &[(&str, &str, &str, &str)] = &[
    ("terminal", "Terminal", "terminal", "com.apple.Terminal"),
    ("iterm2", "iTerm2", "terminal", "com.googlecode.iterm2"),
    ("warp", "Warp", "terminal", "dev.warp.Warp-Stable"),
    ("ghostty", "Ghostty", "terminal", "com.mitchellh.ghostty"),
    ("kitty", "kitty", "terminal", "net.kovidgoyal.kitty"),
    ("wezterm", "WezTerm", "terminal", "com.github.wez.wezterm"),
    ("hyper", "Hyper", "terminal", "co.zeit.hyper"),
    ("tabby", "Tabby", "terminal", "org.tabby"),
    ("vscode", "Visual Studio Code", "editor", "com.microsoft.VSCode"),
    ("cursor", "Cursor", "editor", "com.todesktop.230313mzl4w4u92"),
    ("zed", "Zed", "editor", "dev.zed.Zed"),
    ("sublime", "Sublime Text", "editor", "com.sublimetext.4"),
    ("nova", "Nova", "editor", "com.panic.Nova"),
    ("bbedit", "BBEdit", "editor", "com.barebones.bbedit"),
    ("xcode", "Xcode", "editor", "com.apple.dt.Xcode"),
    ("textedit", "TextEdit", "editor", "com.apple.TextEdit"),
];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Choices {
    pub terminal: Option<String>,
    pub editor: Option<String>,
    pub extra: Vec<Extra>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Extra {
    pub name: String,
    pub path: String,
    pub kind: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Tool {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub path: String,
    #[serde(rename = "default")]
    pub is_default: bool,
}

fn choices_path() -> PathBuf {
    data_file("openin.json")
}

fn load() -> Choices {
    std::fs::read_to_string(choices_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(choices: &Choices) -> Result<(), String> {
    let text = serde_json::to_string_pretty(choices).map_err(|e| e.to_string())?;
    let path = choices_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

fn installed(bundle: &str) -> Option<String> {
    NSWorkspace::sharedWorkspace().URLForApplicationWithBundleIdentifier(&NSString::from_str(bundle)).and_then(|u| u.path()).map(|p| p.to_string())
}

/// The tools on this Mac, terminals then editors, with the default of each kind (the user's choice, else the first
/// found: Terminal, and the first editor).
pub fn tools() -> Vec<Tool> {
    let choices = load();
    let mut tools: Vec<Tool> = KNOWN
        .iter()
        .filter_map(|(id, name, kind, bundle)| Some(Tool { id: (*id).into(), name: (*name).into(), kind: (*kind).into(), path: installed(bundle)?, is_default: false }))
        .collect();
    tools.extend(choices.extra.iter().filter(|e| Path::new(&e.path).exists()).map(|e| Tool { id: format!("app:{}", e.path), name: e.name.clone(), kind: e.kind.clone(), path: e.path.clone(), is_default: false }));
    for kind in ["terminal", "editor"] {
        let wanted = if kind == "terminal" { &choices.terminal } else { &choices.editor };
        let pick = tools.iter().position(|t| t.kind == kind && Some(&t.id) == wanted.as_ref()).or_else(|| tools.iter().position(|t| t.kind == kind));
        if let Some(i) = pick {
            tools[i].is_default = true;
        }
    }
    tools
}

/// The arguments of `/usr/bin/open` that open `target` in the app at `app`: a folder for a terminal (the item's own
/// folder when an item is given), the item itself for an editor. Ghostty, kitty and WezTerm take the folder as an
/// argument of their own rather than as a document.
pub fn command(id: &str, kind: &str, app: &str, target: &Path) -> Vec<OsString> {
    let dir = if kind == "terminal" && !target.is_dir() { target.parent().unwrap_or(target) } else { target };
    let mut args: Vec<OsString> = Vec::new();
    match id {
        "ghostty" => {
            args.extend(["-na".into(), app.into(), "--args".into()]);
            args.push(format!("--working-directory={}", dir.display()).into());
        }
        "kitty" => args.extend(["-na".into(), app.into(), "--args".into(), "--directory".into(), dir.into()]),
        "wezterm" => args.extend(["-na".into(), app.into(), "--args".into(), "start".into(), "--cwd".into(), dir.into()]),
        _ => args.extend(["-a".into(), app.into(), dir.into()]),
    }
    args
}

pub fn register(d: &mut Dispatcher) {
    d.on("openin.tools", |_, _, _| serde_json::to_value(tools()).map_err(|e| e.to_string()));
    d.on("openin.open", |_, _, a| {
        #[derive(Deserialize)]
        struct Open {
            tool: Option<String>,
            kind: Option<String>,
            uri: String,
        }
        let a: Open = args(a)?;
        let target = Uri::parse(&a.uri)?.local_path().ok_or_else(|| tr("Chỉ với thư mục trên máy", "Only for folders on this Mac").to_owned())?;
        let all = tools();
        let tool = match (&a.tool, &a.kind) {
            (Some(id), _) => all.iter().find(|t| &t.id == id),
            (None, Some(kind)) => all.iter().find(|t| &t.kind == kind && t.is_default),
            _ => None,
        }
        .ok_or_else(|| tr("Không tìm thấy ứng dụng này", "That app cannot be found").to_owned())?;
        Command::new("/usr/bin/open").args(command(&tool.id, &tool.kind, &tool.path, &target)).spawn().map_err(|e| e.to_string())?;
        // The tool used last becomes the default of its kind, as QSpace does.
        let mut choices = load();
        if tool.kind == "terminal" {
            choices.terminal = Some(tool.id.clone());
        } else {
            choices.editor = Some(tool.id.clone());
        }
        save(&choices)?;
        Ok(Value::Null)
    });
    d.on("openin.add", |_, _, a| {
        #[derive(Deserialize)]
        struct Add {
            path: String,
            kind: String,
        }
        let a: Add = args(a)?;
        let app = PathBuf::from(&a.path);
        if app.extension().is_none_or(|e| e != "app") || !app.join("Contents").is_dir() || !["terminal", "editor"].contains(&a.kind.as_str()) {
            return Err(tr("Hãy chọn một ứng dụng (.app)", "Choose an app (.app)").into());
        }
        let mut choices = load();
        let name = app.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        choices.extra.retain(|e| e.path != a.path);
        choices.extra.push(Extra { name, path: a.path, kind: a.kind });
        save(&choices)?;
        Ok(Value::Null)
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminals_get_the_folder_and_ghostty_its_own_argument() {
        let dir = std::env::temp_dir();
        let file = dir.join(format!("lazyspace-test-openin-{}.txt", std::process::id()));
        std::fs::write(&file, "x").unwrap();
        let args = command("terminal", "terminal", "/System/Applications/Utilities/Terminal.app", &file);
        assert_eq!(Path::new(args.last().unwrap()), dir.as_path(), "a terminal opens the item's folder");
        let args = command("vscode", "editor", "/Applications/Visual Studio Code.app", &file);
        assert_eq!(args.last().unwrap(), file.as_os_str(), "an editor opens the item itself");
        let args = command("ghostty", "terminal", "/Applications/Ghostty.app", &dir);
        assert_eq!(args[0], "-na");
        assert!(args.last().unwrap().to_string_lossy().starts_with("--working-directory=/"));
        std::fs::remove_file(&file).unwrap();
    }

    #[test]
    fn terminal_app_of_macos_is_found_and_is_the_default_terminal() {
        let tools = tools();
        let terminal = tools.iter().find(|t| t.id == "terminal").expect("Terminal is part of macOS");
        assert!(terminal.path.ends_with("Terminal.app"));
        assert_eq!(tools.iter().filter(|t| t.kind == "terminal" && t.is_default).count(), 1);
    }
}
