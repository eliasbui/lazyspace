//! The hashes of files (W2): MD5, SHA-1, SHA-224, SHA-256, SHA-384, SHA-512 and CRC32, all worked out in one read of
//! each file, as a job; each file's hashes go to the page as soon as they are done (`hash.result`).

use crate::{
    browse,
    ipc::{Dispatcher, event},
    jobs::Ctx,
    tr,
    vfs::{Uri, registry},
};
use md5::Md5;
use serde::Serialize;
use serde_json::{Value, json};
use sha1::Sha1;
use sha2::{Digest, Sha224, Sha256, Sha384, Sha512};
use std::io::{self, Read};

/// How much of a file is read at once.
const BLOCK: usize = 1 << 20;

#[derive(Debug, Serialize, PartialEq)]
pub struct Digests {
    pub md5: String,
    pub sha1: String,
    pub sha224: String,
    pub sha256: String,
    pub sha384: String,
    pub sha512: String,
    pub crc32: String,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Every hash of what `reader` gives, reporting the bytes read so far after each block; None when `stop` says so.
pub fn digests(mut reader: impl Read, mut progress: impl FnMut(u64) -> bool) -> io::Result<Option<Digests>> {
    let (mut md5, mut sha1, mut sha224, mut sha256, mut sha384, mut sha512) = (Md5::new(), Sha1::new(), Sha224::new(), Sha256::new(), Sha384::new(), Sha512::new());
    let mut crc = crc32fast::Hasher::new();
    let mut buf = vec![0u8; BLOCK];
    let mut read = 0u64;
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        let chunk = &buf[..n];
        md5.update(chunk);
        sha1.update(chunk);
        sha224.update(chunk);
        sha256.update(chunk);
        sha384.update(chunk);
        sha512.update(chunk);
        crc.update(chunk);
        read += n as u64;
        if !progress(read) {
            return Ok(None);
        }
    }
    Ok(Some(Digests {
        md5: hex(&md5.finalize()),
        sha1: hex(&sha1.finalize()),
        sha224: hex(&sha224.finalize()),
        sha256: hex(&sha256.finalize()),
        sha384: hex(&sha384.finalize()),
        sha512: hex(&sha512.finalize()),
        crc32: format!("{:08x}", crc.finalize()),
    }))
}

fn run(ctx: &Ctx, uris: &[Uri]) -> Result<Value, String> {
    let mut entries = Vec::new();
    for uri in uris {
        let entry = registry().get(uri)?.stat(uri)?;
        if entry.kind == "file" {
            entries.push((uri.clone(), entry));
        }
    }
    if entries.is_empty() {
        return Err(tr("Hãy chọn tệp, không phải thư mục", "Choose files, not folders").into());
    }
    let total: u64 = entries.iter().map(|(_, e)| e.size).sum::<u64>().max(1);
    let mut done = 0u64;
    let mut results = Vec::new();
    for (uri, entry) in &entries {
        let reader = registry().get(uri)?.read(uri)?;
        let base = done;
        let digests = digests(reader, |read| {
            ctx.progress(base + read, total, &entry.name);
            !ctx.cancelled()
        })
        .map_err(|e| format!("\"{}\": {e}", entry.name))?;
        let Some(digests) = digests else { return Err(tr("Đã hủy", "Cancelled").into()) };
        done += entry.size;
        let result = json!({ "uri": uri.to_string(), "name": entry.name, "size": entry.size, "hashes": digests });
        ctx.emit("hash.result", json!({ "job": ctx.id, "result": result }));
        results.push(result);
    }
    Ok(Value::Array(results))
}

pub fn register(d: &mut Dispatcher) {
    d.on("hash.start", |app, window, a| {
        let uris = browse::targets(app, window, &a)?;
        let title = match uris.as_slice() {
            [one] => format!("{} \"{}\"", tr("Tính mã băm", "Hash"), one.name()),
            many => format!("{} {} {}", tr("Tính mã băm", "Hash"), many.len(), tr("tệp", "files")),
        };
        let job = app.jobs.spawn(&app.proxy, Some(window), "hash", title, move |ctx| run(ctx, &uris), None);
        app.post(window, event("hash.started", json!({ "job": job })));
        Ok(json!({ "job": job }))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_vectors_for_all_seven_algorithms() {
        let d = digests(&b"abc"[..], |_| true).unwrap().unwrap();
        assert_eq!(d.md5, "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(d.sha1, "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(d.sha224, "23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7");
        assert_eq!(d.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(d.sha384, "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7");
        assert_eq!(d.sha512, "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f");
        assert_eq!(d.crc32, "352441c2");
    }

    #[test]
    fn a_stop_ends_the_reading() {
        let big = vec![1u8; 3 * BLOCK];
        assert_eq!(digests(&big[..], |read| read < BLOCK as u64).unwrap(), None);
        let empty = digests(&b""[..], |_| true).unwrap().unwrap();
        assert_eq!(empty.sha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }
}
