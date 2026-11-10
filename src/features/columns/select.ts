// The rows a view draws (the tab's column, the gallery's strip) are the tab's own: the pane loads them, selects them and
// moves its cursor through them as in its list, so the menus, the keys and the other features see the same selection.
import type { KeyboardEvent, MouseEvent } from 'react';
import { useApp } from '@/lib/app-state';
import { panes, type PaneHandle } from '@/lib/panes-api';
import { registry } from '@/lib/registry';

const windowsKeys = (): boolean => useApp.getState().settings?.keymap === 'windows';

/** The index of the row an event happened on (its `data-index`), or null on nothing. */
export function indexAt(target: EventTarget | null): number | null {
  const el = target instanceof Element ? target.closest('[data-index]') : null;
  return el ? Number(el.getAttribute('data-index')) : null;
}

/**
 * A press, as in the list: on nothing the selection goes; a right press (or Control and a click on a Mac) selects the
 * row unless it is; a click selects one, Command (Ctrl in the Windows keys) turns one over, Shift selects a range; then
 * the features that start a drag hear of it.
 */
export function press(pane: PaneHandle, e: MouseEvent): void {
  if (e.button !== 0 && e.button !== 2) return;
  panes.focus(pane);
  const tab = pane.tab;
  const i = indexAt(e.target);
  const toggle = e.metaKey || (e.ctrlKey && windowsKeys());
  if (i == null) {
    if (e.button === 0 && !toggle && !e.shiftKey && tab.selCount()) panes.action('deselect', pane);
    return;
  }
  const row = tab.rowAt(i);
  if (!row) return;
  if (e.button === 2 || (e.ctrlKey && !windowsKeys())) {
    if (!tab.isSel(row.name)) pane.select?.(i, 'only');
    return;
  }
  if (e.shiftKey && tab.anchor >= 0) pane.select?.(i, 'range');
  else if (toggle) pane.select?.(i, 'toggle');
  // A click on the only selected item keeps it; on one of several it waits for the drag that may follow.
  else if (!tab.isSel(row.name) || tab.selCount() === 1) pane.select?.(i, 'only');
  panes.emit('pointerdown', { pane, event: e.nativeEvent, index: i });
}

/** A right click: the menu of the selection, or of the folder on nothing. With the Windows keys Control and a click
 *  turns an item over instead. */
export function menu(pane: PaneHandle, e: MouseEvent): void {
  e.preventDefault();
  if (e.button === 0 && e.ctrlKey && windowsKeys()) return;
  pane.contextMenu?.(e.clientX, e.clientY, indexAt(e.target));
}

// The chord of a plain key as the keymap writes it, by its place on the keyboard.
const chordOf = (e: KeyboardEvent): string => (e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key);

/**
 * The keys of a view's rows: the arrows (and the pages, Home, End) by `steps` for its layout, Shift extending the
 * selection; typing a name finds it, unless a feature gave the key an action of its own. True when the key was taken.
 */
export function rowKey(pane: PaneHandle, e: KeyboardEvent, steps: Record<string, number>): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing) return false;
  const step = steps[e.key];
  if (step !== undefined) {
    pane.move?.(step, e.shiftKey);
    return true;
  }
  if (e.key.length === 1 && e.key !== ' ' && !registry.keys.extra(windowsKeys() ? 'windows' : 'mac')[chordOf(e)]) {
    pane.find?.(e.key.toLowerCase());
    return true;
  }
  return false;
}
