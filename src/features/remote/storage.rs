//! The clouds whose own apps keep their files on this Mac: iCloud Drive, and the folders Google Drive, OneDrive,
//! Dropbox and Box put in `~/Library/CloudStorage` through the system's File Provider, which Finder lists under
//! Locations. Signing in is done in those apps; LazySpace only shows their folders.

use crate::tr;
use serde::Serialize;
use std::path::{Path, PathBuf};

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
/// `<Provider>-<what>`: `GoogleDrive-an@gmail.com`, `OneDrive-Personal`, `OneDrive-Contoso` (a work or school
/// account), `OneDrive-SharedLibraries-Contoso` (the SharePoint libraries of that organisation kept on this Mac),
/// `Dropbox`, `Box-Box`. None for a hidden folder.
fn describe(folder: &str) -> Option<(&'static str, String, Option<String>)> {
    if folder.starts_with('.') {
        return None;
    }
    let (provider, rest) = folder.split_once('-').map_or((folder, None), |(p, r)| (p, Some(r.to_owned()).filter(|r| !r.is_empty())));
    Some(match provider {
        "GoogleDrive" => ("drive", "Google Drive".into(), rest),
        "OneDrive" => match rest.as_deref() {
            None => ("onedrive", "OneDrive".into(), None),
            Some("Personal") => ("onedrive", format!("OneDrive - {}", tr("Cá nhân", "Personal")), None),
            Some(work) => match work.strip_prefix("SharedLibraries-").filter(|org| !org.is_empty()) {
                Some(org) => ("onedrive", format!("OneDrive - {org} ({})", tr("thư viện dùng chung", "shared libraries")), None),
                None => ("onedrive", format!("OneDrive - {work}"), None),
            },
        },
        "Dropbox" => ("dropbox", "Dropbox".into(), rest.filter(|r| r != "Personal")),
        "Box" => ("box", "Box".into(), None),
        _ => ("cloud", folder.replace('-', " "), None),
    })
}

/// The folder of the cloud that `path` is in: one of `~/Library/CloudStorage`, or iCloud Drive's. Places in two
/// clouds belong to two accounts though one disk keeps them, so a drop from one onto the other copies, as a drop onto
/// another disk does.
pub fn cloud_root(home: &Path, path: &Path) -> Option<PathBuf> {
    let storage = home.join("Library/CloudStorage");
    if let Ok(inside) = path.strip_prefix(&storage) {
        return inside.components().next().map(|first| storage.join(first));
    }
    let icloud = home.join("Library/Mobile Documents");
    path.starts_with(&icloud).then_some(icloud)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_folders_are_named_as_their_apps_name_them() {
        assert_eq!(describe("GoogleDrive-an@gmail.com"), Some(("drive", "Google Drive".into(), Some("an@gmail.com".into()))));
        let personal = describe("OneDrive-Personal").unwrap().1;
        assert!(personal == "OneDrive - Personal" || personal == "OneDrive - Cá nhân", "{personal}");
        assert_eq!(describe("OneDrive"), Some(("onedrive", "OneDrive".into(), None)));
        assert_eq!(describe("OneDrive-Contoso Ltd"), Some(("onedrive", "OneDrive - Contoso Ltd".into(), None)));
        let shared = describe("OneDrive-SharedLibraries-Contoso Ltd").unwrap().1;
        assert!(shared.starts_with("OneDrive - Contoso Ltd (") && !shared.contains("SharedLibraries"), "{shared}");
        assert_eq!(describe("OneDrive-SharedLibraries-"), Some(("onedrive", "OneDrive - SharedLibraries-".into(), None)));
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
        assert_eq!(names.len(), 3);
        assert_eq!(names[..2], ["iCloud Drive", "Google Drive"]);
        assert!(names[2].starts_with("OneDrive - "), "{}", names[2]);
    }

    #[test]
    fn places_in_different_clouds_have_different_roots() {
        let home = Path::new("/Users/an");
        let od = cloud_root(home, Path::new("/Users/an/Library/CloudStorage/OneDrive-Contoso/Docs/a.txt"));
        let gd = cloud_root(home, Path::new("/Users/an/Library/CloudStorage/GoogleDrive-an@gmail.com/My Drive"));
        assert_eq!(od, Some(PathBuf::from("/Users/an/Library/CloudStorage/OneDrive-Contoso")));
        assert!(gd.is_some() && od != gd);
        assert_eq!(cloud_root(home, Path::new("/Users/an/Library/CloudStorage/OneDrive-Contoso")), od);
        assert_eq!(cloud_root(home, Path::new("/Users/an/Library/Mobile Documents/com~apple~CloudDocs/x")), Some(PathBuf::from("/Users/an/Library/Mobile Documents")));
        assert_eq!(cloud_root(home, Path::new("/Users/an/Documents")), None);
        assert_eq!(cloud_root(home, Path::new("/Users/an/Library/CloudStorage")), None);
    }
}
