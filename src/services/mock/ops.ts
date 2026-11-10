import type { FileSummary, Targets, TransferResult, TrashResult } from '../protocol';
import { type Node, baseName, cloneNode, joinPath, parentOf } from './fs';
import type { JobContext } from './jobs';
import type { MockState } from './state';
import { tr } from './util';

// File operations of the jobs: copy, move, trash, delete and the steps that take them back.

const PROTECTED = ['/', '/Users', '/Applications', '/System', '/Library', '/Volumes'];

const summary = (n: Node): FileSummary => ({ size: n.size, mtime: n.mtime, isDir: n.kind === 'dir' });

/** The URIs a method acts on: its own, then the items its selection stands for. */
export function targetUris(s: MockState, targets: Partial<Targets>): string[] {
  const uris = [...(targets.uris ?? [])];
  if (targets.view !== undefined && targets.selection !== undefined) uris.push(...s.views.resolve(targets.view, targets.selection));
  if (uris.length === 0) throw new Error(tr('Chưa chọn mục nào', 'Nothing is selected'));
  return uris;
}

export const targetPaths = (s: MockState, targets: Partial<Targets>): string[] => targetUris(s, targets).map((u) => s.localPath(u));

/** The stored item at `path`; an item of a folder made on demand is a file of the size it shows. */
function sourceOf(s: MockState, path: string): Node {
  const node = s.fs.node(path);
  if (node) return node;
  const e = s.fs.stat(path);
  return { name: e.name, kind: e.kind, size: e.size, mtime: e.mtime, ctime: e.ctime, hidden: e.hidden };
}

function merge(from: Node, into: Node, mtime: number): void {
  for (const [name, child] of from.children ?? []) {
    const there = into.children?.get(name);
    if (there?.children && child.children) merge(child, there, mtime);
    else into.children?.set(name, { ...cloneNode(child), mtime });
  }
}

export async function transfer(s: MockState, ctx: JobContext, fromUris: string[], toUri: string, mv: boolean): Promise<TransferResult> {
  const from = fromUris.map((u) => s.localPath(u));
  const dest = s.localPath(toUri);
  s.fs.folder(dest);
  const total = Math.max(1, from.reduce((sum, p) => sum + Math.max(1, s.fs.total(p) || s.fs.stat(p).size), 0));
  const pairs: TransferResult['pairs'] = [];
  const names: string[] = [];
  let skipped = 0;
  let done = 0;
  for (const path of from) {
    if (ctx.cancelled()) throw new Error('cancelled');
    const source = sourceOf(s, path);
    const here = parentOf(path) === dest;
    let name = source.name;
    let merging = false;
    const existing = s.fs.node(joinPath(dest, name));
    if (here && mv) {
      skipped++;
      continue;
    }
    if (here) name = s.fs.uniqueName(dest, name);
    else if (existing) {
      const answer = await ctx.ask({ type: 'conflict', name, folder: existing.kind === 'dir' && source.kind === 'dir', source: summary(source), target: summary(existing) });
      if (answer === 'stop') throw new Error('cancelled');
      if (answer === 'skip') {
        skipped++;
        continue;
      }
      if (answer === 'keepBoth') name = s.fs.uniqueName(dest, name);
      else if (answer === 'merge') merging = true;
      else s.fs.remove(joinPath(dest, name));
    }
    const size = Math.max(1, s.fs.total(path) || source.size);
    for (let k = 1; k <= 4; k++) await ctx.progress(done + (size * k) / 4, total, source.name, 45);
    done += size;
    const target = joinPath(dest, name);
    if (merging && existing) merge(source, existing, s.now);
    else s.fs.add(dest, { ...cloneNode(source), name, mtime: mv ? source.mtime : s.now });
    if (mv && s.fs.node(path)) s.fs.remove(path);
    pairs.push([path, target]);
    names.push(name);
  }
  await ctx.progress(total, total, '', 0);
  s.changed(dest, ...from.map((p) => parentOf(p) ?? '/'));
  if (pairs.length > 0) {
    const title = `${mv ? tr('Chuyển', 'Move') : tr('Chép', 'Copy')} ${pairs.length === 1 ? `"${baseName(pairs[0]?.[0] ?? '')}"` : `${pairs.length} ${tr('mục', 'items')}`}`;
    s.push(mv ? { title, run: () => moveBack(s, pairs.map(([a, b]) => [b, a])) } : { title, run: () => pairs.forEach(([, to]) => trashPath(s, to)) });
  }
  return { pairs, names, to: toUri, skipped };
}

/** Puts the item in the Trash under a name that is free there; returns where it went. */
export function trashPath(s: MockState, path: string): string {
  const node = s.fs.remove(path);
  const name = s.fs.node(joinPath(s.trashPath, node.name)) ? s.fs.uniqueName(s.trashPath, node.name, 'number') : node.name;
  node.name = name;
  s.fs.add(s.trashPath, node);
  return joinPath(s.trashPath, name);
}

/** Each pair is [now, was]: the item goes back where it was when that place is free. */
function moveBack(s: MockState, pairs: string[][]): void {
  const taken: string[] = [];
  for (const [now, was] of pairs) {
    if (now === undefined || was === undefined) continue;
    if (s.fs.exists(was)) {
      taken.push(was);
      continue;
    }
    const node = s.fs.remove(now);
    node.name = baseName(was);
    s.fs.add(parentOf(was) ?? '/', node);
    s.changed(parentOf(now) ?? '/', parentOf(was) ?? '/');
  }
  if (taken.length > 0) throw new Error(`${tr('Đã có mục khác ở chỗ cũ', 'Something else is already where these were')}: ${taken.join(', ')}`);
}

export async function trash(s: MockState, ctx: JobContext, paths: string[]): Promise<TrashResult> {
  const moves: TrashResult['moves'] = [];
  for (const [i, path] of paths.entries()) {
    if (ctx.cancelled()) break;
    if (s.fs.node(path)) moves.push([trashPath(s, path), path]);
    await ctx.progress(i + 1, paths.length, baseName(path), 40);
  }
  s.changed(s.trashPath, ...paths.map((p) => parentOf(p) ?? '/'));
  if (moves.length > 0) {
    const title = `${tr('Chuyển vào Thùng rác', 'Move to Trash')} ${moves.length === 1 ? `"${baseName(moves[0]?.[1] ?? '')}"` : `${moves.length} ${tr('mục', 'items')}`}`;
    s.push({ title, run: () => moveBack(s, moves.map(([a, b]) => [a, b])) });
  }
  return { moves };
}

export async function remove(s: MockState, ctx: JobContext, paths: string[]): Promise<null> {
  if (paths.some((p) => PROTECTED.includes(p) || p === s.fs.home)) throw new Error(tr('Không thể xóa mục này', 'This item cannot be deleted'));
  for (const [i, path] of paths.entries()) {
    if (ctx.cancelled()) break;
    if (s.fs.node(path)) s.fs.remove(path);
    await ctx.progress(i + 1, paths.length, baseName(path), 40);
  }
  s.changed(...paths.map((p) => parentOf(p) ?? '/'));
  return null;
}
