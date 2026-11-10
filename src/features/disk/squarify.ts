export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Rectangles for items of sizes `sizes` (largest first) in a box, as square as they can be (Bruls, Huizing and van Wijk's
 * squarified treemap): rows are laid along the shorter side while that keeps their shapes squarer.
 */
export function squarify(sizes: readonly number[], x: number, y: number, w: number, h: number): Rect[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  const out: Rect[] = [];
  if (!total || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  let rest = sizes.map((s) => s * scale);
  let box: Rect = { x, y, w, h };
  while (rest.length) {
    const side = Math.min(box.w, box.h);
    let row: number[] = [];
    let worst = Infinity;
    for (const area of rest) {
      const next = [...row, area];
      const sum = next.reduce((a, b) => a + b, 0);
      const ratio = Math.max(...next.map((a) => Math.max((side * side * a) / (sum * sum), (sum * sum) / (side * side * a))));
      if (ratio > worst) break;
      row = next;
      worst = ratio;
    }
    rest = rest.slice(row.length);
    const sum = row.reduce((a, b) => a + b, 0);
    const thick = sum / side;
    let at = 0;
    for (const area of row) {
      const len = area / thick;
      out.push(box.w >= box.h ? { x: box.x, y: box.y + at, w: thick, h: len } : { x: box.x + at, y: box.y, w: len, h: thick });
      at += len;
    }
    box = box.w >= box.h ? { x: box.x + thick, y: box.y, w: box.w - thick, h: box.h } : { x: box.x, y: box.y + thick, w: box.w, h: box.h - thick };
  }
  return out;
}
