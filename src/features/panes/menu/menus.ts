// The small native menus of a pane: a tab's, the columns of the list, the history of the path bar, the folders in a
// crumb, and the crumbs hidden for lack of room.
import { t } from '@/i18n';
import { setSetting, useApp } from '@/lib/app-state';
import { registry, type Crumb } from '@/lib/registry';
import { say } from '@/lib/ui';
import { isLocal, samePlace } from '@/lib/uri';
import { api, type ColumnKey } from '@/services';
import { COLUMNS, COLUMN_KEYS, GROUPS, TAB_COLORS, isColumn } from '../columns';
import { manager } from '../manager';
import type { Pane } from '../pane';
import { placeLabel } from '../places';
import { below, choose, type Choice } from './native';

/** The menu of tab `i`, as File Explorer and the browsers have it: the panes to send it to, its name and colour. */
export async function tabMenu(pane: Pane, i: number, x: number, y: number): Promise<void> {
  const n = pane.tabs.length;
  const all = manager.all();
  const others = all.filter((p) => p !== pane);
  const tab = pane.tabs[i];
  if (!tab) return;
  const room = all.length < manager.MAX_PANES;
  const name = (p: Pane) => p.tab.title || (p.tab.uri ? registry.places.nameOf(p.tab.uri) : '');
  const id = await choose(
    [
      { id: 'new', label: t('newTab'), icon: 'plus' },
      { id: 'duplicate', label: t('duplicateTab'), icon: 'plus.square.on.square' },
      { separator: true },
      { id: 'rename', label: t('renameTab'), icon: 'pencil' },
      ...(tab.title ? [{ id: 'unname', label: t('resetTabName'), icon: 'arrow.counterclockwise' }] : []),
      {
        id: 'colors',
        label: t('tabColor'),
        icon: 'circle.fill',
        submenu: [{ id: 'color:', label: t('noColor'), checked: !tab.color }, { separator: true }, ...TAB_COLORS.map((c) => ({ id: `color:${c}`, label: t(`color.${c}`), checked: tab.color === c }))],
      },
      { separator: true },
      { id: 'split:right', label: t('splitRight'), icon: 'rectangle.split.2x1', enabled: room },
      { id: 'split:bottom', label: t('splitDown'), icon: 'rectangle.split.1x2', enabled: room },
      ...(others.length
        ? [{ id: 'panes', label: t('moveToPane'), icon: 'arrow.right.square', submenu: others.map((p) => ({ id: `pane:${all.indexOf(p)}`, label: `${t('paneN', all.indexOf(p) + 1)}: ${name(p)}` })) }]
        : []),
      { id: 'window', label: t('tabToWindow'), icon: 'macwindow.badge.plus' },
      { separator: true },
      { id: 'close', label: t('closeTab'), icon: 'xmark', enabled: n > 1 || all.length > 1 },
      { id: 'others', label: t('closeOtherTabs'), enabled: n > 1 },
      { id: 'right', label: t('closeTabsRight'), enabled: i < n - 1 },
      ...(all.length > 1 ? [{ id: 'closePane', label: t('closePane'), icon: 'xmark.square' }] : []),
      { separator: true },
      { id: 'reopen', label: t('cmd.reopenTab'), icon: 'arrow.uturn.backward' },
    ],
    x,
    y,
  );
  if (!id || pane.tabs[i] !== tab) return;
  if (id === 'new') pane.newTab();
  else if (id === 'duplicate') {
    pane.newTab(tab.uri, null, { at: i + 1 });
    pane.tab.title = tab.title;
    pane.tab.color = tab.color;
    pane.renderAll();
  } else if (id === 'rename') pane.renameTab(i);
  else if (id === 'unname') {
    tab.title = null;
    pane.renderAll();
    manager.saveSoon();
  } else if (id.startsWith('color:')) {
    const color = id.slice(6);
    tab.color = TAB_COLORS.find((c) => c === color) ?? null;
    pane.renderAll();
    manager.saveSoon();
  } else if (id.startsWith('split:')) {
    const side = id === 'split:right' ? 'right' : 'bottom';
    if (n > 1) manager.splitWith(pane, i, pane, side);
    else manager.splitNew(pane, side);
  } else if (id.startsWith('pane:')) {
    const to = all[Number(id.slice(5))];
    if (to) manager.moveTab(pane, i, to, to.tabs.length);
  } else if (id === 'window') pane.tabToWindow(i);
  else if (id === 'close') pane.closeTab(i);
  else if (id === 'others') {
    for (let k = n - 1; k >= 0; k--) if (k !== i) pane.closeTab(k);
  } else if (id === 'right') {
    for (let k = n - 1; k > i; k--) pane.closeTab(k);
  } else if (id === 'closePane') manager.closePane(pane);
  else if (id === 'reopen') manager.action('reopenTab', pane);
}

