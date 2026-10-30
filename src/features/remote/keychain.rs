//! The secrets of the connections in the login Keychain: generic passwords of the app's service, with the connection's
//! id as the account. They never go to a file or a log.

use crate::tr;
use security_framework::passwords::{delete_generic_password, get_generic_password, set_generic_password};

const SERVICE: &str = "com.eliasbui.lazyspace";

pub fn get(id: &str) -> Option<String> {
    get_generic_password(SERVICE, id).ok().and_then(|bytes| String::from_utf8(bytes).ok())
}

pub fn set(id: &str, secret: &str) -> Result<(), String> {
    set_generic_password(SERVICE, id, secret.as_bytes()).map_err(|e| format!("{}: {e}", tr("Keychain không giữ được mật khẩu", "The Keychain could not keep the password")))
}

/// Removes the secret; one that is not there is not an error.
pub fn delete(id: &str) {
    let _ = delete_generic_password(SERVICE, id);
}
