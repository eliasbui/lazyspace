import { describe, expect, it } from 'vitest';
import { cellAt, covered, gridOf, MARGIN, nearest, placeOf } from './grid';

describe('the desktop grid', () => {
  it('fits whole cells inside the margins', () => {
    // 64 point icons take cells of 108 by 118.
    expect(gridOf(2 * MARGIN + 108 * 3 + 50, 2 * MARGIN + 118 * 2 + 10, 64)).toEqual({ cols: 3, rows: 2 });
    expect(gridOf(10, 10, 64)).toEqual({ cols: 1, rows: 1 });
  });

  it('counts columns from the right edge and finds the cell under a point again', () => {
    const width = 1000;
    expect(placeOf([0, 0], width, 64)).toEqual({ left: width - MARGIN - 108, top: MARGIN });
    expect(placeOf([1, 2], width, 64)).toEqual({ left: width - MARGIN - 216, top: MARGIN + 236 });
    const { left, top } = placeOf([1, 2], width, 64);
    expect(cellAt(left + 5, top + 5, { left: 0, top: 0, width }, 64)).toEqual({ col: 1, row: 2 });
  });

  it('selects the icons a rectangle meets', () => {
    const cells = { a: [0, 0] as [number, number], b: [0, 1] as [number, number], c: [3, 3] as [number, number] };
    const { left, top } = placeOf([0, 1], 1000, 64);
    expect(covered({ left: left + 1, top: top - 20, right: left + 10, bottom: top + 10 }, cells, 1000, 64).sort()).toEqual(['a', 'b']);
  });

  it('moves to the nearest icon on the side of an arrow', () => {
    const cells = { here: [1, 1] as [number, number], below: [1, 2] as [number, number], left: [2, 1] as [number, number], far: [1, 5] as [number, number] };
    expect(nearest([1, 1], cells, 'down')).toBe('below');
    expect(nearest([1, 1], cells, 'left')).toBe('left');
    expect(nearest([1, 1], cells, 'right')).toBeNull();
  });
});
