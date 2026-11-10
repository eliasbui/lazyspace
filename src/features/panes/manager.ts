// The panes of the window (the old page's `Panes`): their layout tree, the focused one, what was cut, the events of the
// panes, the actions, and what the host tells about the listings. This is what `installPanes` puts behind `panes`.
import { t } from '@/i18n';
import { useApp, setSetting } from '@/lib/app-state';
import { bumpPanes, type DropTarget, type NavigateOptions, type PaneEvents, type PaneHandle, type PanesApi, type TabView } from '@/lib/panes-api';
import { menuTree, registry, type MenuCtx } from '@/lib/registry';
import { sidebar } from '@/lib/sidebar-api';
import { say, toast } from '@/lib/ui';
import { isLocal, samePlace } from '@/lib/uri';
import { api, on, type JobData, type PanesState, type TabState, type Uri, type ViewMode } from '@/services';
import { makeActions, type Action, type ActionHost } from './actions';
import { isTabColor } from './columns';
import { LAYOUTS, PRESETS, isPreset, leaf, leafOf, leaves, parentOf, replace, split, tidy, treeFrom, treeState, type Node, type Preset } from './layout';
import { choose, shortcutOf, showMenu } from './menu/native';
import { Pane, type PaneHost } from './pane';
import { placeLabel } from './places';
import type { Tab } from './tab';

type DropHandler = (drop: { x: number; y: number; uris: Uri[]; mode: 'copy' | 'move' | 'auto' }, target: DropTarget) => boolean;
type Handlers = { [K in keyof PaneEvents]: Set<(detail: PaneEvents[K]) => void> };
export type Side = 'left' | 'right' | 'top' | 'bottom';

const home = (): Uri => useApp.getState().places?.home || 'file:///';

/** The names and the folder of the items a job made, to select them there. */
function madeIn(data: JobData): { names: string[]; to: Uri } | null {
  if (!data || Array.isArray(data) || !('names' in data) || !data.to || !data.names.length) return null;
  return { names: data.names, to: data.to };
}

class Manager implements PanesApi, PaneHost, ActionHost {
  readonly MAX_PANES = 6;
  panes: Pane[] = [];
  tree: Node<Pane> | null = null;
  /** A preset, or "custom" once the splits were moved. */
  layout = 'single';
  readonly cut = new Set<string>();
  dropHandler: DropHandler | null = null;
  private focusedPane: Pane | null = null;
  private readonly handlers: Handlers = { render: new Set(), selection: new Set(), pointerdown: new Set() };
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private sizesOn = false;
  private readonly actions: Record<string, Action> = makeActions(this);

  // Building ------------------------------------------------------------------------------------------------------

  /** A pane with the tabs `tabs`, not yet in the layout. */
  private makePane(tabs: TabState[]): Pane {
    const pane = new Pane(this);
    for (const saved of tabs) {
      const tab = pane.makeTab(saved.uri, saved.mode);
      tab.sort = saved.sort ?? null;
      tab.title = typeof saved.title === 'string' && saved.title ? saved.title.slice(0, 80) : null;
      tab.color = isTabColor(saved.color) ? saved.color : null;
      pane.tabs.push(tab);
    }
    return pane;
  }

  /** Lays the panes out as the tree says; the panes in its order are `panes`, the order Tab goes through. */
  private renderTree(): void {
    if (!this.tree) return;
    this.tree = tidy(this.tree);
    this.panes = leaves(this.tree);
    this.panes.forEach((p, i) => (p.index = i));
    bumpPanes();
  }

  private pane(handle: PaneHandle | null | undefined): Pane | null {
    return this.panes.find((p) => p === handle) ?? null;
  }

