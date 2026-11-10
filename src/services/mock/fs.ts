import type { Entry, EntryKind, TagRef } from '../protocol';
import { tr } from './util';

// An in-memory file system with the rules of the host's local provider: names, kinds, icons, hidden items.

/** A folder whose items are made on demand by index, in name order with the folders first. Nothing is stored. */
export interface Virtual {
  count: number;
  /** How many of the first items are folders. */
  folders: number;
  at(index: number): Entry;
  /** The index of the item called `name`, or null. */
  indexOf(name: string): number | null;
}

export interface Node {
  name: string;
  kind: EntryKind;
  size: number;
  mtime: number;
  ctime: number;
  hidden: boolean;
  tags?: TagRef[];
  text?: string;
  /** Files with the same digest have the same bytes. */
  digest?: string;
  children?: Map<string, Node>;
  virtual?: Virtual;
}

export interface ParsedUri {
  scheme: string;
  authority: string;
  path: string;
}

const normalize = (path: string): string => `/${path.split('/').filter(Boolean).join('/')}`;

export function parseUri(text: string): ParsedUri {
  const bad = (): Error => new Error(`${tr('Địa chỉ không hợp lệ', 'Not a valid address')}: ${text}`);
  if (text.startsWith('/')) return { scheme: 'file', authority: '', path: normalize(text) };
  const match = /^([a-z][a-z0-9+-]*):\/\/([^/]*)(\/.*)?$/.exec(text);
  if (!match) throw bad();
  try {
    return { scheme: match[1] ?? '', authority: decodeURIComponent(match[2] ?? ''), path: normalize(decodeURIComponent(match[3] ?? '/')) };
  } catch {
    throw bad();
  }
}

const encodePart = (part: string): string => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function fileUri(path: string): string {
  return `file://${normalize(path).split('/').map(encodePart).join('/')}`;
}

export function makeUri({ scheme, authority, path }: ParsedUri): string {
  return `${scheme}://${encodePart(authority).replace(/%40/g, '@').replace(/%3A/g, ':')}${normalize(path).split('/').map(encodePart).join('/')}`;
}

export const joinPath = (dir: string, name: string): string => (dir === '/' ? `/${name}` : `${dir}/${name}`);

export function parentOf(path: string): string | null {
  if (path === '/') return null;
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}

export const baseName = (path: string): string => (path === '/' ? '/' : path.slice(path.lastIndexOf('/') + 1));

export function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

const SPECIAL = ['/', '/Applications', '/Library', '/System', '/Users', '/Volumes'];
const HOME_SPECIAL = ['', 'Desktop', 'Documents', 'Downloads', 'Movies', 'Music', 'Pictures', 'Public', 'Library', 'Applications'];

function iconOf(path: string, node: Node, home: string): string {
  const ext = extOf(node.name);
  if (node.kind === 'dir') {
    const special = SPECIAL.includes(path) || HOME_SPECIAL.some((s) => path === joinPath(home, s).replace(/\/$/, '')) || baseName(parentOf(path) ?? '') === 'Volumes';
    return special ? `path:${path}` : 'type:public.folder';
  }
  if (node.kind === 'file') return ext ? `ext:${ext}` : 'type:public.data';
  return `path:${path}`;
}

export class MockFs {
  readonly root: Node = this.dir('');

  constructor(readonly home = '/Users/demo') {}

  dir(name: string, mtime = 0): Node {
    return { name, kind: 'dir', size: 0, mtime, ctime: mtime, hidden: false, children: new Map() };
  }

  /** The stored item at `path`, or undefined. */
  node(path: string): Node | undefined {
    let node: Node | undefined = this.root;
    for (const part of path.split('/').filter(Boolean)) {
      node = node?.children?.get(part);
      if (!node) return undefined;
    }
    return node;
  }

  entryOf(dir: string, node: Node): Entry {
    const path = joinPath(dir, node.name);
    return {
      name: node.name,
      uri: fileUri(path),
      kind: node.kind,
      isDir: node.kind === 'dir',
      size: node.kind === 'file' ? node.size : 0,
      mtime: node.mtime,
      ctime: node.ctime,
      hidden: node.hidden || node.name.startsWith('.'),
      ext: node.kind === 'dir' ? '' : extOf(node.name),
      icon: iconOf(path, node, this.home),
    };
  }

  /** The folder at `path`; throws the host's error when it is not there. */
  folder(path: string): Node {
    const node = this.node(path);
    if (!node) throw new Error(`${tr('Không tìm thấy', 'Not found')}: ${path}`);
    if (!node.children && !node.virtual) throw new Error(`${tr('Không phải thư mục', 'Not a folder')}: ${path}`);
    return node;
  }

  list(path: string): Entry[] {
    const folder = this.folder(path);
    return [...(folder.children?.values() ?? [])].map((n) => this.entryOf(path, n));
  }

