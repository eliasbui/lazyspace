import { say } from '@/lib/ui';
import { api, on, type MenuNode } from '@/services';

/** Shows a native menu at a point of the window; resolves the id chosen, or null when it was closed. */
export function choose(items: MenuNode[], x: number, y: number): Promise<string | null> {
  return new Promise((resolve) => {
    const stops: Array<() => void> = [];
    const done = (id: string | null) => {
      for (const stop of stops) stop();
      resolve(id);
    };
    stops.push(
      on('menu.chosen', (d) => done(d.id)),
      on('menu.closed', () => done(null)),
    );
    api.menu.show({ items, x, y }).catch((error: unknown) => {
      say(error);
      done(null);
    });
  });
}
