// The desktop's state and what it does: one listing of ~/Desktop, each icon in the cell it was put in (desktop.json, kept
// by Rust), a selection, and the actions of a pane on it. The window has no panes, so the desktop stands in for the one
// pane features and menu items talk to (`installPanes`), as the old page's desktop was a pane of icons.
import { create } from 'zustand';
import { t } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { shortcutOf } from '@/lib/keymap';
import { bumpPanes, installPanes, type PaneEvents, type PaneHandle, type PanesApi, type TabView } from '@/lib/panes-api';
import { menuTree, registry, type MenuCtx, type MenuItemDef } from '@/lib/registry';
import { confirm, say, toast } from '@/lib/ui';
import { pathOf, samePlace } from '@/lib/uri';
import { api, on, type Capabilities, type Row, type Selection, type Uri } from '@/services';
import { cellAt, gridOf, type Cell, type Cells } from './grid';

export const VIEW = 'desktop';

const NO_CAPS: Capabilities = { write: false, rename: false, trash: false, watch: false, sizes: false, localPath: false };

interface DeskState {
  uri: Uri | null;
  generation: number;
  rows: Row[];
  cells: Cells;
  capabilities: Capabilities;
  error: string | null;
  sel: ReadonlySet<string>;
  lead: string | null;
  anchor: string | null;
  renaming: string | null;
  /** Items cut and not pasted yet, by URI. */
  cut: ReadonlySet<string>;
  /** The folder icon a drop would go into. */
  dropOn: string | null;
  /** The size of the screen in points, for the grid. */
  width: number;
  height: number;
  box: { left: number; top: number; width: number };
}

export const useDesk = create<DeskState>(() => ({
  uri: null,
  generation: 0,
  rows: [],
  cells: {},
  capabilities: NO_CAPS,
  error: null,
  sel: new Set(),
  lead: null,
  anchor: null,
  renaming: null,
  cut: new Set(),
  dropOn: null,
  width: 0,
  height: 0,
  box: { left: 0, top: 0, width: 0 },
}));

const get = () => useDesk.getState();
export const iconSize = (): number => useApp.getState().settings?.icon_size ?? 64;
const grid = () => gridOf(get().width, get().height, iconSize());

// Names to select, or to rename, once the listing has them (a new folder, a paste), and an icon to put back in its cell
// after a rename.
let pendingSelect: string[] = [];
let pendingRename: string | null = null;
let pendingCell: { name: string; cell: Cell } | null = null;

// ---------------------------------------------------------------------------------------------------------------------
// The listing

export function list(): void {
  const { uri } = get();
  const settings = useApp.getState().settings;
  if (!uri) return;
  api.fs.list({ view: VIEW, uri, sort: settings?.sort, showHidden: settings?.show_hidden ?? false }).catch(say);
}

async function fetchRows(generation: number, count: number): Promise<void> {
  const rows: Row[] = [];
  for (let start = 0; start < count; start += 500) {
    const got = await api.view.rows({ view: VIEW, start, count: Math.min(500, count - start), generation }).catch(() => null);
    // A newer listing came meanwhile: its own fetch draws it.
    if (!got || get().generation !== generation) return;
    rows.push(...got.rows);
  }
  const names = new Set(rows.map((r) => r.name));
  const sel = new Set([...get().sel, ...pendingSelect].filter((n) => names.has(n)));
  const renaming = pendingRename && names.has(pendingRename) ? pendingRename : get().renaming;
  if (renaming === pendingRename) pendingRename = null;
  pendingSelect = pendingSelect.filter((n) => !names.has(n));
  const { lead } = get();
  useDesk.setState({ rows, sel, renaming, lead: lead && names.has(lead) ? lead : null });
  changed();
  await arrange();
}

/** Asks Rust where each icon goes on a grid of this size: an icon keeps its cell, a new one takes the first free cell. */
export async function arrange(): Promise<void> {
  if (!get().generation || !get().width) return;
  const cells = await api.desktop.place({ view: VIEW, ...grid() }).then(
    (d) => d.cells,
    () => null,
  );
  if (!cells) return;
  useDesk.setState({ cells });
  const back = pendingCell;
  pendingCell = null;
  if (back && cells[back.name]) await move([back.name], { col: back.cell[0], row: back.cell[1] });
}

/** Moves icons to a cell, and the ones after them down its column and on to the left. */
async function move(names: string[], at: { col: number; row: number }): Promise<void> {
  await api.desktop.move({ view: VIEW, names, ...at, ...grid() }).then((d) => useDesk.setState({ cells: d.cells }), say);
}

// ---------------------------------------------------------------------------------------------------------------------
// The selection

