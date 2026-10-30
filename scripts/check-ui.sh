#!/bin/sh
# Parses every script of the page with `node --check`: each inline script of ui/index.html and each ui/parts/*.js.
# Exits non-zero when one does not parse, naming it. Run it after any change in ui/.
set -eu
cd "$(dirname "$0")/.."

NODE=${NODE:-$(command -v node || echo /opt/homebrew/bin/node)}
[ -x "$NODE" ] || { echo "check-ui: node is needed (brew install node)" >&2; exit 1; }
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Each inline script of the page, in the order it comes, as inline-N.js in the work folder.
COUNT=$("$NODE" -e '
const fs = require("fs");
const [file, dir] = process.argv.slice(1);
let n = 0;
for (const m of fs.readFileSync(file, "utf8").matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) fs.writeFileSync(`${dir}/inline-${++n}.js`, m[1]);
console.log(n);
' ui/index.html "$WORK")
[ "$COUNT" -gt 0 ] || { echo "check-ui: no script found in ui/index.html" >&2; exit 1; }

FAILED=0
CHECKED=0
for SCRIPT in "$WORK"/inline-*.js; do
    CHECKED=$((CHECKED + 1))
    "$NODE" --check "$SCRIPT" || { echo "check-ui: inline script $(basename "$SCRIPT" .js | sed 's/inline-//') of ui/index.html does not parse" >&2; FAILED=1; }
done
for SCRIPT in ui/parts/*.js; do
    [ -e "$SCRIPT" ] || continue
    CHECKED=$((CHECKED + 1))
    "$NODE" --check "$SCRIPT" || { echo "check-ui: $SCRIPT does not parse" >&2; FAILED=1; }
done
[ "$FAILED" = 0 ] || exit 1
echo "check-ui: $CHECKED scripts parse"
