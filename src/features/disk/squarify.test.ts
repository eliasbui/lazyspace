import { describe, expect, it } from 'vitest';
import { squarify } from './squarify';

describe('squarify', () => {
  it('fills the box with one rectangle per size, areas in proportion', () => {
    const sizes = [6, 6, 4, 3, 2, 2, 1];
    const rects = squarify(sizes, 0, 0, 600, 400);
    expect(rects).toHaveLength(sizes.length);
    const total = sizes.reduce((a, b) => a + b, 0);
    rects.forEach((r, i) => expect(r.w * r.h).toBeCloseTo((600 * 400 * (sizes[i] ?? 0)) / total, 6));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(600 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(400 + 1e-9);
    }
  });

  it('gives nothing for an empty box or no bytes', () => {
    expect(squarify([], 0, 0, 100, 100)).toEqual([]);
    expect(squarify([0, 0], 0, 0, 100, 100)).toEqual([]);
    expect(squarify([1], 0, 0, 0, 100)).toEqual([]);
  });

  it('starts at the corner it is given', () => {
    const [r] = squarify([1], 3, 20, 50, 40);
    expect(r).toEqual({ x: 3, y: 20, w: 50, h: 40 });
  });
});
