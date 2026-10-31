#!/bin/sh
# Makes, once, the certificate that signs LazySpace on this Mac: "LazySpace Code Signing", self-signed, in the login
# keychain, valid for twenty years.
#
# Why: macOS keeps what the user allowed (the Desktop, Documents and Downloads folders, external and network drives,
# the Keychain items of servers) against the app's designated requirement. An ad-hoc signature's requirement is the
# hash of that very build, so every update was a new app and asked for everything again. Signed with this certificate,
# the requirement is the bundle id and the certificate, the same for every build, and what was allowed stays allowed.
#
# Keep the certificate: a release signed with another one asks once more. Back it up from Keychain Access (export
# "LazySpace Code Signing" as a .p12) or with: security export -k login.keychain-db -t identities -f pkcs12 -o x.p12
set -eu
NAME="LazySpace Code Signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
    echo "\"$NAME\" is already in the login keychain"
    exit 0
fi

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
PASS=$(/usr/bin/openssl rand -hex 16)
/usr/bin/openssl pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" -name "$NAME" -passout "pass:$PASS" -out "$WORK/id.p12"
# codesign may use the key without asking each time.
security import "$WORK/id.p12" -k "$KEYCHAIN" -P "$PASS" -T /usr/bin/codesign >/dev/null
echo "\"$NAME\" is in the login keychain; scripts/bundle-macos.sh signs with it from now on"
