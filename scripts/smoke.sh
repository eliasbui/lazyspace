#!/bin/sh
# Builds the app, opens it on this Mac's screen for a few seconds, checks that it runs and writes its settings, and
# quits it. It reads and writes its settings in a temporary folder (LAZYSPACE_SETTINGS), not in the user's own.
# Exits non-zero when any step fails.
set -eu
cd "$(dirname "$0")/.."

fail() { echo "smoke: $*" >&2; exit 1; }

pgrep -x lazyspace >/dev/null && fail "LazySpace is already running; quit it first"

scripts/bundle-macos.sh
WORK=$(mktemp -d)
cleanup() {
    pkill -x lazyspace 2>/dev/null || true
    rm -rf "$WORK"
}
trap cleanup EXIT

open -n --env "LAZYSPACE_SETTINGS=$WORK/settings.json" dist/LazySpace.app
sleep 3
pgrep -x lazyspace >/dev/null || fail "the app is not running 3 seconds after it was opened"
[ -f "$WORK/settings.json" ] || fail "the app did not write $WORK/settings.json"
grep -q '"language"' "$WORK/settings.json" || fail "settings.json has no language"

osascript -e 'tell application id "com.eliasbui.lazyspace" to quit'
for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -x lazyspace >/dev/null || { echo "smoke: ok"; exit 0; }
    sleep 0.5
done
fail "the app did not quit when asked to"