const rowOf = (name: string | null): Row | null => (name ? (get().rows.find((r) => r.name === name) ?? null) : null);
export const selectedRows = (): Row[] => get().rows.filter((r) => get().sel.has(r.name));
const selection = (): { view: string; selection: Selection } => ({ view: VIEW, selection: { names: [...get().sel] } });

export function select(names: string[], lead: string | null = names[names.length - 1] ?? null, anchor: string | null = lead): void {
  useDesk.setState({ sel: new Set(names), lead, anchor });
  changed();
}

/** The names from the anchor to `name`, in the listing's order. */
export function range(name: string): string[] {
  const { rows, anchor } = get();
  const a = rows.findIndex((r) => r.name === anchor);
  const b = rows.findIndex((r) => r.name === name);
  if (a < 0 || b < 0) return [name];
  return rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.name);
}

// The panes revision and the panes' events follow the desktop, for the features that read them.
const listeners: { [K in keyof PaneEvents]: Set<(detail: PaneEvents[K]) => void> } = { render: new Set(), selection: new Set(), pointerdown: new Set() };
function emit<K extends keyof PaneEvents>(event: K, detail: PaneEvents[K]): void {
  const set: Set<(detail: PaneEvents[K]) => void> = listeners[event];
  for (const handler of [...set]) handler(detail);
}
function changed(): void {
  bumpPanes();
  emit('selection', { pane: handle });
}

// ---------------------------------------------------------------------------------------------------------------------
// What the desktop does: a pane's actions, with a folder opened in a main window, as the desktop itself stays where it is.

function open(): void {
  const entries = selectedRows();
  const into = entries.map((e) => registry.vfs.browse(e)).filter((u): u is Uri => !!u);
  for (const uri of into) api.app.newWindow({ uri }).catch(say);
  const files = entries.filter((e) => !registry.vfs.browse(e));
  if (files.length) api.native.open({ uris: files.map((f) => f.uri) }).catch(say);
}

function updateCut(): void {
  api.clipboard.state().then(
    (d) => useDesk.setState({ cut: new Set(d.cut) }),
    () => undefined,
  );
}

const some = () => get().sel.size > 0;

const actions: Partial<Record<string, () => void | Promise<void>>> = {
  open,
  openInNewWindow: open,
  quickLook() {
    if (!some()) return;
    const selected = selectedRows();
    const index = Math.max(0, selected.findIndex((e) => e.name === get().lead));
    api.native.quicklook({ ...selection(), index }).catch(say);
  },
  duplicate() {
    const { uri, capabilities } = get();
    const uris = selectedRows().map((e) => e.uri);
    if (uri && uris.length && capabilities.write) api.fs.copy({ from: uris, to: uri, mode: 'copy' }).catch(say);
  },
  getInfo() {
    const { uri } = get();
    if (some()) api.native.getInfo(selection()).catch(say);
    else if (uri) api.native.getInfo({ uris: [uri] }).catch(say);
  },
  reveal() {
    const { uri } = get();
    if (some()) api.native.reveal(selection()).catch(say);
    else if (uri) api.native.reveal({ uris: [uri] }).catch(say);
  },
  copyPath() {
    const { uri } = get();
    const entries = selectedRows();
    const text = (entries.length ? entries.map((e) => pathOf(e.uri)) : uri ? [pathOf(uri)] : []).join('\n');
    if (text) api.clipboard.text({ text }).then(() => toast(t('pathCopied')), say);
  },
  rename() {
    if (get().sel.size === 1 && get().capabilities.rename) useDesk.setState({ renaming: [...get().sel][0] ?? null });
  },
  trash() {
    if (!some()) return;
    if (!get().capabilities.trash) return actions.delete?.();
    api.fs.trash(selection()).catch(say);
  },
  async delete() {
    const n = get().sel.size;
    if (n && (await confirm(t('deleteTitle', n), t('deleteText'), t('deleteNow')))) api.fs.delete(selection()).catch(say);
  },
  newFolder() {
    const { uri, capabilities } = get();
    if (!uri || !capabilities.write) return;
    api.fs.mkdir({ uri }).then((entry) => {
      pendingSelect = [entry.name];
      pendingRename = entry.name;
      select([]);
      // The listing may have come before the answer; a new one has the folder for sure.
      list();
    }, say);
  },
  selectAll: () => select(get().rows.map((r) => r.name), get().lead),
  selectNone: () => select([]),
  deselect: () => select([]),
  copy() {
    if (some()) api.clipboard.copy(selection()).then(updateCut, say);
  },
  cut() {
    if (some()) api.clipboard.cut(selection()).then(updateCut, say);
  },
  paste() {
    const { uri } = get();
    if (uri) api.clipboard.paste({ to: uri }).catch(say);
  },
  undo: () => void api.fs.undo().catch(say),
  toggleHidden() {
    const settings = useApp.getState().settings;
    if (settings) api.settings.set({ patch: { show_hidden: !settings.show_hidden } }).catch(say);
  },
  // The desktop stays where it is.
  enclosing: () => undefined,
  back: () => undefined,
  forward: () => undefined,
};

