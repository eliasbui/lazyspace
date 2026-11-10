// The grid of the desktop's icons, as Finder lays it out: cells counted from the top right, the column from the right
// edge and the row from the top, with a margin kept free around them. Pure functions (grid.test.ts checks them).

/** The space kept free around the icons, as Finder keeps it from the screen's edges. */
export const MARGIN = 12;

export type Cell = [col: number, row: number];
export type Cells = Readonly<Record<string, Cell>>;

/** The side of a cell for an icon of `icon` points, with room for two lines of its name. */
export const cellSize = (icon: number): { w: number; h: number } => ({ w: icon + 44, h: icon + 54 });

/** How many columns and rows fit in a screen of `width` by `height`. */
export function gridOf(width: number, height: number, icon: number): { cols: number; rows: number } {
  const { w, h } = cellSize(icon);
  return { cols: Math.max(1, Math.floor((width - 2 * MARGIN) / w)), rows: Math.max(1, Math.floor((height - 2 * MARGIN) / h)) };
}

/** Where the cell is drawn in a screen `width` wide: its left and top in points. */
export function placeOf([col, row]: Cell, width: number, icon: number): { left: number; top: number } {
  const { w, h } = cellSize(icon);
  return { left: width - MARGIN - (col + 1) * w, top: MARGIN + row * h };
}

/** The cell under the point (`x`, `y`) of a screen whose box is `box`. */
export function cellAt(x: number, y: number, box: { left: number; top: number; width: number }, icon: number): { col: number; row: number } {
  const { w, h } = cellSize(icon);
  return { col: Math.max(0, Math.floor((box.left + box.width - MARGIN - x) / w)), row: Math.max(0, Math.floor((y - box.top - MARGIN) / h)) };
}

/** The names whose cells meet the rectangle (in the screen's points). */
export function covered(rect: { left: number; top: number; right: number; bottom: number }, cells: Cells, width: number, icon: number): string[] {
  const { w, h } = cellSize(icon);
  return Object.entries(cells)
    .filter(([, cell]) => {
      const { left, top } = placeOf(cell, width, icon);
      return left < rect.right && left + w > rect.left && top < rect.bottom && top + h > rect.top;
    })
    .map(([name]) => name);
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/** The icon next to `from` in a direction: the nearest one on that side, the one most in line first. */
export function nearest(from: Cell, cells: Cells, direction: Direction): string | null {
  let best: string | null = null;
  let score = Infinity;
  for (const [name, [col, row]] of Object.entries(cells)) {
    // Columns count from the right, so going right is going to a smaller column.
    const along = direction === 'up' ? from[1] - row : direction === 'down' ? row - from[1] : direction === 'left' ? col - from[0] : from[0] - col;
    const across = direction === 'up' || direction === 'down' ? Math.abs(col - from[0]) : Math.abs(row - from[1]);
    if (along <= 0) continue;
    const s = along + across * 2;
    if (s < score) {
      score = s;
      best = name;
    }
  }
  return best;
}