  start(saved: PanesState | null, uri?: Uri | null): void {
    const layouts = Array.isArray(saved?.panes) && saved.panes.length ? saved.panes.slice(0, this.MAX_PANES) : [{ active: 0, tabs: [{ uri: home() }] }];
    const list = layouts.map((p) => {
      const tabs = (Array.isArray(p.tabs) ? p.tabs : []).filter((tab) => typeof tab?.uri === 'string').slice(0, 30);
      const pane = this.makePane(tabs.length ? tabs : [{ uri: home() }]);
      pane.active = Math.min(Math.max(0, Number(p.active) | 0), pane.tabs.length - 1);
      pane.takeWidths(p.cols);
      return pane;
    });
    this.tree = treeFrom(saved?.tree, list);
    if (this.tree) this.layout = typeof saved?.layout === 'string' ? saved.layout : 'custom';
    else if (!isPreset(saved?.layout) && list.length > 1) {
      // Panes whose tree was lost stand side by side.
      this.tree = split('row', list.map(leaf));
      this.layout = 'custom';
    } else {
      // A preset layout (what windows kept before the tree), with panes at home for those that were not saved.
      const layout: Preset = isPreset(saved?.layout) ? saved.layout : 'single';
      while (list.length < LAYOUTS[layout]) list.push(this.makePane([{ uri: home() }]));
      list.splice(LAYOUTS[layout]);
      this.tree = PRESETS[layout](list);
      this.layout = layout;
    }
    this.renderTree();
    const first = this.panes[0];
    if (uri && first) first.tab.uri = uri;
    this.sizesOn = !!useApp.getState().settings?.folder_sizes;
    const focus = this.panes[Math.min(Math.max(0, Number(saved?.focus) | 0), this.panes.length - 1)];
    if (focus) this.focus(focus);
    // Every other tab lists when it is first shown.
    for (const pane of this.panes) this.showPane(pane);
  }

  /** Shows a pane that has just been made at the place of its tab. */
  private showPane(pane: Pane): void {
    const uri = pane.tab.uri;
    pane.tab.uri = '';
    pane.navigate(uri, { history: false });
  }

  load(saved: PanesState): void {
    for (const pane of this.panes) this.closeViews(pane);
    this.panes = [];
    this.tree = null;
    this.focusedPane = null;
    this.start(saved);
    this.saveSoon();
  }

  private closeViews(pane: Pane): void {
    for (const tab of pane.tabs) api.view.close({ view: tab.id }).catch(() => undefined);
  }

  state(): PanesState {
    return {
      layout: this.layout,
      tree: this.tree ? treeState(this.tree, (p) => this.panes.indexOf(p)) : null,
      focus: this.focusedPane ? this.panes.indexOf(this.focusedPane) : 0,
      sidebarWidth: sidebar.width(),
      panes: this.panes.map((p) => ({
        active: p.active,
        cols: { ...p.cols },
        tabs: p.tabs.map((tab) => ({ uri: tab.uri, mode: tab.mode, sort: tab.sort, title: tab.title, color: tab.color })),
      })),
    };
  }

