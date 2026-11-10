// The items of the core in the context menu (the old page's 08-core-menu.js). Features add theirs with registry.menu.add;
// the user arranges all of them (menu.json, which Rust applies when it shows the menu).
import { useApp } from '@/lib/app-state';
import { panes } from '@/lib/panes-api';
import { registry, type MenuCtx, type MenuItemDef } from '@/lib/registry';
import { isLocal } from '@/lib/uri';
import type { SortBy } from '@/services';
import { GROUPS } from '../columns';

const act = (name: string) => (ctx: MenuCtx) => void panes.action(name, ctx.pane);
const one = (ctx: MenuCtx) => ctx.count === 1;
const some = (ctx: MenuCtx) => ctx.count > 0;
const none = (ctx: MenuCtx) => ctx.count === 0;
// Items of this Mac: those selected (search results and the shelf hold items of many folders), or the folder itself.
const local = (ctx: MenuCtx) => (ctx.count ? ctx.entries.length > 0 && ctx.entries.every((e) => isLocal(e.uri)) : isLocal(ctx.tab.uri));
const file = (ctx: MenuCtx) => one(ctx) && !!ctx.entry && !ctx.entry.isDir && isLocal(ctx.entry.uri);
const sortItem = (by: SortBy, label: MenuItemDef['label']): MenuItemDef => ({
  id: `sort.${by}`,
  label,
  checked: (ctx) => ctx.pane.sortOf(ctx.tab).by === by,
  run: (ctx) => ctx.pane.sortBy(by),
});

export const CORE_ITEMS: MenuItemDef[] = [
  { id: 'open', label: 'm.open', icon: 'arrow.up.forward.app', group: 10, order: 1, when: some, action: 'open', run: act('open') },
  // Rust fills "Open With" with the apps for the item.
  { id: 'openWith', label: 'm.openWith', icon: 'square.and.arrow.up.on.square', group: 10, order: 2, when: file, submenu: [] },
  { id: 'openTab', label: 'm.openTab', icon: 'plus.rectangle.on.rectangle', group: 10, order: 3, when: (c) => some(c) && c.entries.every((e) => e.isDir), run: act('openInNewTab') },
  { id: 'quickLook', label: 'm.quickLook', icon: 'eye', group: 10, order: 4, when: some, action: 'quickLook', run: act('quickLook') },
  { id: 'getInfo', label: 'm.getInfo', icon: 'info.circle', group: 20, order: 1, when: local, action: 'getInfo', run: act('getInfo') },
  { id: 'rename', label: 'm.rename', icon: 'pencil', group: 20, order: 2, when: (c) => one(c) && c.tab.capabilities.rename, run: act('rename') },
  { id: 'duplicate', label: 'm.duplicate', icon: 'plus.square.on.square', group: 20, order: 3, when: (c) => some(c) && c.tab.capabilities.write, action: 'duplicate', run: act('duplicate') },
  { id: 'copyPath', label: 'm.copyPath', icon: 'link', group: 20, order: 4, when: local, action: 'copyPath', run: act('copyPath') },
  { id: 'copy', label: 'm.copy', icon: 'doc.on.doc', group: 30, order: 1, when: (c) => some(c) && local(c), action: 'copy', run: act('copy') },
  { id: 'cut', label: 'm.cut', icon: 'scissors', group: 30, order: 2, when: (c) => some(c) && local(c) && c.tab.capabilities.write, action: 'cut', run: act('cut') },
  { id: 'paste', label: 'm.paste', icon: 'doc.on.clipboard', group: 30, order: 3, when: (c) => c.tab.capabilities.write, action: 'paste', run: act('paste') },
  { id: 'trash', label: 'm.trash', icon: 'trash', group: 40, order: 1, when: (c) => some(c) && c.tab.capabilities.trash, action: 'trash', run: act('trash') },
  { id: 'delete', label: 'm.delete', icon: 'trash.slash', group: 40, order: 2, when: (c) => some(c) && c.tab.capabilities.write, action: 'delete', run: act('delete') },
  { id: 'newFolder', label: 'm.newFolder', icon: 'folder.badge.plus', group: 50, order: 1, when: (c) => c.tab.capabilities.write, action: 'newFolder', run: act('newFolder') },
  { id: 'reveal', label: 'm.reveal', icon: 'macwindow', group: 50, order: 2, when: local, action: 'reveal', run: act('reveal') },
  {
    id: 'view',
    label: 'm.view',
    icon: 'square.grid.2x2',
    group: 60,
    order: 1,
    when: none,
    submenu: [
      { id: 'view.list', label: 'm.asList', icon: 'list.bullet', checked: (c) => c.tab.mode === 'list', action: 'viewList', run: act('viewList') },
      { id: 'view.icons', label: 'm.asIcons', icon: 'square.grid.2x2', checked: (c) => c.tab.mode === 'icons', action: 'viewIcons', run: act('viewIcons') },
      { id: 'view.columns', label: 'm.asColumns', icon: 'rectangle.split.3x1', checked: (c) => c.tab.mode === 'columns', action: 'viewColumns', run: act('viewColumns') },
      { id: 'view.gallery', label: 'm.asGallery', icon: 'photo.on.rectangle', checked: (c) => c.tab.mode === 'gallery', action: 'viewGallery', run: act('viewGallery') },
    ],
  },
  { id: 'sort', label: 'm.sort', icon: 'arrow.up.arrow.down', group: 60, order: 2, when: none, submenu: [sortItem('name', 'm.byName'), sortItem('mtime', 'm.byDate'), sortItem('size', 'm.bySize'), sortItem('kind', 'm.byKind')] },
  {
    id: 'groups',
    label: 'm.groups',
    icon: 'rectangle.grid.1x2',
    group: 60,
    order: 2.5,
    when: (c) => none(c) && c.tab.mode === 'list',
    submenu: GROUPS.map(([g, word]) => ({ id: `group.${g || 'none'}`, label: word, checked: (c: MenuCtx) => (c.pane.sortOf(c.tab).group || '') === g, run: (c: MenuCtx) => c.pane.groupBy(g) })),
  },
  { id: 'hidden', label: 'm.hidden', icon: 'eye.slash', group: 60, order: 3, when: none, checked: () => !!useApp.getState().settings?.show_hidden, action: 'toggleHidden', run: act('toggleHidden') },
];

export function registerCoreMenu(): void {
  for (const item of CORE_ITEMS) registry.menu.add(item);
}
