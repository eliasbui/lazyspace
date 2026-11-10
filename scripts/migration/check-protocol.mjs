// Lists the methods the old page (ui/parts) called and the methods the services of the new page call, and fails when the
// new page lacks one the old page used. Usage: node scripts/migration/check-protocol.mjs [--verbose]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const verbose = process.argv.includes('--verbose');
const METHOD = '([a-z][a-z0-9]*\\.[a-z][a-z0-9_]*)';

function walk(dir, keep) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

function collect(files, patterns) {
  const found = new Map();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const list = found.get(match[1]) ?? new Set();
        list.add(relative(root, file));
        found.set(match[1], list);
      }
    }
  }
  return found;
}

const mockDir = join('src', 'services', 'mock') + sep;
const oldCalls = collect(
  walk(join(root, 'ui', 'parts'), (p) => p.endsWith('.js')),
  [
    new RegExp(`\\bcall\\(\\s*["']${METHOD}["']`, 'g'),
    // Calls through a helper that takes the method: goOut(pane, "fs.trash"), start("disk.map", uri, done).
    new RegExp(`\\b(?:goOut\\(\\s*\\w+,|start\\()\\s*["']${METHOD}["']`, 'g'),
  ],
);
const newCalls = collect(
  walk(join(root, 'src'), (p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !relative(root, p).startsWith(mockDir)),
  [new RegExp(`\\b(?:rpc|call)\\(\\s*['"]${METHOD}['"]`, 'g'), new RegExp(`\\bmethod:\\s*['"]${METHOD}['"]`, 'g')],
);

const missing = [...oldCalls.keys()].filter((m) => !newCalls.has(m)).sort();
const extra = [...newCalls.keys()].filter((m) => !oldCalls.has(m)).sort();

console.log(`The old page calls ${oldCalls.size} methods; the new page calls ${newCalls.size}.`);
if (verbose) for (const m of [...oldCalls.keys()].sort()) console.log(`  ${newCalls.has(m) ? 'present' : 'MISSING'}  ${m}`);
if (extra.length) console.log(`Only the new page calls (${extra.length}): ${extra.join(', ')}`);
if (missing.length) {
  console.error(`The new page lacks ${missing.length} method(s) the old page called:`);
  for (const m of missing) console.error(`  ${m}  (old: ${[...oldCalls.get(m)].join(', ')})`);
  process.exit(1);
}
console.log('Every method the old page called is called by the new page.');
