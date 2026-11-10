//! The system's libarchive (/usr/lib/libarchive.2.dylib, linked through the SDK's libarchive.tbd), wrapped: a reader
//! of any archive it knows (zip with or without a password, 7z, rar 4 and 5, tar and its compressions, iso, cab, cpio,
//! xar, lha) and a writer of zip (optionally AES-256), 7z and tar archives. A password goes to libarchive in memory,
//! never on a command line.

use crate::tr;
use std::{
    ffi::{CStr, CString, c_char, c_int, c_long, c_uint, c_void},
    fs::{File, Metadata},
    io::{self, Read},
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

#[repr(C)]
pub struct RawArchive {
    _private: [u8; 0],
}

#[repr(C)]
pub struct RawEntry {
    _private: [u8; 0],
}

#[link(name = "archive")]
unsafe extern "C" {
    fn archive_read_new() -> *mut RawArchive;
    fn archive_read_support_filter_all(a: *mut RawArchive) -> c_int;
    fn archive_read_support_format_all(a: *mut RawArchive) -> c_int;
    fn archive_read_add_passphrase(a: *mut RawArchive, passphrase: *const c_char) -> c_int;
    fn archive_read_open_filename(a: *mut RawArchive, filename: *const c_char, block_size: usize) -> c_int;
    fn archive_read_next_header(a: *mut RawArchive, entry: *mut *mut RawEntry) -> c_int;
    fn archive_read_data(a: *mut RawArchive, buf: *mut c_void, size: usize) -> isize;
    fn archive_read_free(a: *mut RawArchive) -> c_int;
    fn archive_error_string(a: *mut RawArchive) -> *const c_char;
    fn archive_entry_pathname_utf8(e: *mut RawEntry) -> *const c_char;
    fn archive_entry_pathname(e: *mut RawEntry) -> *const c_char;
    fn archive_entry_size(e: *mut RawEntry) -> i64;
    fn archive_entry_mtime(e: *mut RawEntry) -> c_long;
    fn archive_entry_filetype(e: *mut RawEntry) -> u16;
    fn archive_entry_perm(e: *mut RawEntry) -> u16;
    fn archive_entry_symlink_utf8(e: *mut RawEntry) -> *const c_char;

    fn archive_write_new() -> *mut RawArchive;
    fn archive_write_set_format_zip(a: *mut RawArchive) -> c_int;
    fn archive_write_set_format_7zip(a: *mut RawArchive) -> c_int;
    fn archive_write_set_format_pax_restricted(a: *mut RawArchive) -> c_int;
    fn archive_write_add_filter_gzip(a: *mut RawArchive) -> c_int;
    fn archive_write_add_filter_xz(a: *mut RawArchive) -> c_int;
    fn archive_write_add_filter_bzip2(a: *mut RawArchive) -> c_int;
    fn archive_write_set_options(a: *mut RawArchive, options: *const c_char) -> c_int;
    fn archive_write_set_passphrase(a: *mut RawArchive, passphrase: *const c_char) -> c_int;
    fn archive_write_open_filename(a: *mut RawArchive, filename: *const c_char) -> c_int;
    fn archive_write_header(a: *mut RawArchive, entry: *mut RawEntry) -> c_int;
    fn archive_write_data(a: *mut RawArchive, buf: *const c_void, size: usize) -> isize;
    fn archive_write_finish_entry(a: *mut RawArchive) -> c_int;
    fn archive_write_close(a: *mut RawArchive) -> c_int;
    fn archive_write_free(a: *mut RawArchive) -> c_int;
    fn archive_entry_new() -> *mut RawEntry;
    fn archive_entry_free(e: *mut RawEntry);
    fn archive_entry_set_pathname_utf8(e: *mut RawEntry, name: *const c_char);
    fn archive_entry_set_size(e: *mut RawEntry, size: i64);
    fn archive_entry_set_filetype(e: *mut RawEntry, kind: c_uint);
    fn archive_entry_set_perm(e: *mut RawEntry, perm: u16);
    fn archive_entry_set_mtime(e: *mut RawEntry, sec: c_long, nsec: c_long);
    fn archive_entry_set_symlink_utf8(e: *mut RawEntry, target: *const c_char);
}

const OK: c_int = 0;
const EOF: c_int = 1;
const WARN: c_int = -20;
const AE_IFMT: u16 = 0o170000;
const AE_IFREG: u16 = 0o100000;
const AE_IFDIR: u16 = 0o040000;
const AE_IFLNK: u16 = 0o120000;

/// What libarchive puts first in an error that wants a password, so the caller can ask for one.
pub fn wants_password(error: &str) -> bool {
    let e = error.to_lowercase();
    e.contains("passphrase") || e.contains("encrypt") || e.contains("password")
}

fn c_path(path: &Path) -> Result<CString, String> {
    use std::os::unix::ffi::OsStrExt;
    CString::new(path.as_os_str().as_bytes()).map_err(|_| tr("Tên không hợp lệ", "Not a valid name").to_owned())
}

fn text(p: *const c_char) -> Option<String> {
    // SAFETY: libarchive returns a NUL-terminated string that lives until the next call on the same object, or null.
    (!p.is_null()).then(|| unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned())
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    File,
    Dir,
    Link,
    /// A device, a fifo or a hard link: never made on disk.
    Other,
}

/// The header of one item of an archive.
#[derive(Debug, Clone)]
pub struct Header {
    pub path: String,
    pub size: u64,
    pub mtime: i64,
    pub kind: Kind,
    pub perm: u32,
    pub link: Option<String>,
}

/// An archive being read: headers one after the other, and the bytes of the item whose header came last.
pub struct Reader {
    a: *mut RawArchive,
}

// SAFETY: a libarchive handle may move between threads as long as one thread at a time uses it, which `&mut self`
// guarantees.
unsafe impl Send for Reader {}

impl Reader {
    pub fn open(path: &Path, password: Option<&str>) -> Result<Reader, String> {
        let name = c_path(path)?;
        // SAFETY: a new handle, set up and opened as libarchive documents; freed by Drop.
        unsafe {
            let a = archive_read_new();
            if a.is_null() {
                return Err("libarchive".into());
            }
            let reader = Reader { a };
            archive_read_support_filter_all(a);
            archive_read_support_format_all(a);
            if let Some(pw) = password {
                let pw = CString::new(pw).map_err(|_| tr("Mật khẩu không hợp lệ", "Not a valid password").to_owned())?;
                archive_read_add_passphrase(a, pw.as_ptr());
            }
            if archive_read_open_filename(a, name.as_ptr(), 1 << 16) != OK {
                return Err(reader.error());
            }
            Ok(reader)
        }
    }

    fn error(&self) -> String {
        // SAFETY: the handle is live.
        text(unsafe { archive_error_string(self.a) }).unwrap_or_else(|| tr("Không đọc được tệp nén", "The archive cannot be read").into())
    }

    /// The next header, or None at the end.
    pub fn next(&mut self) -> Result<Option<Header>, String> {
        let mut e: *mut RawEntry = std::ptr::null_mut();
        // SAFETY: the handle is live; the entry belongs to it until the next call.
        let status = unsafe { archive_read_next_header(self.a, &mut e) };
        match status {
            EOF => Ok(None),
            OK | WARN => {
                // SAFETY: a header just read; its strings live until the next call, and are copied out here.
                let header = unsafe {
                    let kind = match archive_entry_filetype(e) & AE_IFMT {
                        AE_IFREG => Kind::File,
                        AE_IFDIR => Kind::Dir,
                        AE_IFLNK => Kind::Link,
                        _ => Kind::Other,
                    };
                    Header {
                        path: text(archive_entry_pathname_utf8(e)).or_else(|| text(archive_entry_pathname(e))).unwrap_or_default(),
                        size: archive_entry_size(e).max(0) as u64,
                        mtime: archive_entry_mtime(e) as i64,
                        kind,
                        perm: u32::from(archive_entry_perm(e)),
                        link: if kind == Kind::Link { text(archive_entry_symlink_utf8(e)) } else { None },
                    }
                };
                Ok(Some(header))
            }
            _ => Err(self.error()),
        }
    }

}

impl Read for Reader {
    /// The bytes of the item whose header came last.
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        // SAFETY: the buffer is valid for `buf.len()` bytes; the handle is live.
        let n = unsafe { archive_read_data(self.a, buf.as_mut_ptr().cast(), buf.len()) };
        if n < 0 { Err(io::Error::other(self.error())) } else { Ok(n as usize) }
    }
}

