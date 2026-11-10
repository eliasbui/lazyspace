import { describe, expect, it } from 'vitest';
import { EMPTY_LAYOUT, defaultSeparators, ordered, separatorsOf } from './layout';

const items = [
  { id: 'open', group: 10 },
  { id: 'openWith', group: 10 },
  { id: 'copy', group: 30 },
  { id: 'trash', group: 90 },
];

describe('menu layout', () => {
  it('keeps the groups order without an order of the user', () => {
    expect(ordered(items, []).map((i) => i.id)).toEqual(['open', 'openWith', 'copy', 'trash']);
  });

  it('puts the ids of the order first and the rest after', () => {
    expect(ordered(items, ['trash', 'open']).map((i) => i.id)).toEqual(['trash', 'open', 'openWith', 'copy']);
  });

  it('draws a line where the groups change', () => {
    expect(defaultSeparators(items)).toEqual(['openWith', 'copy']);
    expect(separatorsOf(items, EMPTY_LAYOUT)).toEqual(['openWith', 'copy']);
  });

  it('keeps the lines of the user once there is an order', () => {
    expect(separatorsOf(items, { ...EMPTY_LAYOUT, order: ['open'], separators: ['open'] })).toEqual(['open']);
  });
});
