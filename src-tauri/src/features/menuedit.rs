//! The context menu editor's side in Rust (W1): the user's arrangement of the menu (order, hidden items, icons,
//! separators) read and saved as menu.json, in the format src/contextmenu.rs applies.

use crate::{
    contextmenu::{self, MenuLayout},
    ipc::{Dispatcher, args},
    tr,
};
use serde::Deserialize;
use serde_json::Value;
use std::path::Path;

/// The most ids an arrangement may name.
const MAX_IDS: usize = 300;

/// An arrangement worth saving: ids that could be menu ids, icons that could be SF Symbol names.
pub fn check(layout: &MenuLayout) -> Result<(), String> {
    let id_ok = |id: &str| !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || ".-_:".contains(c));
    let ids = layout.order.iter().chain(&layout.hidden).chain(&layout.separators).chain(layout.icons.keys());
    if ids.clone().count() > MAX_IDS * 4 || !ids.clone().all(|id| id_ok(id)) {
        return Err(tr("Sắp xếp menu không hợp lệ", "The menu arrangement is not valid").into());
    }
    if !layout.icons.values().all(|name| !name.is_empty() && name.len() <= 80 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.')) {
        return Err(tr("Tên biểu tượng không hợp lệ", "An icon name is not valid").into());
    }
    Ok(())
}

pub fn save(path: &Path, layout: &MenuLayout) -> Result<(), String> {
    check(layout)?;
    let text = serde_json::to_string_pretty(layout).map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, text).map_err(|e| e.to_string())
}

pub fn register(d: &mut Dispatcher) {
    d.on("menuedit.get", |_, _, _| serde_json::to_value(contextmenu::layout()).map_err(|e| e.to_string()));
    d.on("menuedit.set", |_, _, a| {
        #[derive(Deserialize)]
        struct Set {
            layout: MenuLayout,
        }
        save(&contextmenu::layout_path(), &args::<Set>(a)?.layout)?;
        Ok(Value::Null)
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;
    use std::collections::HashMap;

    #[test]
    fn menuedit_set_validates_and_roundtrips_layout() {
        let t = Temp::new("menuedit");
        let file = t.0.join("menu.json");
        let layout = MenuLayout { order: vec!["trash".into(), "open".into()], hidden: vec!["getInfo".into()], icons: HashMap::from([("open".into(), "folder.fill".into())]), separators: vec!["trash".into()] };
        save(&file, &layout).unwrap();
        let back: MenuLayout = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(back, layout);
        let bad = MenuLayout { icons: HashMap::from([("open".into(), "<script>".into())]), ..MenuLayout::default() };
        assert!(save(&file, &bad).is_err());
        let bad = MenuLayout { order: vec!["a b".into()], ..MenuLayout::default() };
        assert!(save(&file, &bad).is_err());
    }
}
