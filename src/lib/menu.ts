// A small native menu of choices (the old page's `LZ.choose`): under a toolbar button, a filter, a pill. The host draws
// it and says which item was chosen.
import { api, on, type MenuNode } from '@/services';

/** Shows `items` as a native menu at `x`, `y` (points in the window); resolves the id chosen, or null when none was. */
export function choose(items: MenuNode[], x: number, y: number): Promise<string | null> {
  return new Promise((resolve) => {
    const offs = [on('menu.chosen', ({ id }) => done(id)), on('menu.closed', () => done(null))];
    function done(id: string | null): void {
      for (const off of offs) off();
      resolve(id);
    }
    api.menu.show({ items, x: Math.round(x), y: Math.round(y) }).catch(() => done(null));
  });
}