/** Runs an action on the desktop: its own, else the one a feature defined. */
export function runAction(name: string): boolean {
  const own = Object.hasOwn(actions, name) ? actions[name] : undefined;
  const feature = own ? null : registry.actions.get(name);
  const run = own ?? (feature ? () => feature(handle) : null);
  if (!run) return false;
  Promise.resolve(run()).catch(say);
  return true;
}

/** Gives a new name to the item being renamed; the icon stays in its cell. */
export function commitRename(name: string, typed: string): void {
  useDesk.setState({ renaming: null });
  const row = rowOf(name);
  const next = typed.trim();
  if (!row || !next || next === name) return;
  const cell = get().cells[name];
  api.fs.rename({ uri: row.uri, name: next }).then((entry) => {
    pendingSelect = [entry.name];
    if (cell) pendingCell = { name: entry.name, cell };
    list();
  }, say);
}

// ---------------------------------------------------------------------------------------------------------------------
// The context menu: the core's items and the features', which run here through `panes.action` (the keys feature runs
// the keys the same way); the items that only mean something in a pane of a main window are left out.

const NOT_HERE = new Set(['openTab', 'view', 'sort', 'groups']);

let shownMenu: { lookup: Map<string, MenuItemDef>; ctx: MenuCtx } | null = null;

/** The menu of the selection (`where` "item") or of the desktop itself ("empty"), as a native menu at the point. */
export function showMenu(where: 'item' | 'empty', x: number, y: number): void {
  const entries = where === 'item' ? selectedRows() : [];
  const ctx: MenuCtx = { pane: handle, tab, entries, entry: entries[0] ?? null, count: entries.length, where, x, y };
  const { tree, lookup } = menuTree(ctx, (key) => t(key), shortcutOf, registry.menu.list().filter((i) => !NOT_HERE.has(i.id)));
  if (!tree.length) return;
  shownMenu = { lookup, ctx };
  api.menu.show({ items: tree, x, y, uris: entries.map((e) => e.uri) }).catch(say);
}

// ---------------------------------------------------------------------------------------------------------------------
// Drops: icons of the desktop dropped on it move to where they are dropped; anything else is copied or moved in, then
// placed at the drop as it arrives. A drop on a folder icon goes into the folder.

let dropped: { col: number; row: number } | null = null;

/** The folder icon under a point, unless it is one of the items dropped. */
export function folderAt(x: number, y: number, uris: readonly Uri[] = []): Row | null {
  const el = document.elementFromPoint(x, y)?.closest('[data-desk-name]');
  const row = el instanceof HTMLElement ? rowOf(el.dataset.deskName ?? null) : null;
  return row?.isDir && !uris.some((u) => samePlace(u, row.uri)) ? row : null;
}

export function dropAt(drop: { x: number; y: number; uris: Uri[]; mode: 'copy' | 'move' | 'auto' }): void {
  const { uri, capabilities, box } = get();
  const folder = folderAt(drop.x, drop.y, drop.uris);
  if (folder) {
    api.fs.copy({ from: drop.uris, to: folder.uri, mode: drop.mode }).catch(say);
    return;
  }
  if (!uri) return;
  const at = cellAt(drop.x, drop.y, box, iconSize());
  const here = pathOf(uri);
  const paths = drop.uris.map((u) => pathOf(u));
  const names = paths.filter((p) => (p.slice(0, p.lastIndexOf('/')) || '/') === here).map((p) => p.slice(p.lastIndexOf('/') + 1));
  if (names.length === drop.uris.length) {
    void move(names, at);
    return;
  }
  if (!capabilities.write) return;
  dropped = at;
  api.fs.copy({ from: drop.uris, to: uri, mode: drop.mode }).catch(say);
}

// ---------------------------------------------------------------------------------------------------------------------
// The desktop as the one pane of its window

