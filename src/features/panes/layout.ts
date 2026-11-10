// The layout of the panes of a window: a tree whose leaves are panes and whose splits lay their children in a row or a
// column, each child taking its share of the split (the sizes add up to 1). Pure: the panes are of any type `T`.
import type { LayoutTree } from '@/services';

export type Dir = 'row' | 'col';
export interface Leaf<T> {
  pane: T;
}
export interface Split<T> {
  /** A key for React; it stays with the split while the tree changes around it. */
  id: number;
  dir: Dir;
  kids: Node<T>[];
  sizes: number[];
}
export type Node<T> = Leaf<T> | Split<T>;

/** The preset layouts and the number of panes each has. */
export const LAYOUTS = { single: 1, h2: 2, v2: 2, h3: 3, l1r2: 3, grid: 4, h4: 4, g6: 6 } as const;
export type Preset = keyof typeof LAYOUTS;
export const PRESET_NAMES = Object.keys(LAYOUTS) as Preset[];
export const isPreset = (name: unknown): name is Preset => typeof name === 'string' && Object.hasOwn(LAYOUTS, name);

let splits = 0;

export const isLeaf = <T>(node: Node<T>): node is Leaf<T> => 'pane' in node;
export const leaf = <T>(pane: T): Leaf<T> => ({ pane });
export const split = <T>(dir: Dir, kids: Node<T>[]): Split<T> => ({ id: ++splits, dir, kids, sizes: kids.map(() => 1 / kids.length) });

const L = leaf;
export const PRESETS: Record<Preset, <T>(p: T[]) => Node<T>> = {
  single: (p) => L(p[0]),
  h2: (p) => split('row', [L(p[0]), L(p[1])]),
  v2: (p) => split('col', [L(p[0]), L(p[1])]),
  h3: (p) => split('row', [L(p[0]), L(p[1]), L(p[2])]),
  l1r2: (p) => split('row', [L(p[0]), split('col', [L(p[1]), L(p[2])])]),
  grid: (p) => split('col', [split('row', [L(p[0]), L(p[1])]), split('row', [L(p[2]), L(p[3])])]),
  h4: (p) => split('row', [L(p[0]), L(p[1]), L(p[2]), L(p[3])]),
  g6: (p) => split('col', [split('row', [L(p[0]), L(p[1]), L(p[2])]), split('row', [L(p[3]), L(p[4]), L(p[5])])]),
};

/** The panes in the order of the tree, left to right and top to bottom: the order Tab goes through. */
export function leaves<T>(node: Node<T>, out: T[] = []): T[] {
  if (isLeaf(node)) out.push(node.pane);
  else for (const kid of node.kids) leaves(kid, out);
  return out;
}

/** The split that holds `node`, and where among its children. */
export function parentOf<T>(root: Node<T>, node: Node<T>): [Split<T>, number] | null {
  if (isLeaf(root)) return null;
  const at = root.kids.indexOf(node);
  if (at >= 0) return [root, at];
  for (const kid of root.kids) {
    const found = parentOf(kid, node);
    if (found) return found;
  }
  return null;
}

export function leafOf<T>(root: Node<T>, pane: T): Leaf<T> | null {
  if (isLeaf(root)) return root.pane === pane ? root : null;
  for (const kid of root.kids) {
    const found = leafOf(kid, pane);
    if (found) return found;
  }
  return null;
}

/** Puts `node` where `old` was; returns the root, which is `node` when `old` was the root. */
export function replace<T>(root: Node<T>, old: Node<T>, node: Node<T>): Node<T> {
  const found = parentOf(root, old);
  if (!found) return node;
  found[0].kids[found[1]] = node;
  return root;
}

/** A split left with one child gives way to it; a split inside a split of the same way joins it. */
export function tidy<T>(node: Node<T>): Node<T> {
  if (isLeaf(node)) return node;
  const kids: Node<T>[] = [];
  const sizes: number[] = [];
  node.kids.map(tidy).forEach((kid, i) => {
    const share = node.sizes[i] ?? 0;
    if (!isLeaf(kid) && kid.dir === node.dir) {
      kid.kids.forEach((k, j) => {
        kids.push(k);
        sizes.push(share * (kid.sizes[j] ?? 0));
      });
    } else {
      kids.push(kid);
      sizes.push(share);
    }
  });
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  node.kids = kids;
  node.sizes = sizes.map((x) => x / total);
  return kids.length === 1 && kids[0] ? kids[0] : node;
}

/** The tree as layout.json keeps it, each pane by its place in the order of the panes. */
export function treeState<T>(node: Node<T>, indexOf: (pane: T) => number): LayoutTree {
  if (isLeaf(node)) return { p: indexOf(node.pane) };
  return { dir: node.dir, sizes: node.sizes.map((x) => Math.round(x * 10000) / 10000), kids: node.kids.map((k) => treeState(k, indexOf)) };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The tree kept in layout.json over the panes `list`, each used once; null when it does not fit them. */
export function treeFrom<T>(saved: unknown, list: T[]): Node<T> | null {
  const used = new Set<number>();
  const walk = (node: unknown, depth: number): Node<T> | null => {
    if (!isRecord(node) || depth > 8) return null;
    if (Number.isInteger(node.p)) {
      const p = Number(node.p);
      const pane = list[p];
      if (pane === undefined || used.has(p)) return null;
      used.add(p);
      return leaf(pane);
    }
    if ((node.dir !== 'row' && node.dir !== 'col') || !Array.isArray(node.kids) || node.kids.length < 2) return null;
    const kids: Node<T>[] = [];
    for (const k of node.kids) {
      const kid = walk(k, depth + 1);
      if (!kid) return null;
      kids.push(kid);
    }
    const given = Array.isArray(node.sizes) ? node.sizes : [];
    const sizes = kids.map((_, i) => (Number(given[i]) > 0.02 ? Number(given[i]) : 1 / kids.length));
    const total = sizes.reduce((a, b) => a + b, 0);
    return { id: ++splits, dir: node.dir, kids, sizes: sizes.map((x) => x / total) };
  };
  const built = walk(saved, 0);
  return built && used.size === list.length ? built : null;
}
