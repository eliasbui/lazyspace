//! The clouds whose own apps keep their files on this Mac: iCloud Drive, and the folders Google Drive, OneDrive,
//! Dropbox and Box put in `~/Library/CloudStorage` through the system's File Provider, which Finder lists under
//! Locations. Signing in is done in those apps; LazySpace only shows their folders.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, PartialEq)]
pub struct Cloud {
    /// What the sidebar calls it: "Google Drive", "OneDrive - Contoso".
    pub name: String,
    /// The signed in account when the folder's name tells it (Google Drive and Dropbox put it there).
    pub account: Option<String>,
    /// "icloud", "drive", "onedrive", "dropbox", "box" or "cloud", for its icon.
    pub service: &'static str,
    pub path: String,
}

/// The clouds on this Mac: iCloud Drive first, then the others by name.
pub fn clouds(home: &Path) -> Vec<Cloud> {
    let mut clouds = Vec::new();
    let icloud = home.join("Library/Mobile Documents/com~apple~CloudDocs");
    if icloud.is_dir() {
        clouds.push(Cloud { name: "iCloud Drive".into(), account: None, service: "icloud", path: icloud.to_string_lossy().into_owned() });
    }
    let mut others: Vec<Cloud> = std::fs::read_dir(home.join("Library/CloudStorage"))
        .map(|dir| {
            dir.flatten()
                .filter(|e| e.path().is_dir())
                .filter_map(|e| {
                    let folder = e.file_name().to_string_lossy().into_owned();
                    let (service, name, account) = describe(&folder)?;
                    Some(Cloud { name, account, service, path: e.path().to_string_lossy().into_owned() })
                })
                .collect()
        })
        .unwrap_or_default();
    others.sort_by_key(|c| c.name.to_lowercase());
    clouds.extend(others);
    clouds
}

/// The service, the name and the account of a folder of `~/Library/CloudStorage`, which each app names
/// `<Provider>-<what>`: `GoogleDrive-an@gmail.com`, `OneDrive-Personal`, `OneDrive-Contoso` (a work account),
/// `Dropbox`, `Box-Box`. None for a hidden folder.
fn describe(folder: &str) -> Option<(&'static str, String, Option<String>)> {
    if folder.starts_with('.') {
        return None;
    }
    let (provider, rest) = folder.split_once('-').map_or((folder, None), |(p, r)| (p, Some(r.to_owned()).filter(|r| !r.is_empty())));
    Some(match provider {
        "GoogleDrive" => ("drive", "Google Drive".into(), rest),
        "OneDrive" => match rest.as_deref() {
            None | Some("Personal") => ("onedrive", "OneDrive".into(), None),
            Some(work) => ("onedrive", format!("OneDrive - {work}"), None),
        },
        "Dropbox" => ("dropbox", "Dropbox".into(), rest.filter(|r| r != "Personal")),
        "Box" => ("box", "Box".into(), None),
        _ => ("cloud", folder.replace('-', " "), None),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_folders_are_named_as_their_apps_name_them() {
        assert_eq!(describe("GoogleDrive-an@gmail.com"), Some(("drive", "Google Drive".into(), Some("an@gmail.com".into()))));
        assert_eq!(describe("OneDrive-Personal"), Some(("onedrive", "OneDrive".into(), None)));
        assert_eq!(describe("OneDrive-Contoso Ltd"), Some(("onedrive", "OneDrive - Contoso Ltd".into(), None)));
        assert_eq!(describe("Dropbox"), Some(("dropbox", "Dropbox".into(), None)));
        assert_eq!(describe("Box-Box"), Some(("box", "Box".into(), None)));
        assert_eq!(describe("pCloud-Drive"), Some(("cloud", "pCloud Drive".into(), None)));
        assert_eq!(describe(".Trash"), None);
    }

    #[test]
    fn icloud_comes_first_and_the_others_by_name() {
        let home = std::env::temp_dir().join(format!("lazyspace-clouds-{}", std::process::id()));
        for dir in ["Library/Mobile Documents/com~apple~CloudDocs", "Library/CloudStorage/OneDrive-Personal", "Library/CloudStorage/GoogleDrive-an@gmail.com", "Library/CloudStorage/.hidden"] {
            std::fs::create_dir_all(home.join(dir)).unwrap();
        }
        std::fs::write(home.join("Library/CloudStorage/file.txt"), "").unwrap();
        let names: Vec<String> = clouds(&home).into_iter().map(|c| c.name).collect();
        std::fs::remove_dir_all(&home).unwrap();
        assert_eq!(names, ["iCloud Drive", "Google Drive", "OneDrive"]);
    }
}
