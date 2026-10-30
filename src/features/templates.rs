//! New files from templates (W2): the built-in kinds (text, Markdown, Word, Excel, scripts, HTML, JSON) and any file
//! the user puts in the templates folder, made in a folder under a name nothing there has ("Untitled.txt",
//! "Untitled 2.txt").

use crate::{
    App,
    browse::Undo,
    features::data_file,
    ipc::{Dispatcher, args},
    tr,
    vfs::{self, Uri, copy, registry},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

const DOCX: &[u8] = include_bytes!("../../assets/templates/Blank.docx");
const XLSX: &[u8] = include_bytes!("../../assets/templates/Blank.xlsx");

struct Builtin {
    id: &'static str,
    vi: &'static str,
    en: &'static str,
    ext: &'static str,
    bytes: &'static [u8],
    /// A script, made executable.
    exec: bool,
}

const BUILTIN: &[Builtin] = &[
    Builtin { id: "txt", vi: "Tài liệu văn bản", en: "Text Document", ext: "txt", bytes: b"", exec: false },
    Builtin { id: "md", vi: "Tài liệu Markdown", en: "Markdown Document", ext: "md", bytes: b"# \n", exec: false },
    Builtin { id: "docx", vi: "Tài liệu Word", en: "Word Document", ext: "docx", bytes: DOCX, exec: false },
    Builtin { id: "xlsx", vi: "Bảng tính Excel", en: "Excel Spreadsheet", ext: "xlsx", bytes: XLSX, exec: false },
    Builtin { id: "sh", vi: "Shell script", en: "Shell Script", ext: "sh", bytes: b"#!/bin/sh\n\n", exec: true },
    Builtin { id: "py", vi: "Python script", en: "Python Script", ext: "py", bytes: b"#!/usr/bin/env python3\n\n", exec: true },
    Builtin {
        id: "html",
        vi: "Trang HTML",
        en: "HTML Page",
        ext: "html",
        bytes: b"<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\">\n    <title></title>\n  </head>\n  <body>\n  </body>\n</html>\n",
        exec: false,
    },
    Builtin { id: "json", vi: "Tệp JSON", en: "JSON File", ext: "json", bytes: b"{}\n", exec: false },
];

#[derive(Debug, Serialize, PartialEq)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub ext: String,
    pub builtin: bool,
}

/// The folder of the user's own templates.
pub fn folder() -> PathBuf {
    data_file("templates")
}

/// The built-in templates, then the user's (every visible file of the templates folder, by name).
pub fn list(user: &Path) -> Vec<Template> {
    let mut out: Vec<Template> =
        BUILTIN.iter().map(|b| Template { id: b.id.into(), name: tr(b.vi, b.en).into(), ext: b.ext.into(), builtin: true }).collect();
    let mut own: Vec<Template> = fs::read_dir(user)
        .map(|d| {
            d.flatten()
                .filter(|e| e.path().is_file())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| !n.starts_with('.'))
                .map(|n| {
                    let path = Path::new(&n);
                    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| n.clone());
                    let ext = path.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default();
                    Template { id: format!("user:{n}"), name: stem, ext, builtin: false }
                })
                .collect()
        })
        .unwrap_or_default();
    own.sort_by_key(|t| t.name.to_lowercase());
    out.extend(own);
    out
}

/// Makes a file from the template `id` in the folder `into`, returns its URI.
pub fn create(into: &Uri, id: &str, user: &Path) -> Result<Uri, String> {
    let provider = registry().get(into)?;
    let (ext, bytes, exec): (String, Vec<u8>, bool) = match id.strip_prefix("user:") {
        Some(name) => {
            vfs::valid_name(name)?;
            let source = user.join(name);
            let bytes = fs::read(&source).map_err(|e| vfs::local::error(&source, &e))?;
            let ext = Path::new(name).extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default();
            (ext, bytes, false)
        }
        None => {
            let b = BUILTIN.iter().find(|b| b.id == id).ok_or_else(|| tr("Không có mẫu này", "There is no such template").to_owned())?;
            (b.ext.into(), b.bytes.to_vec(), b.exec)
        }
    };
    let base = if ext.is_empty() { tr("Không tên", "Untitled").to_owned() } else { format!("{}.{ext}", tr("Không tên", "Untitled")) };
    let name = if provider.stat(&into.join(&base)).is_ok() { copy::unique_name(&base, false, false, |n| provider.stat(&into.join(n)).is_ok()) } else { base };
    let target = into.join(&name);
    let mut writer = provider.write(&target)?;
    writer.write_all(&bytes).map_err(|e| e.to_string())?;
    writer.commit()?;
    if exec {
        if let Some(path) = target.local_path() {
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o755));
        }
    }
    Ok(target)
}

