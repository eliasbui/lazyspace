//! The extensions of the core browser, each in its own module with its own methods (`<feature>.<verb>`), registered
//! here so none of them edits main.rs (design.md section 15).

pub mod actions;
pub mod archive;
pub mod desktop;
pub mod disk;
pub mod git;
pub mod hash;
pub mod history;
pub mod index;
pub mod menuedit;
pub mod openin;
pub mod preview;
pub mod remote;
pub mod rename;
pub mod search;
pub mod stash;
pub mod sync;
pub mod tags;
pub mod templates;
pub mod viewer;
pub mod workspaces;

use crate::ipc::Dispatcher;

pub fn register(d: &mut Dispatcher) {
    actions::register(d);
    archive::register(d);
    desktop::register(d);
    disk::register(d);
    git::register(d);
    hash::register(d);
    history::register(d);
    index::register(d);
    menuedit::register(d);
    openin::register(d);
    preview::register(d);
    remote::register(d);
    rename::register(d);
    search::register(d);
    stash::register(d);
    sync::register(d);
    tags::register(d);
    templates::register(d);
    viewer::register(d);
    workspaces::register(d);
}

/// The folder where the features keep their files, beside settings.json.
pub fn data_file(name: &str) -> std::path::PathBuf {
    crate::settings::settings_path().with_file_name(name)
}

/// The date and time in UTC of `secs` since 1970: year, month, day, hour, minute, second (Howard Hinnant's civil
/// calendar algorithm, so no date crate is needed).
pub fn civil(secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day, (rem / 3600) as u32, (rem % 3600 / 60) as u32, (rem % 60) as u32)
}

/// Seconds since 1970 of a date and time in UTC; the inverse of `civil`.
pub fn unix(year: i64, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> i64 {
    let y = year - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let m = i64::from(month);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146_097 + doe - 719_468) * 86_400 + i64::from(hour) * 3600 + i64::from(minute) * 60 + i64::from(second)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_and_unix_are_inverse() {
        assert_eq!(civil(0), (1970, 1, 1, 0, 0, 0));
        assert_eq!(civil(1_440_938_160), (2015, 8, 30, 12, 36, 0));
        assert_eq!(unix(2015, 8, 30, 12, 36, 0), 1_440_938_160);
        for secs in [-86_400 * 400, 951_782_400, 4_107_542_399, 1_709_164_800] {
            let (y, mo, d, h, mi, s) = civil(secs);
            assert_eq!(unix(y, mo, d, h, mi, s), secs, "{secs}");
        }
    }

    #[test]
    fn every_feature_registers_without_panicking() {
        let mut d = Dispatcher::new();
        register(&mut d);
        for area in ["archive", "desktop", "hash", "menuedit", "openin", "preview", "remote", "rename", "stash", "sync", "templates", "viewer", "workspaces"] {
            assert!(d.areas().contains(&area), "{area}");
        }
    }
}