const tab: TabView = {
  id: VIEW,
  get uri() {
    return get().uri ?? '';
  },
  mode: 'icons',
  sort: null,
  title: null,
  color: null,
  get count() {
    return get().rows.length;
  },
  get generation() {
    return get().generation;
  },
  loading: false,
  get error() {
    return get().error;
  },
  get capabilities() {
    return get().capabilities;
  },
  get lead() {
    return get().rows.findIndex((r) => r.name === get().lead);
  },
  get anchor() {
    return get().rows.findIndex((r) => r.name === get().anchor);
  },
  requested: true,
  groups: [],
  free: null,
  filter: '',
  marks: null,
  branch: null,
  selCount: () => get().sel.size,
  isSel: (name) => get().sel.has(name),
  selection,
  selectedEntries: selectedRows,
  entry: (name) => rowOf(name),
  rowAt: (index) => get().rows[index] ?? null,
  selectWhenListed: (names) => void (pendingSelect = [...names]),
  renameWhenListed: (name) => void (pendingRename = name),
};

const newWindow = (uri: Uri | null | undefined) => void (uri && api.app.newWindow({ uri }).catch(say));

const handle: PaneHandle = {
  id: VIEW,
  index: 0,
  tab,
  tabs: [tab],
  active: 0,
  navigate: (uri) => newWindow(uri),
  newTab: (uri) => newWindow(uri),
  closeTab: () => undefined,
  activate: () => undefined,
  refresh: list,
  sortOf: () => useApp.getState().settings?.sort ?? { by: 'name', desc: false, foldersFirst: true, group: '' },
  sortBy: () => undefined,
  groupBy: () => undefined,
  browsable: (row) => (row ? registry.vfs.browse(row) : null),
  startRename: (name) => useDesk.setState({ renaming: name }),
  focusList: () => document.querySelector<HTMLElement>('[data-desk-list]')?.focus(),
};

const desktopPanes: PanesApi = {
  start: () => undefined,
  load: () => undefined,
  state: () => ({ layout: 'single', tree: null, focus: 0, panes: [{ active: 0, tabs: [{ uri: get().uri ?? '', mode: 'icons' }] }] }),
  saveSoon: () => undefined,
  MAX_PANES: 1,
  focused: () => handle,
  current: () => tab,
  all: () => [handle],
  findTab: (view) => (view === VIEW ? { pane: handle, tab } : null),
  focus: () => undefined,
  open: (uri) => newWindow(uri),
  setLayout: () => undefined,
  closePane: () => undefined,
  moveTab: () => undefined,
  action: (name) => runAction(name),
  get cut() {
    return get().cut;
  },
  on(event, handler) {
    listeners[event].add(handler);
    return () => void listeners[event].delete(handler);
  },
  emit,
  setDropHandler: () => undefined,
};

// ---------------------------------------------------------------------------------------------------------------------

let started = false;

/** Starts the desktop in its window: lists the folder and listens to the host. Once per window. */
export function startDesktop(): void {
  // The panes feature installed itself when its module loaded; only the desktop's window puts the desktop in its place.
  if (started || useApp.getState().role !== 'desktop') return;
  started = true;
  installPanes(desktopPanes);
  const { hello, places } = useApp.getState();
  useDesk.setState({ uri: hello?.uri ?? places?.desktop ?? null });

  on('view.changed', (d) => {
    if (d.view !== VIEW) return;
    useDesk.setState({ uri: d.uri, generation: d.generation, capabilities: d.capabilities, error: null });
    void fetchRows(d.generation, d.count);
    emit('render', { pane: handle });
  });
  on('view.error', (d) => {
    if (d.view !== VIEW) return;
    useDesk.setState({ error: d.error });
    say(d.error);
  });
  on('desktop.screens', () => void arrange());
  let showHidden = useApp.getState().settings?.show_hidden ?? false;
  on('settings.changed', (s) => {
    if (s.show_hidden === showHidden) return;
    showHidden = s.show_hidden;
    if (!get().generation) return;
    api.view.hidden({ view: VIEW, show: s.show_hidden }).then((d) => {
      useDesk.setState({ generation: d.generation });
      void fetchRows(d.generation, d.count);
    }, say);
  });
  on('menu.chosen', (d) => {
    const menu = shownMenu;
    shownMenu = null;
    menu?.lookup.get(d.id)?.run?.(menu.ctx);
  });
  on('menu.closed', () => void (shownMenu = null));
  on('drop.over', ({ x, y }) => useDesk.setState({ dropOn: folderAt(x, y)?.name ?? null }));
  on('drop.leave', () => useDesk.setState({ dropOn: null }));
  on('drop', (d) => {
    useDesk.setState({ dropOn: null });
    dropAt(d);
  });
  on('jobs.finished', (j) => {
    const at = dropped;
    const { uri } = get();
    if (!at || !j.ok || !j.data || typeof j.data !== 'object' || !('names' in j.data) || !('to' in j.data)) return;
    if (!samePlace(j.data.to, uri) || !j.data.names.length) return;
    dropped = null;
    void move(j.data.names, at);
  });
  updateCut();
  list();
}