impl Drop for Reader {
    fn drop(&mut self) {
        // SAFETY: the handle was made by archive_read_new and is freed once.
        unsafe { archive_read_free(self.a) };
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Format {
    Zip,
    SevenZip,
    Tar,
    TarGz,
    TarXz,
    TarBz2,
}

impl Format {
    pub fn parse(name: &str) -> Option<Format> {
        Some(match name {
            "zip" => Format::Zip,
            "7z" => Format::SevenZip,
            "tar" => Format::Tar,
            "tar.gz" => Format::TarGz,
            "tar.xz" => Format::TarXz,
            "tar.bz2" => Format::TarBz2,
            _ => return None,
        })
    }

    pub fn extension(self) -> &'static str {
        match self {
            Format::Zip => "zip",
            Format::SevenZip => "7z",
            Format::Tar => "tar",
            Format::TarGz => "tar.gz",
            Format::TarXz => "tar.xz",
            Format::TarBz2 => "tar.bz2",
        }
    }
}

/// An archive being written.
pub struct Writer {
    a: *mut RawArchive,
}

// SAFETY: as for Reader.
unsafe impl Send for Writer {}

impl Writer {
    /// Starts an archive at `path` in `format`, compressed at `level` (0 to 9), encrypted with AES-256 when a password is
    /// given (zip only: libarchive cannot encrypt 7z).
    pub fn create(path: &Path, format: Format, password: Option<&str>, level: Option<u8>) -> Result<Writer, String> {
        let name = c_path(path)?;
        // SAFETY: a new handle, set up and opened as libarchive documents; freed by Drop.
        unsafe {
            let a = archive_write_new();
            if a.is_null() {
                return Err("libarchive".into());
            }
            let writer = Writer { a };
            let status = match format {
                Format::Zip => archive_write_set_format_zip(a),
                Format::SevenZip => archive_write_set_format_7zip(a),
                _ => archive_write_set_format_pax_restricted(a),
            };
            let filter = match format {
                Format::TarGz => archive_write_add_filter_gzip(a),
                Format::TarXz => archive_write_add_filter_xz(a),
                Format::TarBz2 => archive_write_add_filter_bzip2(a),
                _ => OK,
            };
            if status != OK || filter != OK {
                return Err(writer.error());
            }
            let mut options = Vec::new();
            if let Some(level) = level {
                let level = level.min(9);
                options.push(match format {
                    Format::Zip => format!("zip:compression-level={level}"),
                    Format::SevenZip => format!("7zip:compression-level={level}"),
                    Format::TarGz => format!("gzip:compression-level={level}"),
                    Format::TarXz => format!("xz:compression-level={level}"),
                    Format::TarBz2 => format!("bzip2:compression-level={}", level.max(1)),
                    Format::Tar => String::new(),
                });
            }
            if let Some(pw) = password {
                if format != Format::Zip {
                    return Err(tr("Chỉ zip mới đặt mật khẩu qua libarchive", "Only zip takes a password through libarchive").into());
                }
                options.push("zip:encryption=aes256".into());
                let pw = CString::new(pw).map_err(|_| tr("Mật khẩu không hợp lệ", "Not a valid password").to_owned())?;
                archive_write_set_passphrase(a, pw.as_ptr());
            }
            for option in options.iter().filter(|o| !o.is_empty()) {
                let option = CString::new(option.as_str()).map_err(|e| e.to_string())?;
                if archive_write_set_options(a, option.as_ptr()) < WARN {
                    return Err(writer.error());
                }
            }
            if archive_write_open_filename(a, name.as_ptr()) != OK {
                return Err(writer.error());
            }
            Ok(writer)
        }
    }

