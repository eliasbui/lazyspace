// The keys of the window and the menu bar: one keydown handler turns a chord into an action of the panes, and the
// entries of the menu bar (`menu.action`) run theirs. The keymap in use is installed in src/lib/keymap.ts for the menus.
import { useEffect } from 'react';
import { useApp } from '@/lib/app-state';
import { installKeymap, keymap } from '@/lib/keymap';
import { panes } from '@/lib/panes-api';
import { openSheet, registry } from '@/lib/registry';
import { on, type KeymapName, type MenuAction } from '@/services';
import { chord, KEYMAPS } from './keymaps';

export { chord, KEYMAPS } from './keymaps';

const keymapName = (): KeymapName => (useApp.getState().settings?.keymap === 'windows' ? 'windows' : 'mac');

installKeymap(() => ({ ...KEYMAPS[keymapName()], ...registry.keys.extra(keymapName()) }));

/** What the menu bar asks for, by the ids of src-tauri/src/menus.rs. */
const MENU: Partial<Record<MenuAction, string>> = {
  'file.new_tab': 'newTab',
  'file.new_folder': 'newFolder',
  'file.eject': 'eject',
  'file.close_tab': 'closeTab',
  'view.list': 'viewList',
  'view.icons': 'viewIcons',
  'view.columns': 'viewColumns',
  'view.gallery': 'viewGallery',
  'view.hidden': 'toggleHidden',
  'go.back': 'back',
  'go.forward': 'forward',
  'go.enclosing': 'enclosing',
  'go.home': 'home',
  'go.desktop': 'desktop',
  'go.downloads': 'downloads',
  'go.applications': 'applications',
};

/** The id the settings feature registers its sheet under. */
export const SETTINGS_SHEET = 'settings';

function runMenu(id: MenuAction): void {
  if (id === 'app.settings') return openSheet(SETTINGS_SHEET);
  const action = MENU[id];
  if (action) panes.action(action);
}

// Every sheet, the questions of jobs included, is a modal overlay of the dialog component.
const sheetOpen = (): boolean => !!document.querySelector('[data-slot="dialog-overlay"]');

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing || sheetOpen()) return;
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  // A button of the sidebar or the toolbar keeps its own keys (Tab moves on, Space and Enter press it); chords with
  // Command or Control still act on the focused pane.
  if (!e.metaKey && !e.ctrlKey && target?.closest('button, a, [role="button"]')?.closest('[data-chrome]')) return;
  const pane = panes.focused();
  if (!pane) return;
  // The column view goes out to the folder on the left and into the folder selected on the right.
  if (pane.tab.mode === 'columns' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (panes.action(e.key === 'ArrowLeft' ? 'columnOut' : 'columnIn', pane)) e.preventDefault();
    return;
  }
  const name = keymap()[chord(e)];
  if (name && panes.action(name, pane)) e.preventDefault();
}

// Selection is drawn in the accent colour only while the window is in front, as macOS draws it.
const blur = (): void => document.body.classList.add('inactive');
const focus = (): void => document.body.classList.remove('inactive');

/** Listens to the keys and the menu bar while the window lives; App calls it once. */
export function useKeys(): void {
  useEffect(() => {
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    const off = on('menu.action', ({ id }) => runMenu(id));
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      off();
    };
  }, []);
}