  stat(path: string): Entry {
    const node = this.node(path);
    if (node) return this.entryOf(parentOf(path) ?? '/', node);
    const parent = parentOf(path);
    const virtual = parent ? this.node(parent)?.virtual : undefined;
    const index = virtual?.indexOf(baseName(path)) ?? null;
    if (virtual && index !== null) return virtual.at(index);
    throw new Error(`${tr('Không tìm thấy', 'Not found')}: ${path}`);
  }

  exists(path: string): boolean {
    try {
      this.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Makes the folders on the way to `path` and returns the last. */
  ensure(path: string, mtime = 0): Node {
    let node = this.root;
    for (const part of path.split('/').filter(Boolean)) {
      let next = node.children?.get(part);
      if (!next) {
        next = this.dir(part, mtime);
        node.children?.set(part, next);
      }
      node = next;
    }
    return node;
  }

  add(dir: string, node: Node): Node {
    const folder = this.folder(dir);
    if (!folder.children) throw new Error(tr('Không ghi được vào thư mục này', 'This folder cannot be written to'));
    folder.children.set(node.name, node);
    folder.mtime = Math.max(folder.mtime, node.mtime);
    return node;
  }

  file(dir: string, name: string, size: number, mtime: number, text?: string): Node {
    const node: Node = { name, kind: 'file', size: text === undefined ? size : text.length, mtime, ctime: mtime - 86_400, hidden: false, text };
    return this.add(dir, node);
  }

  mkdir(dir: string, name: string, mtime: number): Node {
    validName(name);
    if (this.node(joinPath(dir, name))) throw new Error(`"${name}": ${tr('đã có một mục cùng tên', 'an item with that name is already there')}`);
    return this.add(dir, this.dir(name, mtime));
  }

  rename(path: string, name: string): void {
    validName(name);
    const parent = parentOf(path);
    const node = this.node(path);
    if (!parent || !node) throw new Error(tr('Không đổi tên được ổ đĩa', 'A disk cannot be renamed here'));
    if (name === node.name) return;
    const siblings = this.folder(parent).children;
    if (siblings?.has(name)) throw new Error(`"${name}": ${tr('đã có một mục cùng tên', 'an item with that name is already there')}`);
    siblings?.delete(node.name);
    node.name = name;
    siblings?.set(name, node);
  }

  remove(path: string): Node {
    const parent = parentOf(path);
    const node = this.node(path);
    if (!parent || !node) throw new Error(`${tr('Không tìm thấy', 'Not found')}: ${path}`);
    this.folder(parent).children?.delete(node.name);
    return node;
  }

  /** A deep copy of the item at `from` under `to` as `name`; returns the copy. */
  copy(from: string, to: string, name: string, mtime: number): Node {
    const source = this.node(from);
    if (!source) throw new Error(`${tr('Không tìm thấy', 'Not found')}: ${from}`);
    if (to === from || to.startsWith(`${from}/`)) throw new Error(tr('Không chép được thư mục vào chính nó', 'A folder cannot be copied into itself'));
    const copy = { ...cloneNode(source), name, mtime };
    return this.add(to, copy);
  }

  /** "name copy.ext", "name copy 2.ext" ... the first that is free in `dir`. */
  uniqueName(dir: string, name: string, kind: 'copy' | 'number' = 'copy'): string {
    const ext = extOf(name);
    const stem = ext ? name.slice(0, -(ext.length + 1)) : name;
    const taken = (n: string): boolean => this.exists(joinPath(dir, n));
    for (let i = 1; ; i++) {
      const tag = kind === 'copy' ? (i === 1 ? ' copy' : ` copy ${i}`) : ` ${i + 1}`;
      const candidate = ext ? `${stem}${tag}.${ext}` : `${stem}${tag}`;
      if (!taken(candidate)) return candidate;
    }
  }

  /** Every stored item under `path`, with its path, folders before what they hold. */
  walk(path: string, visit: (path: string, node: Node) => void): void {
    const node = this.node(path);
    for (const child of node?.children?.values() ?? []) {
      const childPath = joinPath(path, child.name);
      visit(childPath, child);
      if (child.kind === 'dir') this.walk(childPath, visit);
    }
  }

  /** The sum of the sizes of the files under `path`. */
  total(path: string): number {
    const node = this.node(path);
    if (!node) return 0;
    if (node.kind === 'file') return node.size;
    let sum = 0;
    this.walk(path, (_, n) => {
      if (n.kind === 'file') sum += n.size;
    });
    return sum;
  }
}

export function cloneNode(n: Node): Node {
  return { ...n, children: n.children && new Map([...n.children].map(([k, v]) => [k, cloneNode(v)])) };
}

export function validName(name: string): void {
  if (!name.trim() || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
    throw new Error(tr('Tên không hợp lệ: không được trống và không được chứa "/"', 'Not a valid name: it cannot be empty or contain "/"'));
  }
  if (new TextEncoder().encode(name).length > 255) throw new Error(tr('Tên quá dài', 'The name is too long'));
}
