//! The sizes of the folders in a tab, worked out in the background when the Size column is asked to show them. Each
//! folder adds up the files it holds, at any depth; results go to the page in batches, and a tab that moves on or
//! turns the column off stops the work. A size is kept for the session until something inside the folder changes.

use crate::{App, Proxy, UserEvent, ipc::event};
use serde_json::{Map, Value, json};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
use tao::window::WindowId;

/// How often a batch of sizes goes to the page.
const BATCH: Duration = Duration::from_millis(150);

fn cache() -> &'static Mutex<HashMap<PathBuf, u64>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, u64>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Forgets the sizes of the folders that hold `changed`, which are out of date.
pub fn forget(changed: &Path) {
    if let Ok(mut cache) = cache().lock() {
        cache.retain(|folder, _| !changed.starts_with(folder));
    }
}

/// The bytes of the files under `path`, not following links; None when cancelled.
pub fn folder_size(path: &Path, cancel: &AtomicBool) -> Option<u64> {
    let mut total = 0u64;
    let mut stack = vec![path.to_path_buf()];
    let mut seen = 0u32;
    while let Some(dir) = stack.pop() {
        let Ok(items) = fs::read_dir(&dir) else { continue };
        for item in items.flatten() {
            seen += 1;
            if seen % 256 == 0 && cancel.load(Ordering::Relaxed) {
                return None;
            }
            let Ok(meta) = item.metadata() else { continue };
            if meta.is_dir() {
                stack.push(item.path());
            } else {
                total += meta.len();
            }
        }
    }
    Some(total)
}

/// Starts working out the sizes of `folders` (name and path) for the tab `view` of `window`, and returns the flag that
/// stops it.
pub fn start(proxy: &Proxy, window: WindowId, view: String, folders: Vec<(String, PathBuf)>) -> Arc<AtomicBool> {
    let cancel = Arc::new(AtomicBool::new(false));
    let stop = cancel.clone();
    let proxy = proxy.clone();
    thread::Builder::new()
        .name(format!("sizes-{view}"))
        .spawn(move || {
            let mut batch = Map::new();
            let mut last = Instant::now();
            for (name, path) in folders {
                let known = cache().lock().ok().and_then(|c| c.get(&path).copied());
                let Some(size) = known.or_else(|| folder_size(&path, &stop)) else { return };
                if let Ok(mut cache) = cache().lock() {
                    cache.insert(path, size);
                }
                batch.insert(name, json!(size));
                if last.elapsed() >= BATCH {
                    send(&proxy, window, &view, std::mem::take(&mut batch));
                    last = Instant::now();
                }
                thread::yield_now();
            }
            if !batch.is_empty() && !stop.load(Ordering::Relaxed) {
                send(&proxy, window, &view, batch);
            }
        })
        .expect("a thread for folder sizes");
    cancel
}

fn send(proxy: &Proxy, window: WindowId, view: &str, sizes: Map<String, Value>) {
    let view = view.to_owned();
    proxy.send(UserEvent::Main(Box::new(move |app: &mut App| {
        for (name, size) in &sizes {
            app.views.set_size(&view, name, size.as_u64().unwrap_or(0));
        }
        let generation = app.views.get(&view, window).map(|v| v.generation).unwrap_or(0);
        app.post(window, event("view.sizes", json!({ "view": view, "generation": generation, "sizes": sizes })));
    })));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;

    #[test]
    fn folder_size_sums_recursively_and_stops_when_cancelled() {
        let t = Temp::new("sizes");
        t.file("d/a.txt", "12345");
        t.file("d/e/b.txt", "123");
        t.file("d/e/f/c.txt", "12");
        assert_eq!(folder_size(&t.0.join("d"), &AtomicBool::new(false)), Some(10));
        for i in 0..300 {
            t.file(&format!("many/{i}.txt"), "x");
        }
        assert_eq!(folder_size(&t.0.join("many"), &AtomicBool::new(true)), None);
        cache().lock().unwrap().insert(t.0.join("d"), 10);
        forget(&t.0.join("d/e/b.txt"));
        assert!(!cache().lock().unwrap().contains_key(&t.0.join("d")));
    }
}
