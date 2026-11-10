// A small native menu of choices (the layout button, the history of Back, a place's menu in the sidebar), as the old
// page's `LZ.choose`: the host draws it and answers with `menu.chosen` or `menu.closed`.
import { api, on, type MenuNode } from '@/services';

/** Shows `items` at (x, y) in the page; resolves the id chosen, or null when the menu closed without a choice. */
export function choose(items: MenuNode[], x: number, y: number): Promise<string | null> {
  return new Promise((resolve) => {
    const offs: Array<() => void> = [];
    const done = (id: string | null) => {
      for (const off of offs) off();
      resolve(id);
    };
    offs.push(
      on('menu.chosen', (d) => done(d.id)),
      on('menu.closed', () => done(null)),
    );
    api.menu.show({ items, x: Math.round(x), y: Math.round(y) }).catch(() => done(null));
  });
}

export const separator: MenuNode = { separator: true };
