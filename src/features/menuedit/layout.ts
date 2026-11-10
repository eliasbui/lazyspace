// The arrangement of the context menu as the editor shows it, from the items of the registry and menu.json.
import type { MenuLayout } from '@/services';

export const EMPTY_LAYOUT: MenuLayout = { order: [], hidden: [], icons: {}, separators: [] };

interface Item {
  id: string;
  group?: number;
}

/** The items in the order the user gave; those the user never placed come after, in their groups' order. */
export function ordered<T extends Item>(items: T[], order: string[]): T[] {
  if (!order.length) return items;
  const rank = (id: string): number => {
    const at = order.indexOf(id);
    return at < 0 ? Infinity : at;
  };
  return [...items].sort((a, b) => rank(a.id) - rank(b.id));
}

/** Without an order of the user's own, the lines of the menu are where the groups change. */
export function defaultSeparators(items: Item[]): string[] {
  return items.filter((item, i) => i + 1 < items.length && (items[i + 1]?.group ?? 50) !== (item.group ?? 50)).map((item) => item.id);
}

/** The lines after items: the user's, or those of the groups while the menu has its default order. */
export function separatorsOf(items: Item[], layout: MenuLayout): string[] {
  return layout.order.length ? layout.separators : defaultSeparators(items);
}
