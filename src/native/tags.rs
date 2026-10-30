//! Finder's tags of an item, where the system keeps them: a binary property list of "name\ncolour" strings in the
//! extended attribute `com.apple.metadata:_kMDItemUserTags`, which Finder shows and Spotlight indexes. The colour is
//! Finder's number: 0 none, 1 grey, 2 green, 3 purple, 4 blue, 5 yellow, 6 red, 7 orange.

use objc2::{rc::Retained, runtime::AnyObject};
use objc2_foundation::{NSArray, NSData, NSPropertyListFormat, NSPropertyListMutabilityOptions, NSPropertyListSerialization, NSString};
use std::{
    ffi::{CStr, CString},
    io,
    os::unix::ffi::OsStrExt,
    path::Path,
};

const ATTR: &CStr = c"com.apple.metadata:_kMDItemUserTags";

/// The names Finder gives its seven colours, by number, which a tag of that colour is written with.
pub const COLOURS: [&str; 8] = ["", "Gray", "Green", "Purple", "Blue", "Yellow", "Red", "Orange"];

fn c_path(path: &Path) -> io::Result<CString> {
    CString::new(path.as_os_str().as_bytes()).map_err(io::Error::other)
}

/// The tags of the item at `path`, as (name, colour); none when it has none or they cannot be read. A link's own.
pub fn read(path: &Path) -> Vec<(String, u8)> {
    let Ok(c) = c_path(path) else { return Vec::new() };
    // SAFETY: both strings end in NUL; a null buffer of size 0 asks for the size alone.
    let size = unsafe { libc::getxattr(c.as_ptr(), ATTR.as_ptr(), std::ptr::null_mut(), 0, 0, libc::XATTR_NOFOLLOW) };
    if size <= 0 {
        return Vec::new();
    }
    let mut buf = vec![0u8; size as usize];
    // SAFETY: the buffer holds the `size` bytes asked for.
    let got = unsafe { libc::getxattr(c.as_ptr(), ATTR.as_ptr(), buf.as_mut_ptr().cast(), buf.len(), 0, libc::XATTR_NOFOLLOW) };
    if got <= 0 {
        return Vec::new();
    }
    buf.truncate(got as usize);
    parse(&buf)
}

/// The tags in the bytes of the attribute.
pub fn parse(bytes: &[u8]) -> Vec<(String, u8)> {
    let data = NSData::with_bytes(bytes);
    // SAFETY: the format may be null; the parser checks bytes of any kind.
    let Ok(list) = (unsafe { NSPropertyListSerialization::propertyListWithData_options_format_error(&data, NSPropertyListMutabilityOptions::Immutable, std::ptr::null_mut()) }) else {
        return Vec::new();
    };
    let Ok(list) = list.downcast::<NSArray>() else { return Vec::new() };
    list.iter().filter_map(|item| item.downcast::<NSString>().ok()).map(|text| split(&text.to_string())).collect()
}

fn split(text: &str) -> (String, u8) {
    match text.rsplit_once('\n') {
        Some((name, colour)) => (name.to_owned(), colour.trim().parse().unwrap_or(0).min(7)),
        None => (text.to_owned(), 0),
    }
}

/// The bytes of the attribute for `tags`.
pub fn encode(tags: &[(String, u8)]) -> Result<Vec<u8>, String> {
    let strings: Vec<Retained<NSString>> = tags.iter().map(|(name, colour)| NSString::from_str(&format!("{name}\n{colour}"))).collect();
    let array = NSArray::from_retained_slice(&strings);
    let object: &AnyObject = &array;
    // SAFETY: an array of strings is a property list; no write options are defined.
    let data = unsafe { NSPropertyListSerialization::dataWithPropertyList_format_options_error(object, NSPropertyListFormat::BinaryFormat_v1_0, 0) }
        .map_err(|e| e.localizedDescription().to_string())?;
    Ok(data.to_vec())
}

/// Gives the item at `path` exactly `tags`; none takes the attribute away.
pub fn write(path: &Path, tags: &[(String, u8)]) -> Result<(), String> {
    let c = c_path(path).map_err(|e| e.to_string())?;
    if tags.is_empty() {
        // SAFETY: both strings end in NUL.
        let done = unsafe { libc::removexattr(c.as_ptr(), ATTR.as_ptr(), libc::XATTR_NOFOLLOW) };
        let error = io::Error::last_os_error();
        return if done == 0 || error.raw_os_error() == Some(libc::ENOATTR) { Ok(()) } else { Err(format!("{}: {error}", path.display())) };
    }
    let bytes = encode(tags)?;
    // SAFETY: both strings end in NUL; the value is `bytes.len()` bytes long.
    let done = unsafe { libc::setxattr(c.as_ptr(), ATTR.as_ptr(), bytes.as_ptr().cast(), bytes.len(), 0, libc::XATTR_NOFOLLOW) };
    if done == 0 { Ok(()) } else { Err(format!("{}: {}", path.display(), io::Error::last_os_error())) }
}

/// The tags with a tag of `colour` put on, or taken off: a colour is one tag, whatever it was named.
pub fn toggled(mut tags: Vec<(String, u8)>, colour: u8, on: bool) -> Vec<(String, u8)> {
    let name = COLOURS.get(colour as usize).copied().unwrap_or_default();
    tags.retain(|(n, c)| *c != colour && n != name);
    if on && colour != 0 {
        tags.push((name.to_owned(), colour));
    }
    tags
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::local::tests::Temp;

    #[test]
    fn tags_roundtrip_through_the_attribute_as_finder_writes_it() {
        let t = Temp::new("tags");
        let file = t.file("a.txt", "a");
        assert!(read(&file).is_empty());
        let tags = vec![("Red".to_owned(), 6), ("Dự án".to_owned(), 0)];
        write(&file, &tags).unwrap();
        assert_eq!(read(&file), tags);
        let out = std::process::Command::new("/usr/bin/xattr").arg("-px").arg("com.apple.metadata:_kMDItemUserTags").arg(&file).output().unwrap();
        assert!(out.status.success() && out.stdout.starts_with(b"62 70 6C 69 73 74"), "a binary property list, as Finder's");
        write(&file, &[]).unwrap();
        assert!(read(&file).is_empty());
        write(&file, &[]).unwrap();
    }

    #[test]
    fn a_colour_is_one_tag_whatever_its_name() {
        let tags = vec![("Đỏ".to_owned(), 6), ("Work".to_owned(), 0)];
        assert_eq!(toggled(tags.clone(), 6, false), [("Work".to_owned(), 0)]);
        assert_eq!(toggled(tags.clone(), 6, true), [("Work".to_owned(), 0), ("Red".to_owned(), 6)], "put on again once, by Finder's name");
        assert_eq!(toggled(tags, 4, true).last(), Some(&("Blue".to_owned(), 4)));
        assert_eq!(split("Only a name"), ("Only a name".to_owned(), 0));
        assert!(parse(b"not a plist").is_empty());
    }
}
