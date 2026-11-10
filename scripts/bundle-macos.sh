#!/bin/sh
# Builds "dist/LazySpace.app": the front end (pnpm build, run by Tauri), the release binary, the icon and the app
# metadata, which Tauri writes from src-tauri/tauri.conf.json, src-tauri/Info.plist and src-tauri/lproj; then signs it.
#
#   scripts/bundle-macos.sh               # for this Mac
#   UNIVERSAL=1 scripts/bundle-macos.sh   # Apple silicon and Intel in one binary (what a release ships)
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)
APP="dist/LazySpace.app"
# Where cargo puts the build, which CARGO_TARGET_DIR or a config may move away from the manifest's own folder.
TARGET_DIR=$(cargo metadata --format-version 1 --no-deps --manifest-path src-tauri/Cargo.toml | plutil -extract target_directory raw -o - -)

# The packages of the front end, as the lockfile has them (Tauri's CLI is one of them).
pnpm install --frozen-lockfile

# The build of the front end is Tauri's beforeBuildCommand, so the page the binary carries is always the one of this tree.
if [ "${UNIVERSAL:-}" = 1 ]; then
    pnpm tauri build --bundles app --target universal-apple-darwin
    BUILT="$TARGET_DIR/universal-apple-darwin/release/bundle/macos/LazySpace.app"
else
    pnpm tauri build --bundles app
    BUILT="$TARGET_DIR/release/bundle/macos/LazySpace.app"
fi
[ -d "$BUILT" ] || { echo "Tauri did not make $BUILT" >&2; exit 1; }

rm -rf "$APP"
mkdir -p dist
ditto "$BUILT" "$APP"
# The licence of the program and the notices of what it carries travel with it (before the signature, which seals them).
cp LICENSE THIRD_PARTY_NOTICES.md "$APP/Contents/Resources/"

# What the bundle says of itself must be what a release says: the version of src-tauri/Cargo.toml and the id, and the
# name of the binary that scripts/smoke.sh and scripts/screenshots.sh look for.
PLIST="$APP/Contents/Info.plist"
[ "$(plutil -extract CFBundleShortVersionString raw -o - "$PLIST")" = "$VERSION" ] || { echo "the bundle's version is not $VERSION" >&2; exit 1; }
[ "$(plutil -extract CFBundleIdentifier raw -o - "$PLIST")" = com.eliasbui.lazyspace ] || { echo "the bundle's identifier is not com.eliasbui.lazyspace" >&2; exit 1; }
[ -x "$APP/Contents/MacOS/lazyspace" ] || { echo "the bundle has no Contents/MacOS/lazyspace" >&2; exit 1; }

# Signed with this Mac's "LazySpace Code Signing" certificate (scripts/make-signing-identity.sh) when it has one: the
# app's designated requirement is then its bundle id and that certificate, the same for every build, so what the user
# allowed (folders, drives, Keychain items) holds across updates. Without it, an ad-hoc signature, whose requirement is
# the hash of this one build: every update asks again. A release requires the certificate (scripts/release.sh).
IDENTITY="LazySpace Code Signing"
KEYCHAIN="$HOME/Library/Keychains/lazyspace-signing.keychain-db"
SECRET="$HOME/.config/lazyspace/signing-keychain-password"
if [ -f "$KEYCHAIN" ] && [ -f "$SECRET" ]; then
    security unlock-keychain -p "$(cat "$SECRET")" "$KEYCHAIN"
    codesign --force --deep --keychain "$KEYCHAIN" --sign "$IDENTITY" --identifier com.eliasbui.lazyspace "$APP"
else
    [ "${REQUIRE_IDENTITY:-}" = 1 ] && { echo "\"$IDENTITY\" is not in the keychain: run scripts/make-signing-identity.sh" >&2; exit 1; }
    echo "signing ad hoc: macOS will ask for its permissions again after an update (scripts/make-signing-identity.sh)" >&2
    codesign --force --deep --sign - --identifier com.eliasbui.lazyspace "$APP"
fi
echo "$APP ($VERSION)"
