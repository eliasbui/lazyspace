// The rules of docs/frontend.md that a machine can check. They fail the build of the change that breaks them.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dictionaries } from '@/i18n';

const root = join(import.meta.dirname, '..');
const src = join(root, 'src');

function walk(dir: string, keep: (path: string) => boolean = () => true): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'target' || name === 'dist-web' || name === '.claude') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

const rel = (path: string): string => relative(root, path).split(sep).join('/');
const sourceFiles = walk(src, (p) => /\.(ts|tsx)$/.test(p));

describe('architecture', () => {
  it('lets only src/services import @tauri-apps', () => {
    const offenders = sourceFiles
      .filter((p) => !rel(p).startsWith('src/services/'))
      .filter((p) => /from\s+['"]@tauri-apps\/|import\(\s*['"]@tauri-apps\/|require\(\s*['"]@tauri-apps\//.test(readFileSync(p, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('has one stylesheet, src/styles/index.css', () => {
    const sheets = walk(src, (p) => /\.(css|scss|sass|less)$/.test(p)).map(rel);
    expect(sheets).toEqual(['src/styles/index.css']);
  });

  it('has no plain JavaScript under src', () => {
    const scripts = walk(src, (p) => /\.(js|jsx|mjs|cjs)$/.test(p)).map(rel);
    expect(scripts).toEqual([]);
  });

  it('keeps index.html to the root div and the module script', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const body = /<body[^>]*>([\s\S]*?)<\/body>/.exec(html)?.[1] ?? '';
    const tags = [...body.matchAll(/<\s*([a-zA-Z][\w-]*)([^>]*)>/g)].map((m) => ({ tag: m[1]?.toLowerCase() ?? '', attrs: m[2] ?? '' }));
    expect(tags.map((t) => t.tag)).toEqual(['div', 'script']);
    expect(tags[0]?.attrs).toMatch(/id=["']root["']/);
    expect(tags[1]?.attrs).toMatch(/type=["']module["']/);
    expect(tags[1]?.attrs).toMatch(/src=["']\/src\/main\.tsx["']/);
    expect(body.replace(/<[^>]*>/g, '').trim()).toBe('');
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i);
  });

  it('has no emoji or pictograph in src, src-tauri/src or the docs', () => {
    const pictograph = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/u;
    const files = [
      ...walk(src, (p) => /\.(ts|tsx|css|md)$/.test(p)),
      ...walk(join(root, 'src-tauri', 'src'), (p) => /\.(rs|md)$/.test(p)),
      ...walk(join(root, 'docs'), (p) => p.endsWith('.md')),
      ...['README.md', 'MIGRATION.md', 'PARITY.md'].map((n) => join(root, n)).filter((p) => statSync(p, { throwIfNoEntry: false })?.isFile()),
    ];
    const offenders = files.filter((p) => pictograph.test(readFileSync(p, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('keeps the vi and en dictionaries on the same keys', () => {
    const vi = Object.keys(dictionaries.vi).sort();
    const en = Object.keys(dictionaries.en).sort();
    expect(vi.filter((k) => !en.includes(k))).toEqual([]);
    expect(en.filter((k) => !vi.includes(k))).toEqual([]);
  });
});