    fn error(&self) -> String {
        // SAFETY: the handle is live.
        text(unsafe { archive_error_string(self.a) }).unwrap_or_else(|| tr("Không ghi được tệp nén", "The archive cannot be written").into())
    }

    fn header(&mut self, name: &str, kind: u16, meta: &Metadata, size: u64, link: Option<&str>) -> Result<(), String> {
        let c_name = CString::new(name).map_err(|_| tr("Tên không hợp lệ", "Not a valid name").to_owned())?;
        let c_link = link.map(CString::new).transpose().map_err(|_| tr("Tên không hợp lệ", "Not a valid name").to_owned())?;
        // SAFETY: an entry made, filled, written and freed here; the strings outlive the calls that read them.
        unsafe {
            let e = archive_entry_new();
            archive_entry_set_pathname_utf8(e, c_name.as_ptr());
            archive_entry_set_filetype(e, c_uint::from(kind));
            archive_entry_set_perm(e, (meta.permissions().mode() & 0o777) as u16);
            archive_entry_set_size(e, size as i64);
            archive_entry_set_mtime(e, meta.mtime() as c_long, 0);
            if let Some(link) = &c_link {
                archive_entry_set_symlink_utf8(e, link.as_ptr());
            }
            let status = archive_write_header(self.a, e);
            archive_entry_free(e);
            if status < WARN {
                return Err(self.error());
            }
        }
        Ok(())
    }

