import type { RenameRow, RenameRule } from '../protocol';
import { tr } from './util';

// The rules of the batch rename, applied to names as the host applies them.

export interface Item {
  name: string;
  isDir: boolean;
  /** The name of the folder that holds it. */
  parent: string;
}

function words(text: string, mode: 'lower' | 'upper' | 'title' | 'sentence'): string {
  switch (mode) {
    case 'lower':
      return text.toLowerCase();
    case 'upper':
      return text.toUpperCase();
    case 'title':
      return text.toLowerCase().replace(/(^|\s)(\S)/g, (_, space: string, letter: string) => space + letter.toUpperCase());
    default:
      return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }
}

function insertAt(stem: string, text: string, at: 'start' | 'end' | 'index', index: number): string {
  if (at === 'start') return text + stem;
  if (at === 'end') return stem + text;
  return stem.slice(0, index) + text + stem.slice(index);
}

function applyRule(rule: RenameRule, item: Item, position: number, stem: string, ext: string): [string, string] {
  switch (rule.type) {
    case 'replace': {
      const pattern = rule.regex ? rule.find : rule.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!pattern) return [stem, ext];
      let expression: RegExp;
      try {
        expression = new RegExp(pattern, rule.caseInsensitive ? 'gi' : 'g');
      } catch {
        throw new Error(tr('Biểu thức chính quy không hợp lệ', 'Not a valid regular expression'));
      }
      const replacement = rule.with ?? '';
      if (rule.scope === 'ext') return [stem, ext.replace(expression, replacement)];
      if (rule.scope === 'all') {
        const all = (ext ? `${stem}.${ext}` : stem).replace(expression, replacement);
        const dot = all.lastIndexOf('.');
        return item.isDir || dot <= 0 ? [all, ''] : [all.slice(0, dot), all.slice(dot + 1)];
      }
      return [stem.replace(expression, replacement), ext];
    }
    case 'insert':
      return [insertAt(stem, rule.text, rule.at ?? 'end', rule.index ?? 0), ext];
    case 'remove': {
      const chars = [...stem];
      const from = rule.fromEnd ? Math.max(0, chars.length - (rule.from ?? 0) - rule.count) : (rule.from ?? 0);
      chars.splice(from, rule.count);
      return [chars.join(''), ext];
    }
    case 'number': {
      const n = String((rule.start ?? 1) + position * (rule.step ?? 1)).padStart(rule.pad ?? 0, '0');
      const text = rule.at === 'start' ? n + (rule.sep ?? '') : (rule.sep ?? '') + n;
      return [insertAt(stem, text, rule.at ?? 'end', rule.index ?? 0), ext];
    }
    case 'parent': {
      const text = rule.at === 'start' ? item.parent + (rule.sep ?? '') : (rule.sep ?? '') + item.parent;
      return [insertAt(stem, text, rule.at ?? 'end', 0), ext];
    }
    case 'case':
      return [words(stem, rule.mode), ext];
    case 'ext': {
      let next = rule.set === undefined || rule.set === null ? ext : rule.set.replace(/^\./, '');
      if (rule.case) next = words(next, rule.case);
      return [stem, next];
    }
  }
}

/** The new name of each item, with the problem that stops it, as the preview shows them. */
export function plan(rules: RenameRule[], items: Item[], taken: Set<string>): RenameRow[] {
  const outputs = items.map((item, position) => {
    const dot = item.name.lastIndexOf('.');
    let [stem, ext] = item.isDir || dot <= 0 ? [item.name, ''] : [item.name.slice(0, dot), item.name.slice(dot + 1)];
    for (const rule of rules) [stem, ext] = applyRule(rule, item, position, stem, ext);
    return ext ? `${stem}.${ext}` : stem;
  });
  const counts = new Map<string, number>();
  for (const name of outputs) counts.set(name, (counts.get(name) ?? 0) + 1);
  const mine = new Set(items.map((i) => i.name));
  return items.map((item, i) => {
    const to = outputs[i] ?? item.name;
    let problem: string | null = null;
    if (!to.trim() || to === '.' || to === '..' || to.includes('/')) problem = tr('Tên không hợp lệ', 'Not a valid name');
    else if ((counts.get(to) ?? 0) > 1) problem = tr('Trùng tên trong danh sách', 'The same name twice in the list');
    else if (to !== item.name && taken.has(to) && !mine.has(to)) problem = tr('Đã có một mục cùng tên', 'An item with that name is already there');
    return { from: item.name, to, problem };
  });
}
