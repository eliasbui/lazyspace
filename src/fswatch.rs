//! Following the folders open in tabs (FSEvents through notify), a few changes at a time: what changed in the last
//! 300 ms reaches the main thread as one set of folders, and the tabs that show them are listed again. Changes the
//! app makes itself come the same way, so there is one way a listing is brought up to date.

use crate::{App, Proxy, UserEvent};
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};
use std::{collections::HashSet, path::PathBuf, time::Duration};

/// How long changes gather before the tabs hear of them.
const DEBOUNCE: Duration = Duration::from_millis(300);

pub struct FsWatch {
    debouncer: Option<Debouncer<RecommendedWatcher, RecommendedCache>>,
    watched: HashSet<PathBuf>,
}

impl FsWatch {
    /// A watcher that hands each set of changed folders to `changed` on the main thread.
    pub fn new(proxy: Proxy, changed: fn(&mut App, HashSet<PathBuf>)) -> FsWatch {
        let debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
            let Ok(events) = result else { return };
            let folders = touched(events.iter().flat_map(|e| e.paths.iter()));
            if !folders.is_empty() {
                proxy.send(UserEvent::Main(Box::new(move |app: &mut App| changed(app, folders))));
            }
        })
        .map_err(|e| eprintln!("fswatch: {e}"))
        .ok();
        FsWatch { debouncer, watched: HashSet::new() }
    }

    /// A watcher that follows nothing, for a test.
    #[cfg(test)]
    pub fn none() -> FsWatch {
        FsWatch { debouncer: None, watched: HashSet::new() }
    }

    /// Follows exactly `folders`: starts on the new ones and stops on the ones no tab shows any more.
    pub fn set(&mut self, folders: impl IntoIterator<Item = PathBuf>) {
        let wanted: HashSet<PathBuf> = folders.into_iter().collect();
        let Some(debouncer) = &mut self.debouncer else { return };
        for gone in self.watched.difference(&wanted).cloned().collect::<Vec<_>>() {
            let _ = debouncer.unwatch(&gone);
            self.watched.remove(&gone);
        }
        for new in wanted.difference(&self.watched).cloned().collect::<Vec<_>>() {
            if debouncer.watch(&new, RecursiveMode::NonRecursive).is_ok() {
                self.watched.insert(new);
            }
        }
    }
}

/// The folders a change touches: the folder an item is in, and the item itself, in case a tab shows it (a folder
/// that was renamed or removed).
fn touched<'a>(paths: impl Iterator<Item = &'a PathBuf>) -> HashSet<PathBuf> {
    let mut folders = HashSet::new();
    for path in paths {
        folders.insert(path.clone());
        if let Some(parent) = path.parent() {
            folders.insert(parent.to_path_buf());
        }
    }
    folders
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn a_change_touches_its_folder_and_itself() {
        let paths = [PathBuf::from("/a/b/c.txt"), PathBuf::from("/a/d")];
        let touched = touched(paths.iter());
        for p in ["/a/b/c.txt", "/a/b", "/a/d", "/a"] {
            assert!(touched.contains(Path::new(p)), "{p}");
        }
    }
}