    pub fn add_dir(&mut self, name: &str, meta: &Metadata) -> Result<(), String> {
        self.header(&format!("{}/", name.trim_end_matches('/')), AE_IFDIR, meta, 0, None)
    }

    pub fn add_link(&mut self, name: &str, target: &str, meta: &Metadata) -> Result<(), String> {
        self.header(name, AE_IFLNK, meta, 0, Some(target))
    }

    /// Adds the file at `path` as `name`; `progress` hears the bytes written so far and stops with false.
    pub fn add_file(&mut self, name: &str, path: &Path, meta: &Metadata, cancel: &AtomicBool, mut progress: impl FnMut(u64)) -> Result<(), String> {
        self.header(name, AE_IFREG, meta, meta.len(), None)?;
        let mut file = File::open(path).map_err(|e| crate::vfs::local::error(path, &e))?;
        let mut buf = vec![0u8; 1 << 20];
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(tr("Đã hủy", "Cancelled").into());
            }
            let n = file.read(&mut buf).map_err(|e| crate::vfs::local::error(path, &e))?;
            if n == 0 {
                break;
            }
            // SAFETY: the buffer holds `n` valid bytes; the handle is live.
            let written = unsafe { archive_write_data(self.a, buf.as_ptr().cast(), n) };
            if written < 0 {
                return Err(self.error());
            }
            progress(n as u64);
        }
        // SAFETY: the handle is live and an entry was started.
        unsafe { archive_write_finish_entry(self.a) };
        Ok(())
    }

    /// Writes the end of the archive; an archive not finished is incomplete.
    pub fn finish(self) -> Result<(), String> {
        // SAFETY: the handle is live; closing it once is allowed, and free does not close it again.
        let status = unsafe { archive_write_close(self.a) };
        if status != OK { Err(self.error()) } else { Ok(()) }
    }
}

impl Drop for Writer {
    fn drop(&mut self) {
        // SAFETY: the handle was made by archive_write_new and is freed once (free closes it if needed).
        unsafe { archive_write_free(self.a) };
    }
}
