// A small native menu of choices (the old page's `LZ.choose`): the menu of a sidebar item, a menu under a button.
import { api, on, type MenuNode } from '@/services';

/** Shows `items` as a native menu at `x`, `y`; resolves the id chosen, or null when the menu closed without a choice. */
export function choose(items: MenuNode[], x: number, y: number): Promise<string | null> {
  return new Promise((resolve) => {
    const stops = [on('menu.chosen', ({ id }) => done(id)), on('menu.closed', () => done(null))];
    function done(id: string | null): void {
      for (const stop of stops) stop();
      resolve(id);
    }
    api.menu.show({ items, x, y }).catch(() => done(null));
  });
}