  saveSoon(): void {
    if (useApp.getState().role !== 'main') return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void api.panes.state({ state: this.state() }).catch(() => undefined), 500);
  }

  // Layout --------------------------------------------------------------------------------------------------------

  /** Changes to a preset: the panes there are keep their place in order, a new one opens where the focused one is. */
  setLayout(layout: string): void {
    if (!isPreset(layout)) return;
    const n = LAYOUTS[layout];
    const list = [...this.panes];
    const made: Pane[] = [];
    while (list.length < n) {
      const pane = this.makePane([{ uri: this.focusedPane?.tab.uri || home() }]);
      list.push(pane);
      made.push(pane);
    }
    for (const pane of list.splice(n)) {
      this.closeViews(pane);
      if (this.focusedPane === pane) this.focusedPane = null;
    }
    this.tree = PRESETS[layout](list);
    this.layout = layout;
    this.renderTree();
    for (const pane of made) this.showPane(pane);
    const last = this.panes[this.panes.length - 1];
    if (!this.focusedPane && last) this.focus(last);
    this.saveSoon();
  }

  /** Splits `target` at `side` with a new pane that takes tab `i` of `from`; a pane left without tabs closes. */
  splitWith(from: Pane, i: number, target: Pane, side: Side): Pane | null {
    const tab = from.tabs[i];
    if (!tab || !this.tree) return null;
    if (this.panes.length >= this.MAX_PANES) {
      toast(t('tooManyPanes', this.MAX_PANES));
      return null;
    }
    // The only tab of a pane split beside itself would leave the pane empty where it is: nothing changes.
    if (from === target && from.tabs.length < 2) return null;
    const pane = this.makePane([]);
    const dir = side === 'left' || side === 'right' ? 'row' : 'col';
    const first = side === 'left' || side === 'top';
    const old = leafOf(this.tree, target);
    if (!old) return null;
    const found = parentOf(this.tree, old);
    if (found && found[0].dir === dir) {
      const [parent, at] = found;
      const half = (parent.sizes[at] ?? 0) / 2;
      parent.sizes[at] = half;
      parent.kids.splice(first ? at : at + 1, 0, leaf(pane));
      parent.sizes.splice(first ? at : at + 1, 0, half);
    } else this.tree = replace(this.tree, old, split(dir, first ? [leaf(pane), old] : [old, leaf(pane)]));
    this.layout = 'custom';
    from.tabs.splice(i, 1);
    pane.tabs.push(tab);
    pane.active = -1;
    this.renderTree();
    if (!from.tabs.length) this.closePane(from);
    else {
      const left = i < from.active ? from.active - 1 : Math.min(from.active, from.tabs.length - 1);
      from.active = -1;
      from.activate(left);
    }
    pane.activate(0);
    this.focus(pane);
    this.saveSoon();
    return pane;
  }

  /** Splits `pane` at `side` with a new pane at the same place, its own tab staying where it is. */
  splitNew(pane: Pane, side: Side): void {
    if (this.panes.length >= this.MAX_PANES) return toast(t('tooManyPanes', this.MAX_PANES));
    pane.newTab(pane.tab.uri, null, { background: true });
    this.splitWith(pane, pane.tabs.length - 1, pane, side);
  }

  /** Closes a pane and its tabs; the pane beside it takes its room. */
  closePane(handle: PaneHandle): void {
    const pane = this.pane(handle);
    if (this.panes.length < 2 || !pane || !this.tree) return;
    const old = leafOf(this.tree, pane);
    const found = old && parentOf(this.tree, old);
    if (!found) return;
    this.closeViews(pane);
    const [parent, at] = found;
    const room = parent.sizes[at] ?? 0;
    parent.kids.splice(at, 1);
    parent.sizes.splice(at, 1);
    parent.sizes[Math.max(0, at - 1)] = (parent.sizes[Math.max(0, at - 1)] ?? 0) + room;
    this.layout = 'custom';
    const beside = parent.kids[Math.max(0, at - 1)];
    const near = beside ? leaves(beside)[0] : this.panes.find((p) => p !== pane);
    this.renderTree();
    if (this.focusedPane === pane && near) {
      this.focusedPane = null;
      this.focus(near);
      near.focusList();
    }
    this.saveSoon();
  }

  /** A line between panes was dragged (the layout is the user's own now), or double-clicked to share the room evenly. */
  resized(moved: boolean): void {
    if (moved) this.layout = 'custom';
    bumpPanes();
    this.saveSoon();
  }

  /** Moves tab `i` of `from` to `index` among the tabs of `to`, where it shows; a pane whose last tab goes closes. */
  moveTab(fromHandle: PaneHandle, i: number, toHandle: PaneHandle, index: number): void {
    const from = this.pane(fromHandle);
    const to = this.pane(toHandle);
    const tab = from?.tabs[i];
    if (!from || !to || !tab) return;
    if (from === to) {
      from.tabs.splice(i, 1);
      from.tabs.splice(index, 0, tab);
      from.active = index;
      from.renderAll();
      this.saveSoon();
      return;
    }
    from.tabs.splice(i, 1);
    if (!from.tabs.length) this.closePane(from);
    else {
      const left = i < from.active ? from.active - 1 : Math.min(from.active, from.tabs.length - 1);
      from.active = -1;
      from.activate(left);
    }
    to.tabs.splice(index, 0, tab);
    to.active = -1;
    to.activate(index);
    this.focus(to);
    this.saveSoon();
  }

  /** Moves the focus to the next pane (or the previous one), as Tab does in QSpace. */
  cycle(step: number): void {
    if (this.panes.length < 2 || !this.focusedPane) return;
    const next = this.panes[(this.panes.indexOf(this.focusedPane) + step + this.panes.length) % this.panes.length];
    if (!next) return;
    this.focus(next);
    next.focusList();
  }

  setMode(pane: Pane, mode: ViewMode): void {
    pane.tab.mode = mode;
    pane.tab.scrollTop = 0;
    if (pane.listEl) pane.listEl.scrollTop = 0;
    pane.renderAll();
    this.saveSoon();
    void setSetting({ view_mode: mode });
  }

  // Focus and finding -----------------------------------------------------------------------------------------------

  focused(): Pane | null {
    return this.focusedPane;
  }
  current(): TabView | null {
    return this.focusedPane?.tab ?? null;
  }
  all(): readonly Pane[] {
    return this.panes;
  }
  findTab(view: string): { pane: Pane; tab: Tab } | null {
    for (const pane of this.panes) {
      const tab = pane.tabs.find((x) => x.id === view);
      if (tab) return { pane, tab };
    }
    return null;
  }

  focus(handle: PaneHandle): void {
    const pane = this.pane(handle);
    if (!pane || this.focusedPane === pane) return;
    this.focusedPane = pane;
    sidebar.mark();
    this.emit('selection', { pane });
    bumpPanes();
  }

  open(uri: Uri, options?: NavigateOptions): void {
    this.focusedPane?.navigate(uri, options);
    this.focusedPane?.focusList();
  }

  // What the panes tell -----------------------------------------------------------------------------------------------

  changed(pane: Pane): void {
    if (pane === this.focusedPane) sidebar.mark();
    this.saveSoon();
    bumpPanes();
  }
  selectionChanged(pane: Pane): void {
    pane.touch();
    this.emit('selection', { pane });
    bumpPanes();
  }
  rendered(pane: Pane): void {
    this.emit('render', { pane });
    bumpPanes();
  }
  pointerDown(pane: Pane, event: MouseEvent, index: number): void {
    this.emit('pointerdown', { pane, event, index });
  }
  pending(tab: Tab): void {
    const found = this.findTab(tab.id);
    if (!found || found.pane.tab !== tab || !tab.generation) return;
    found.pane.afterRows(tab);
    const names = tab.pendingSelect ?? (tab.pendingRename ? [tab.pendingRename] : null);
    if (names) found.pane.seek(names);
  }

  on<K extends keyof PaneEvents>(event: K, handler: (detail: PaneEvents[K]) => void): () => void {
    const set: Set<(detail: PaneEvents[K]) => void> = this.handlers[event];
    set.add(handler);
    return () => set.delete(handler);
  }
  emit<K extends keyof PaneEvents>(event: K, detail: PaneEvents[K]): void {
    const set: Set<(detail: PaneEvents[K]) => void> = this.handlers[event];
    for (const fn of [...set]) fn(detail);
  }

  setDropHandler(handler: DropHandler | null): void {
    this.dropHandler = handler;
  }

  // Actions and menus -----------------------------------------------------------------------------------------------

  action(name: string, handle?: PaneHandle | null): boolean {
    const pane = this.pane(handle) ?? this.focusedPane;
    const run = this.actions[name] ?? registry.actions.get(name);
    if (!run) return false;
    if (pane) void Promise.resolve(run(pane)).catch(say);
    return true;
  }

  /** On an item, the menu of the selection (the item is selected first); on nothing, the menu of the folder. */
  contextMenu(pane: Pane, x: number, y: number, index: number | null): void {
    const tab = pane.tab;
    if (index == null && tab.selCount()) pane.clearSelection();
    const entries = tab.selectedEntries();
    const ctx: MenuCtx = { pane, tab, entries, entry: entries[0] ?? null, count: index == null ? 0 : tab.selCount(), where: index == null ? 'empty' : 'item', x, y };
    const { tree, lookup } = menuTree(ctx, t, shortcutOf);
    void showMenu(tree, x, y, entries.map((e) => e.uri)).then((id) => {
      const item = id == null ? undefined : lookup.get(id);
      item?.run?.(ctx);
    });
  }

  /** The places back (or forward) of the pane's tab, nearest first; the one chosen is gone to as if by that many steps. */
  stackMenu(pane: Pane, way: 'back' | 'forward', x: number, y: number): void {
    const tab = pane.tab;
    const stack = way === 'back' ? tab.back : tab.forward;
    if (!stack.length) return;
    const nearest = [...stack].reverse();
    void choose(
      nearest.map((uri, k) => ({ id: String(k), label: placeLabel(uri), icon: 'folder' })),
      x,
      y,
    ).then((id) => {
      if (id == null || pane.tab !== tab) return;
      const at = stack.length - 1 - Number(id);
      const to = stack[at];
      if (!to) return;
      const passed = stack.splice(at).slice(1).reverse();
      (way === 'back' ? tab.forward : tab.back).push(tab.uri, ...passed);
      pane.navigate(to, { history: false, select: way === 'back' ? pane.childOf(to) : null });
    });
  }

  /** The items cut are drawn faded until they are pasted or the clipboard changes. */
  updateCut(): void {
    api.clipboard
      .state()
      .then((d) => {
        this.cut.clear();
        for (const uri of d.cut) this.cut.add(uri);
        for (const pane of this.panes) pane.touch();
        bumpPanes();
      })
      .catch(() => undefined);
  }

  // What the host tells -----------------------------------------------------------------------------------------------

  listen(): void {
    on('view.changed', (d) => {
      const found = this.findTab(d.view);
      if (!found) return;
      const { pane, tab } = found;
      // A place opened in a main window goes into the path history, once, as typed when it came from the path bar.
      if (useApp.getState().role === 'main' && !samePlace(tab.recorded, d.uri)) {
        tab.recorded = d.uri;
        api.history.add({ uri: d.uri, typed: samePlace(tab.typed, d.uri) }).catch(() => undefined);
        tab.typed = null;
      }
      // The same folder listed again (it changed): its items move rather than jump.
      if (pane.tab === tab && tab.generation && samePlace(tab.uri, d.uri)) {
        pane.holdRename();
        pane.snapshot(true);
      }
      tab.uri = d.uri;
      tab.generation = d.generation;
      tab.count = d.count;
      tab.capabilities = d.capabilities;
      tab.groups = d.groups ?? [];
      tab.free = d.free;
      tab.loading = false;
      tab.error = null;
      tab.rows = new Map();
      tab.byName = new Map();
      if (pane.tab !== tab) return;
      pane.renderAll();
      if (tab.pendingSelect) pane.seek(tab.pendingSelect);
      if (tab.pendingRename) pane.seek([tab.pendingRename]);
      if (pane === this.focusedPane) sidebar.mark();
    });
    on('view.error', (d) => {
      const found = this.findTab(d.view);
      if (!found) return;
      found.tab.loading = false;
      found.tab.error = d.error;
      if (found.pane.tab === found.tab) found.pane.renderAll();
    });
    on('view.sizes', (d) => {
      const found = this.findTab(d.view);
      if (!found || d.generation !== found.tab.generation) return;
      for (const [name, size] of Object.entries(d.sizes)) {
        const row = found.tab.entry(name);
        if (row) row.dirSize = size;
      }
      if (found.pane.tab === found.tab) found.pane.touch();
    });
    on('settings.changed', (s) => {
      for (const pane of this.panes) {
        if (pane.tab.generation) {
          pane.syncHidden(pane.tab, s.show_hidden);
          if (s.folder_sizes !== this.sizesOn) api.fs.sizes({ view: pane.tab.id, on: s.folder_sizes }).catch(() => undefined);
        }
        pane.touch();
      }
      this.sizesOn = s.folder_sizes;
      bumpPanes();
    });
    on('jobs.finished', (d) => {
      const made = d.ok ? madeIn(d.data) : null;
      if (made) {
        const pane = this.panes.find((p) => samePlace(p.tab.uri, made.to));
        if (pane) pane.tab.pendingSelect = made.names;
      }
      // The watcher brings local changes in; a place it does not follow is brought up to date here.
      for (const pane of this.panes) if (pane.tab.generation && !isLocal(pane.tab.uri)) pane.refresh();
      this.updateCut();
    });
  }
}

export const manager = new Manager();
