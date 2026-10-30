#!/bin/sh
# Installs LazySpace.app from the latest GitHub release, without Homebrew.
#
#   curl -fsSL https://raw.githubusercontent.com/eliasbui/lazyspace/main/scripts/install.sh | sh
#   DEST=~/Applications sh scripts/install.sh
#
# The app is signed ad hoc and not notarized, so the quarantine flag is removed after installing, as the Homebrew
# cask does; without it Gatekeeper refuses to open it.
set -eu

REPO=eliasbui/lazyspace
DEST=${DEST:-/Applications}
APP="$DEST/LazySpace.app"

[ "$(uname -s)" = Darwin ] || { echo "install: macOS only" >&2; exit 1; }

VERSION=${VERSION:-$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
    sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1)}
[ -n "$VERSION" ] || { echo "install: no release found for $REPO" >&2; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
ZIP="$WORK/LazySpace-$VERSION.zip"
echo "install: LazySpace $VERSION"
curl -fsSL -o "$ZIP" "https://github.com/$REPO/releases/download/v$VERSION/LazySpace-$VERSION-macos.zip"

ditto -x -k "$ZIP" "$WORK"
[ -d "$WORK/LazySpace.app" ] || { echo "install: the download is not a LazySpace app" >&2; exit 1; }

# Replace only once the new copy is on disk, so a failed download leaves the installed app alone.
if [ -w "$DEST" ]; then
    rm -rf "$APP"
    ditto "$WORK/LazySpace.app" "$APP"
else
    echo "install: $DEST needs sudo"
    sudo rm -rf "$APP"
    sudo ditto "$WORK/LazySpace.app" "$APP"
fi
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo "install: $APP"
echo "install: open it from Launchpad or /Applications"
