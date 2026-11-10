// What File Explorer on Windows has that the core did not (the old page's parts/17-explorer.js): a folder pinned to the
// sidebar, a folder in a new window, the selection turned over or cleared, and a menu of the rest behind a button at the
// end of the toolbar.
import { createElement } from 'react';
import { DotsThreeCircleIcon } from '@phosphor-icons/react';
import { t } from '@/i18n';
import { setSetting, useApp } from '@/lib/app-state';
import { choose } from '@/lib/native-choice';
import { panes } from '@/lib/panes-api';
import { registry, type MenuCtx, type MenuItemDef } from '@/lib/registry';
import { sidebar } from '@/lib/sidebar-api';
import { samePlace } from '@/lib/uri';
import type { Uri } from '@/services';

const act = (name: string) => (ctx: MenuCtx) => void panes.action(name, ctx.pane);
const folders = (ctx: MenuCtx) => ctx.count > 0 && ctx.entries.length > 0 && ctx.entries.every((e) => e.isDir);
/** The folder a pin is about: the one folder selected, or the pane's own on a click beside the items. */
const pinTarget = (ctx: MenuCtx): Uri | null => (ctx.count === 1 && ctx.entry?.isDir ? ctx.entry.uri : ctx.count === 0 ? ctx.tab.uri : null);
const isPinned = (uri: Uri) => sidebar.pinned().some((p) => samePlace(p, uri));

/** The sidebar has no way to unpin, so the folder leaves the pinned list of the settings it is kept in. */
function unpin(uri: Uri): void {
  const pinned = useApp.getState().settings?.favourites ?? [];
  void setSetting({ favourites: pinned.filter((p) => !samePlace(p, uri)) });
}

const MENU: MenuItemDef[] = [
  { id: 'openWindow', label: 'm.openWindow', icon: 'macwindow.badge.plus', group: 10, order: 3.5, when: folders, action: 'openInNewWindow', run: act('openInNewWindow') },
  {
    id: 'pin',
    label: 'm.pin',
    icon: 'pin',
    group: 50,
    order: 4,
    when: (ctx) => {
      const uri = pinTarget(ctx);
      return !!uri && !isPinned(uri);
    },
    run: (ctx) => {
      const uri = pinTarget(ctx);
      if (uri) sidebar.pin(uri);
    },
  },
  {
    id: 'unpin',
    label: 'm.unpin',
    icon: 'pin.slash',
    group: 50,
    order: 4,
    when: (ctx) => {
      const uri = pinTarget(ctx);
      return !!uri && isPinned(uri);
    },
    run: (ctx) => {
      const uri = pinTarget(ctx);
      if (uri) unpin(uri);
    },
  },
  {
    id: 'select',
    label: 'm.select',
    icon: 'checklist',
    group: 60,
    order: 4,
    when: (ctx) => ctx.count === 0 && ctx.tab.count > 0,
    submenu: [
      { id: 'select.all', label: 'm.selectAll', icon: 'checkmark.circle', action: 'selectAll', run: act('selectAll') },
      { id: 'select.none', label: 'selectNone', icon: 'circle', action: 'selectNone', run: act('selectNone') },
      { id: 'select.invert', label: 'invertSelection', icon: 'circle.lefthalf.filled', action: 'invertSelection', run: act('invertSelection') },
    ],
  },
];

/** The menu at the end of the toolbar, as File Explorer's "See more": the selection, what the window shows, the item's details and the settings. */
async function moreMenu(rect: DOMRect): Promise<void> {
  const pane = panes.focused();
  const settings = useApp.getState().settings;
  if (!pane || !settings) return;
  const id = await choose(
    [
      { id: 'selectAll', label: t('m.selectAll'), icon: 'checkmark.circle' },
      { id: 'selectNone', label: t('selectNone'), icon: 'circle', enabled: pane.tab.selCount() > 0 },
      { id: 'invertSelection', label: t('invertSelection'), icon: 'circle.lefthalf.filled' },
      { separator: true },
      { id: 'toggleHidden', label: t('m.hidden'), icon: 'eye', checked: settings.show_hidden },
      { id: 'alwaysTabs', label: t('alwaysTabs'), icon: 'rectangle.stack', checked: settings.always_tabs },
      ...(registry.actions.get('togglePreview') ? [{ id: 'togglePreview', label: t('cmd.togglePreview'), icon: 'sidebar.right' }] : []),
      { id: 'toggleSidebar', label: t('cmd.toggleSidebar'), icon: 'sidebar.left' },
      { separator: true },
      { id: 'copyPath', label: t('m.copyPath'), icon: 'link' },
      { id: 'getInfo', label: t('m.getInfo'), icon: 'info.circle' },
      { id: 'settings', label: t('settingsMenu'), icon: 'gearshape' },
    ],
    rect.left,
    rect.bottom + 6,
  );
  if (id === 'alwaysTabs') void setSetting({ always_tabs: !settings.always_tabs });
  else if (id) panes.action(id, pane);
}

export function register(): void {
  for (const item of MENU) registry.menu.add(item);
  registry.keys.add({ 'Cmd+Alt+A': 'selectNone' }, 'mac');
  // It goes last, after the buttons every other feature adds.
  registry.toolbar.add({ id: 'more', side: 'right', icon: createElement(DotsThreeCircleIcon), label: 'moreActions', order: 1000, run: (rect) => void moreMenu(rect) });
}
