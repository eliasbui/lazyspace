// Native menus: the page sends a tree to Rust, which shows it and answers with `menu.chosen` or `menu.closed`. One is
// open at a time, so one answer is awaited at a time.
import { useApp } from '@/lib/app-state';
import { registry } from '@/lib/registry';
import { api, on, type MenuNode, type Uri } from '@/services';

/**
 * The chord of the keymap for an action, to show beside a menu item. The keymap is read from the keys registered with
 * `registry.keys.add`, where the keys feature puts its own too.
 */
export function shortcutOf(action: string): string | undefined {
  const map = registry.keys.extra(useApp.getState().settings?.keymap === 'windows' ? 'windows' : 'mac');
  return Object.keys(map).find((chord) => map[chord] === action);
}

let waiting: ((id: string | null) => void) | null = null;

const answer = (id: string | null): void => {
  const resolve = waiting;
  waiting = null;
  resolve?.(id);
};

on('menu.chosen', ({ id }) => answer(id));
on('menu.closed', () => answer(null));

/** Shows `items` at (x, y) of the window; resolves the id chosen, or null. `uris` lets Rust fill "Open With". */
export function showMenu(items: MenuNode[], x: number, y: number, uris?: Uri[]): Promise<string | null> {
  answer(null);
  if (!items.length) return Promise.resolve(null);
  return new Promise((resolve) => {
    waiting = resolve;
    api.menu.show({ items, x: Math.round(x), y: Math.round(y), uris }).catch(() => {
      if (waiting === resolve) answer(null);
    });
  });
}

/** A choice of a small menu: a separator, or an item with an SF Symbol and a submenu of choices. */
export type Choice = { separator: true } | { id: string; label: string; icon?: string; checked?: boolean; enabled?: boolean; submenu?: Choice[] };

const node = (c: Choice): MenuNode =>
  'separator' in c ? { separator: true } : { id: c.id, label: c.label, icon: c.icon, checked: !!c.checked, enabled: c.enabled !== false, submenu: (c.submenu ?? []).map(node) };

/** A small native menu of choices (a crumb's folders, the history, a tab's menu). */
export const choose = (choices: Choice[], x: number, y: number): Promise<string | null> => showMenu(choices.map(node), x, y);

/** Below an element, as a menu opened from a button. */
export const below = (el: Element | null | undefined): { x: number; y: number } => {
  const r = el?.getBoundingClientRect();
  return r ? { x: r.left, y: r.bottom + 4 } : { x: 0, y: 0 };
};
