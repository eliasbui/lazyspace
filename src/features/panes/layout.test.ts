import { describe, expect, it } from 'vitest';
import { PRESETS, isLeaf, leaf, leaves, split, tidy, treeFrom, treeState, type Node } from './layout';

const shape = (node: Node<string>): unknown => (isLeaf(node) ? node.pane : { [node.dir]: node.kids.map(shape) });

describe('the layout tree', () => {
  it('builds the presets in the order of the panes', () => {
    const tree = PRESETS.l1r2(['a', 'b', 'c']);
    expect(shape(tree)).toEqual({ row: ['a', { col: ['b', 'c'] }] });
    expect(leaves(PRESETS.g6(['a', 'b', 'c', 'd', 'e', 'f']))).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('joins a split into a split of the same way and drops a split of one', () => {
    const inner = split('row', [leaf('b'), leaf('c')]);
    const tree = split('row', [leaf('a'), inner]);
    const tidied = tidy(tree);
    expect(shape(tidied)).toEqual({ row: ['a', 'b', 'c'] });
    expect(isLeaf(tidied) ? [] : tidied.sizes).toEqual([0.5, 0.25, 0.25]);
    expect(shape(tidy(split('col', [leaf('a')])))).toBe('a');
  });

  it('keeps the tree through layout.json and refuses one that does not fit the panes', () => {
    const tree = PRESETS.grid(['a', 'b', 'c', 'd']);
    const saved = treeState(tree, (p) => ['a', 'b', 'c', 'd'].indexOf(p));
    const back = treeFrom(saved, ['a', 'b', 'c', 'd']);
    expect(back && shape(back)).toEqual(shape(tree));
    expect(treeFrom(saved, ['a', 'b', 'c'])).toBeNull();
    expect(treeFrom({ dir: 'row', kids: [{ p: 0 }, { p: 0 }] }, ['a'])).toBeNull();
    expect(treeFrom('nonsense', ['a'])).toBeNull();
  });
});