/** Right-clicked, the header lists the columns to show or hide and the groups, as Finder's and File Explorer's do. */
export async function columnsMenu(pane: Pane, x: number, y: number): Promise<void> {
  const columns = useApp.getState().settings?.columns ?? [];
  const chosen = pane.wantedColumns().filter((c) => c !== 'where' || columns.includes('where'));
  const group = pane.sortOf(pane.tab).group || '';
  const id = await choose(
    [
      ...COLUMN_KEYS.map((key) => ({ id: key, label: t(COLUMNS[key].word), checked: chosen.includes(key) })),
      { separator: true },
      ...GROUPS.map(([g, word]) => ({ id: `group:${g}`, label: t(word), checked: group === g })),
    ],
    x,
    y,
  );
  if (!id) return;
  if (id.startsWith('group:')) {
    const g = GROUPS.find(([k]) => k === id.slice(6))?.[0];
    if (g != null) pane.groupBy(g);
    return;
  }
  if (isColumn(id)) void setSetting({ columns: chosen.includes(id) ? chosen.filter((c) => c !== id) : withColumn(chosen, id) });
}

/** A column shown again goes after the nearest one before it in the usual order, the others keeping the order they were dragged to. */
function withColumn(chosen: ColumnKey[], id: ColumnKey): ColumnKey[] {
  const before = COLUMN_KEYS.slice(0, COLUMN_KEYS.indexOf(id))
    .filter((c) => chosen.includes(c))
    .pop();
  const at = before ? chosen.indexOf(before) + 1 : 0;
  return [...chosen.slice(0, at), id, ...chosen.slice(at)];
}

/** The places gone to lately in any tab or window, newest first, kept by the app (src/features/history.rs). */
export async function historyMenu(pane: Pane): Promise<void> {
  const places = await api.history.list().catch(() => []);
  const list = places.filter((p) => !samePlace(p.uri, pane.tab.uri)).slice(0, 20);
  const choices: Choice[] = list.map((p, i) => ({ id: String(i), label: placeLabel(p.uri), icon: isLocal(p.uri) ? 'folder' : 'network' }));
  if (choices.length) choices.push({ separator: true }, { id: 'clear', label: t('clearHistory'), icon: 'trash' });
  else choices.push({ id: 'none', label: t('noHistory'), enabled: false });
  const { x, y } = below(pane.boxEl);
  const id = await choose(choices, x, y);
  if (id === 'clear') api.history.clear().catch(say);
  else if (id != null) {
    const place = list[Number(id)];
    if (place) pane.navigate(place.uri);
  }
}

/** The folders in crumb `i`, the one the path goes through checked; the one chosen opens. */
export async function foldersMenu(pane: Pane, crumbs: Crumb[], i: number, button: Element): Promise<void> {
  const crumb = crumbs[i];
  if (!crumb) return;
  const next = crumbs[i + 1]?.[0];
  const found = await api.fs.subfolders({ uri: crumb[0] }).catch((error: unknown) => {
    say(error);
    return null;
  });
  if (!found) return;
  const choices: Choice[] = found.items.map((f, k) => ({ id: String(k), label: f.name, icon: 'folder', checked: samePlace(f.uri, next) }));
  const { x, y } = below(button);
  const id = await choose(choices.length ? choices : [{ id: 'none', label: t('noSubfolders'), enabled: false }], x, y);
  const folder = id == null ? null : found.items[Number(id)];
  if (folder) pane.navigate(folder.uri);
}

/** The crumbs hidden for lack of room, nearest first. */
export async function aboveMenu(pane: Pane, hidden: Crumb[], button: Element): Promise<void> {
  const nearest = [...hidden].reverse();
  const { x, y } = below(button);
  const id = await choose(
    nearest.map(([, name], k) => ({ id: String(k), label: name, icon: 'folder' })),
    x,
    y,
  );
  const crumb = id == null ? null : nearest[Number(id)];
  if (crumb) pane.navigate(crumb[0]);
}