pub fn register(d: &mut Dispatcher) {
    d.on("templates.list", |_, _, _| serde_json::to_value(list(&folder())).map_err(|e| e.to_string()));
    d.on("templates.create", |app: &mut App, _, a| {
        #[derive(Deserialize)]
        struct Create {
            uri: String,
            id: String,
        }
        let a: Create = args(a)?;
        let into = Uri::parse(&a.uri)?;
        if into.local_path().is_none() {
            return crate::ipc::defer(app, move || {
                let target = create(&into, &a.id, &folder())?;
                serde_json::to_value(registry().get(&target)?.stat(&target)?).map_err(|e| e.to_string())
            });
        }
        let target = create(&into, &a.id, &folder())?;
        if let Some(path) = target.local_path() {
            app.browse.push_undo(Undo::Made { title: format!("{} \"{}\"", tr("Tạo tệp", "New File"), target.name()), made: vec![path] });
        }
        serde_json::to_value(registry().get(&target)?.stat(&target)?).map_err(|e| e.to_string())
    });
    d.on("templates.folder", |_, _, _| {
        let dir = folder();
        fs::create_dir_all(&dir).map_err(|e| vfs::local::error(&dir, &e))?;
        Ok(json!(Uri::file(&dir).to_string()))
    });
    d.on("templates.add", |_, _, a| {
        #[derive(Deserialize)]
        struct Add {
            uri: String,
        }
        let source = Uri::parse(&args::<Add>(a)?.uri)?.local_path().ok_or_else(|| tr("Chỉ với tệp trên máy", "Only for files on this Mac").to_owned())?;
        let dir = folder();
        fs::create_dir_all(&dir).map_err(|e| vfs::local::error(&dir, &e))?;
        let name = source.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let target = if dir.join(&name).exists() { dir.join(copy::unique_name(&name, false, false, |n| dir.join(n).exists())) } else { dir.join(&name) };
        fs::copy(&source, &target).map_err(|e| vfs::local::error(&source, &e))?;
        Ok(Value::Null)
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;

    #[test]
    fn created_file_gets_unique_name_and_template_bytes() {
        let t = Temp::new("templates");
        let user = t.0.join("user");
        let first = create(&t.uri(), "md", &user).unwrap();
        let second = create(&t.uri(), "md", &user).unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read_to_string(first.local_path().unwrap()).unwrap(), "# \n");
        assert!(second.name().ends_with(" 2.md"), "{}", second.name());
        let docx = create(&t.uri(), "docx", &user).unwrap();
        assert!(fs::read(docx.local_path().unwrap()).unwrap().starts_with(b"PK"), "a docx is a zip");
        assert!(create(&t.uri(), "nope", &user).is_err());
    }

    #[test]
    fn script_template_is_executable() {
        let t = Temp::new("templates-exec");
        let script = create(&t.uri(), "sh", &t.0).unwrap();
        let mode = fs::metadata(script.local_path().unwrap()).unwrap().permissions().mode();
        assert_eq!(mode & 0o111, 0o111);
    }

    #[test]
    fn user_templates_are_listed_after_the_builtin_ones() {
        let t = Temp::new("templates-user");
        t.file("user/Invoice.numbers", "x");
        t.file("user/.hidden", "x");
        let list = list(&t.0.join("user"));
        let last = list.last().unwrap();
        assert_eq!((last.id.as_str(), last.name.as_str(), last.ext.as_str(), last.builtin), ("user:Invoice.numbers", "Invoice", "numbers", false));
        assert!(list.iter().all(|t| t.id != "user:.hidden"));
        let made = create(&t.uri(), "user:Invoice.numbers", &t.0.join("user")).unwrap();
        assert_eq!(fs::read_to_string(made.local_path().unwrap()).unwrap(), "x");
        assert!(create(&t.uri(), "user:../escape", &t.0.join("user")).is_err());
    }
}
