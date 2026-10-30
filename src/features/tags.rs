//! Finder's colour tags on items of this Mac (src/native/tags.rs), put on or taken off from the context menu; the list
//! shows them by each name, and a tag of the sidebar is a search for it (src/features/search.rs).

use crate::{
    ipc::{Dispatcher, args},
    native::tags,
    tr,
    vfs::Uri,
};
use serde::Deserialize;
use serde_json::Value;

pub fn register(d: &mut Dispatcher) {
    d.on("tags.set", |_, _, a| {
        #[derive(Deserialize)]
        struct Set {
            uris: Vec<String>,
            colour: u8,
            on: bool,
        }
        let a: Set = args(a)?;
        if !(1..=7).contains(&a.colour) {
            return Err(tr("Không có màu thẻ này", "There is no such tag colour").into());
        }
        for uri in &a.uris {
            let path = Uri::parse(uri)?.local_path().ok_or_else(|| tr("Chỉ gắn thẻ được cho tệp trên máy", "Only files on this Mac can be tagged").to_owned())?;
            tags::write(&path, &tags::toggled(tags::read(&path), a.colour, a.on))?;
        }
        Ok(Value::Null)
    });
}
