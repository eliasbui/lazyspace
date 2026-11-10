// Selecting in the rows a view draws (the tab's column, the gallery's strip) as in the list: a click selects one, Command
// turns one over, Shift a range from where the last click was; the arrows move, typing a name finds it. The selection is
// the tab's own, set through `selectWhenListed`, so the menus, the keys and the other features see it.
import type { KeyboardEvent, MouseEvent } from 'react';
import { useApp } from '@/lib/app-state';
import { panes, type PaneHandle, type TabView } from '@/lib/panes-api';
import { registry } from '@/lib/registry';
import { api, type Row } from '@/services';

export type RowAt = (index: number) => Row | null;
export type How = 'only' | 'toggle' | 'range';

/** Where a range starts, by tab: the row last clicked or moved to without Shift. */
const anchors = new Map<string, number>();

export function selectRow(pane: PaneHandle, i: number, how: How, rowAt: RowAt): void {
  const tab = pane.tab;
  const row = rowAt(i);
  if (!row) return;
  if (how === 'range') {
    const from = anchors.get(tab.id) ?? (tab.anchor >= 0 ? tab.anchor : i);
    const names: string[] = [];
    for (let k = Math.min(from, i); k <= Math.max(from, i); k++) {
      const r = rowAt(k);
      if (r && r.name !== row.name) names.push(r.name);
    }
    // The name first takes the cursor.
    tab.selectWhenListed([row.name, ...names]);
    return;
  }
  anchors.set(tab.id, i);
  if (how === 'only') return tab.selectWhenListed([row.name]);
  const now = tab.selectedEntries().map((e) => e.name);
  const rest = now.filter((n) => n !== row.name);
  if (rest.length === now.length) tab.selectWhenListed([row.name, ...rest]);
  else if (rest.length) tab.selectWhenListed(rest);
  else panes.action('deselect', pane);
}

/** How a click selects, by the keys held: Command (Ctrl in the Windows keys) turns one over, Shift makes a range. */
export function howOf(e: MouseEvent | KeyboardEvent): How {
  const windows = useApp.getState().settings?.keymap === 'windows';
  if (e.shiftKey) return 'range';
  return (windows ? e.ctrlKey : e.metaKey) ? 'toggle' : 'only';
}

/** Moves the cursor by `delta` rows (Infinity to the end), with Shift extending the selection. Returns where it went. */
export function moveBy(pane: PaneHandle, delta: number, extend: boolean, rowAt: RowAt): number | null {
  const tab = pane.tab;
  if (!tab.count) return null;
  let i = delta === Infinity ? tab.count - 1 : delta === -Infinity ? 0 : tab.lead < 0 ? (delta > 0 ? 0 : tab.count - 1) : tab.lead + delta;
  i = Math.max(0, Math.min(tab.count - 1, i));
  selectRow(pane, i, extend ? 'range' : 'only', rowAt);
  return i;
}

let typed = '';
let typedTimer: ReturnType<typeof setTimeout> | undefined;

/** Typing a name finds it, as in Finder; what is typed within a second adds up. Calls `found` with its index. */
export function findTyped(tab: TabView, key: string, found: (index: number) => void): void {
  clearTimeout(typedTimer);
  typed += key.toLowerCase();
  typedTimer = setTimeout(() => (typed = ''), 1000);
  const generation = tab.generation;
  api.view
    .find({ view: tab.id, prefix: typed })
    .then(async (d) => {
      if (d.index == null) return;
      found(d.index);
      const got = await api.view.rows({ view: tab.id, start: d.index, count: 1, generation });
      const row = got.rows[0];
      if (row) tab.selectWhenListed([row.name]);
    })
    .catch(() => undefined);
}

/** Whether a plain key is one a feature gave an action of its own, which typing a name leaves alone. */
export function keyHasAction(e: KeyboardEvent): boolean {
  const keymap = useApp.getState().settings?.keymap === 'windows' ? 'windows' : 'mac';
  const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key;
  return !!registry.keys.extra(keymap)[key];
}

/**
 * A right click: the row is selected first if it was not, and the menu waits for the selection to be the tab's, so it
 * is the menu of what was clicked. On nothing, the menu of the folder.
 */
export function rowMenu(pane: PaneHandle, x: number, y: number, index: number | null, rowAt: RowAt): void {
  const row = index == null ? null : rowAt(index);
  if (!row || index == null) return pane.contextMenu(x, y, null);
  const ready = () => pane.tab.isSel(row.name) && pane.tab.selectedEntries().some((e) => e.name === row.name);
  if (ready()) return pane.contextMenu(x, y, index);
  selectRow(pane, index, 'only', rowAt);
  const off = panes.on('selection', () => {
    if (!ready()) return;
    clearTimeout(timer);
    off();
    pane.contextMenu(x, y, index);
  });
  const timer = setTimeout(off, 1000);
}
