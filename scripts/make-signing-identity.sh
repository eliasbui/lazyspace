#!/bin/sh
# Makes, once, the certificate that signs LazySpace on this Mac: "LazySpace Code Signing", self-signed, valid for twenty
# years, in a keychain of its own (~/Library/Keychains/lazyspace-signing.keychain-db) whose password is kept in
# ~/.config/lazyspace/signing-keychain-password (readable by this user only). scripts/bundle-macos.sh unlocks that
# keychain and signs with it, so codesign never stops to ask in a dialog.
#
# Why: macOS keeps what the user allowed (the Desktop, Documents and Downloads folders, external and network drives,
# the Keychain items of servers) against the app's designated requirement. An ad-hoc signature's requirement is the
# hash of that very build, so every update was a new app and asked for everything again. Signed with this certificate,
# the requirement is the bundle id and the certificate, the same for every build, and what was allowed stays allowed.
#
# Keep both files: a release signed with another certificate asks once more.
set -eu
NAME="LazySpace Code Signing"
KEYCHAIN="$HOME/Library/Keychains/lazyspace-signing.keychain-db"
SECRET="$HOME/.config/lazyspace/signing-keychain-password"

if [ -f "$KEYCHAIN" ] && [ -f "$SECRET" ] && security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
    echo "\"$NAME\" is already in $KEYCHAIN"
    exit 0
fi

mkdir -p "$(dirname "$SECRET")"
umask 077
[ -f "$SECRET" ] || /usr/bin/openssl rand -hex 24 >"$SECRET"
PASSWORD=$(cat "$SECRET")
[ -f "$KEYCHAIN" ] || security create-keychain -p "$PASSWORD" "$KEYCHAIN"
security unlock-keychain -p "$PASSWORD" "$KEYCHAIN"
# The keychain stays unlocked while the Mac is awake, rather than locking itself after five minutes.
security set-keychain-settings "$KEYCHAIN"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cat >"$WORK/cert.cnf" <<EOT
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOT
# The system's LibreSSL: its .p12 is one the Keychain can import (OpenSSL 3's default ciphers are not).
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 7300 -config "$WORK/cert.cnf" -keyout "$WORK/key.pem" -out "$WORK/cert.pem" 2>/dev/null
P12=$(/usr/bin/openssl rand -hex 16)
/usr/bin/openssl pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" -name "$NAME" -passout "pass:$P12" -out "$WORK/id.p12"
security import "$WORK/id.p12" -k "$KEYCHAIN" -P "$P12" -T /usr/bin/codesign >/dev/null
# Apple's tools may use the key without a dialog.
security set-key-partition-list -S apple-tool:,apple: -s -k "$PASSWORD" "$KEYCHAIN" >/dev/null
echo "\"$NAME\" is in $KEYCHAIN; scripts/bundle-macos.sh signs with it from now on"
