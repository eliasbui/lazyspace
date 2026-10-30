#!/bin/sh
# Opens the app three times, light, dark and glass, and saves a picture of its window each time as
# dist/shot-light.png, dist/shot-dark.png and dist/shot-glass.png, for the person who reviews a release to look at.
# Each run reads its settings from a temporary folder (LAZYSPACE_SETTINGS), not from the user's own.
#
# macOS asks for Screen Recording permission the first time; without it the capture fails and this says so. For the
# glass picture to show the blur through the window, put something colourful on the screen behind where the window
# opens.
set -eu
cd "$(dirname "$0")/.."

fail() { echo "screenshots: $*" >&2; exit 1; }

pgrep -x lazyspace >/dev/null && fail "LazySpace is already running; quit it first"

[ -d dist/LazySpace.app ] || scripts/bundle-macos.sh
WORK=$(mktemp -d)
cleanup() {
    pkill -x lazyspace 2>/dev/null || true
    rm -rf "$WORK"
}
trap cleanup EXIT

# The id of the first window of a process that is on the screen, through the window list; empty when there is none.
window_id() {
    osascript -l JavaScript -e '
ObjC.import("CoreGraphics");
function run(argv) {
    const pid = Number(argv[0]);
    const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0)));
    const own = list.filter((w) => w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0 && w.kCGWindowBounds.Width > 200);
    return own.length ? String(own[0].kCGWindowNumber) : "";
}' "$1"
}

shoot() {
    NAME=$1
    SETTINGS=$2
    mkdir -p "$WORK/$NAME"
    echo "$SETTINGS" >"$WORK/$NAME/settings.json"
    open -n --env "LAZYSPACE_SETTINGS=$WORK/$NAME/settings.json" dist/LazySpace.app
    sleep 3
    PID=$(pgrep -x lazyspace | head -1) || fail "the app is not running after it was opened ($NAME)"
    ID=$(window_id "$PID")
    [ -n "$ID" ] || fail "no window of the app is on the screen ($NAME)"
    screencapture -x -o -l "$ID" "dist/shot-$NAME.png" ||
        fail "screencapture could not capture the window ($NAME); allow Screen Recording for the terminal in System Settings > Privacy & Security"
    [ -s "dist/shot-$NAME.png" ] || fail "screencapture wrote an empty picture ($NAME)"
    echo "screenshots: dist/shot-$NAME.png"
    osascript -e 'tell application id "com.eliasbui.lazyspace" to quit'
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        pgrep -x lazyspace >/dev/null || return 0
        sleep 0.5
    done
    fail "the app did not quit when asked to ($NAME)"
}

shoot light '{"language": "en", "theme": "light", "glass": false}'
shoot dark '{"language": "en", "theme": "dark", "glass": false}'
shoot glass '{"language": "en", "theme": "light", "glass": true}'
