//! The extensions of the core browser, each in its own module with its own methods (`<feature>.<verb>`), registered
//! here so none of them edits main.rs (design.md section 15).

pub mod hash;
pub mod menuedit;
pub mod openin;
pub mod preview;
pub mod rename;
pub mod templates;
pub mod workspaces;

use crate::ipc::Dispatcher;

pub fn register(d: &mut Dispatcher) {
    hash::register(d);
    menuedit::register(d);
    openin::register(d);
    preview::register(d);
    rename::register(d);
    templates::register(d);
    workspaces::register(d);
}

/// The folder where the features keep their files, beside settings.json.
pub fn data_file(name: &str) -> std::path::PathBuf {
    crate::settings::settings_path().with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_feature_registers_without_panicking() {
        let mut d = Dispatcher::new();
        register(&mut d);
        for area in ["hash", "menuedit", "openin", "preview", "rename", "templates", "workspaces"] {
            assert!(d.areas().contains(&area), "{area}");
        }
    }
}
