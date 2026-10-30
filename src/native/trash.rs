//! Moving items to the Trash through the system (NSFileManager), keeping where each one went so LazySpace can put it
//! back (`Cmd+Z`). Finder's own Put Back needs Finder to do the deleting, which needs the Automation permission and is
//! slow; design.md section 8.5 chose this instead.

use crate::tr;
use objc2_foundation::{NSFileManager, NSString, NSURL};
use std::path::{Path, PathBuf};

/// Places that are never moved to the Trash or deleted from LazySpace, whatever the selection says.
pub fn protected(path: &Path) -> bool {
    let home = dirs::home_dir().unwrap_or_default();
    ["/", "/System", "/Users", "/Applications", "/Library", "/Volumes", "/private", "/usr", "/bin", "/sbin", "/etc", "/var"]
        .iter()
        .any(|p| path == Path::new(p))
        || path == home
        || path.parent() == Some(Path::new("/Volumes"))
}

/// Moves one item to the Trash of its disk and returns where it went.
pub fn trash(path: &Path) -> Result<PathBuf, String> {
    if protected(path) {
        return Err(format!("\"{}\": {}", path.display(), tr("không thể chuyển mục này vào Thùng rác", "this item cannot be moved to the Trash")));
    }
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let mut went = None;
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, Some(&mut went))
        .map_err(|e| format!("\"{}\": {}", path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), e.localizedDescription()))?;
    Ok(went.and_then(|u| u.path()).map(|p| PathBuf::from(p.to_string())).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_system_and_the_home_are_protected() {
        for p in ["/", "/System", "/Users", "/Applications", "/Volumes/Backup"] {
            assert!(protected(Path::new(p)), "{p}");
        }
        assert!(protected(&dirs::home_dir().unwrap()));
        assert!(!protected(Path::new("/Applications/Calculator.app")));
        assert!(!protected(&dirs::home_dir().unwrap().join("Desktop/a.txt")));
        assert!(trash(Path::new("/")).is_err());
    }
}
