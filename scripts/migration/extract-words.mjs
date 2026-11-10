// One-time extraction of the page's word tables (index.html WORDS and every words({...}) call of ui/parts) into typed
// TypeScript dictionaries, src/i18n/words/<part>.ts. Keys are kept as they were. Run from the repository root.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = 'ui';
const out = 'src/i18n/words';
fs.mkdirSync(out, { recursive: true });

function block(text, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

const camel = (name) => name.replace(/^\d+-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const files = [['index.html', 'shell'], ...fs.readdirSync(path.join(root, 'parts')).filter((f) => f.endsWith('.js')).sort().map((f) => [`parts/${f}`, camel(f.replace(/\.js$/, ''))])];
const index = [];
for (const [file, name] of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const vi = {};
  const en = {};
  // Some parts build words from a table of their own (the commands); the tables are made available to the literal.
  const context = vm.createContext({});
  for (const m of text.matchAll(/^\s*const (\w+) = ([\[{])/gm)) {
    const literal = block(text, m.index + m[0].length - 1);
    if (literal) {
      try {
        vm.runInContext(`var ${m[1]} = ${literal};`, context);
      } catch {
        // A table that needs the page is not one the words use.
      }
    }
  }
  const take = (literal) => {
    const o = vm.runInContext(`(${literal})`, context);
    Object.assign(vi, o.vi ?? {});
    Object.assign(en, o.en ?? {});
  };
  if (file === 'index.html') {
    const m = text.match(/const WORDS = \{/);
    if (m) take(block(text, m.index + m[0].length - 1));
  }
  for (const m of text.matchAll(/\bwords\(\s*\{/g)) take(block(text, m.index + m[0].length - 1));
  if (!Object.keys(vi).length) continue;
  const render = (o) => Object.entries(o).map(([k, v]) => `  ${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
  fs.writeFileSync(path.join(out, `${name}.ts`), `// Words of the old page part ${file}.\nexport const vi = {\n${render(vi)}\n} as const;\n\nexport const en = {\n${render(en)}\n} as const;\n`);
  index.push(name);
}
const id = (n) => n.replace(/^(.)/, (c) => c.toLowerCase());
fs.writeFileSync(
  path.join(out, 'index.ts'),
  `// The dictionaries, one file per part. A feature adds its own file here.\n${index.map((n) => `import * as ${id(n)} from './${n}';`).join('\n')}\n\nexport const vi = {\n${index.map((n) => `  ...${id(n)}.vi,`).join('\n')}\n} as const;\n\nexport const en = {\n${index.map((n) => `  ...${id(n)}.en,`).join('\n')}\n} as const;\n`,
);
console.log(index.length, 'files');
