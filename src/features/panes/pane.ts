// A pane of the window: its tabs, and for the tab shown its listing, selection, cursor, rename and path field. The rows
// live in Rust (src-tauri/src/views.rs): a pane asks for those on screen by range and generation.
import { useApp } from '@/lib/app-state';
import { bumpPanes, type NavigateOptions, type NewTabOptions, type PaneHandle } from '@/lib/panes-api';
import { registry } from '@/lib/registry';
import { say } from '@/lib/ui';
import { samePlace, schemeOf } from '@/lib/uri';
import { api, messageOf, type ColumnKey, type Groups, type Row, type Sort, type SortBy, type Uri, type ViewMode, type ViewSort } from '@/services';
import { COLUMN_KEYS, defaultWidths, metrics, shownColumns, wantedColumns } from './columns';
import { Motion } from './motion';
import { childOf } from './places';
import { Tab } from './tab';

/** What a pane asks of the panes it lives among. */
export interface PaneHost {
  readonly MAX_PANES: number;
  all(): readonly Pane[];
  focused(): Pane | null;
  focus(pane: Pane): void;
  /** The pane's place or tabs changed: the sidebar, the toolbar and the saved layout follow. */
  changed(pane: Pane): void;
  selectionChanged(pane: Pane): void;
  rendered(pane: Pane): void;
  saveSoon(): void;
  closePane(pane: Pane): void;
  readonly cut: ReadonlySet<string>;
  pointerDown(pane: Pane, event: MouseEvent, index: number): void;
  action(name: string, pane: Pane): boolean;
  contextMenu(pane: Pane, x: number, y: number, index: number | null): void;
  stackMenu(pane: Pane, way: 'back' | 'forward', x: number, y: number): void;
  /** A feature asked for a selection or a rename once the tab's listing has the item. */
  pending(tab: Tab): void;
}

const SORT_KEYS: SortBy[] = ['name', 'size', 'mtime', 'ctime', 'kind', 'ext', 'where'];
const DEFAULT_SORT: Sort = { by: 'name', desc: false, foldersFirst: true, group: '' };
const settings = () => useApp.getState().settings;

// The chord of a key as the keymap writes it, by the key's place on the keyboard (05-core-keys.js).
const PUNCT: Record<string, string> = { Period: '.', Comma: ',', BracketLeft: '[', BracketRight: ']', Slash: '/', Backslash: '\\', Minus: '-', Equal: '=', Semicolon: ';', Quote: "'", Backquote: '`' };
export function chordOf(e: KeyboardEvent): string {
  let key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : (PUNCT[e.code] ?? e.key);
  if (key === ' ') key = 'Space';
  return `${e.metaKey ? 'Cmd+' : ''}${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${key}`;
}

interface Snapshot {
  uri: Uri;
  at: Map<string, [number, number]>;
  known: Set<string> | null;
  until: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

let paneSeq = 0;

export class Pane implements PaneHandle {
  readonly id = `p${++paneSeq}`;
  index = 0;
  tabs: Tab[] = [];
  active = 0;
  cols: Record<ColumnKey, number> = defaultWidths();
  /** The row whose name is a field, the tab whose name is one, and whether the path is one. */
  renaming: { index: number; name: string; draft?: string } | null = null;
  renamingTab: number | null = null;
  editingAddress = false;
  filterOpen = false;
  /** Items per line and the height of a line, as the view draws them. */
  per = 1;
  rowH = 24;
  marquee: Box | null = null;
  el: HTMLElement | null = null;
  listEl: HTMLElement | null = null;
  sizerEl: HTMLElement | null = null;
  tabsEl: HTMLElement | null = null;
  stripEl: HTMLElement | null = null;
  boxEl: HTMLElement | null = null;
  /** The elements of the items on screen by index, for their motion. */
  readonly itemEls = new Map<number, HTMLElement>();
  private readonly host: PaneHost;
  private fetching = false;
  private was: Snapshot | null = null;
  private typed = '';
  private findTimer: ReturnType<typeof setTimeout> | undefined;
  /** What was typed in the name field when the listing changed under it; the field comes back with it. */
  private renameDraft: string | undefined;
  private version = 0;
  private readonly subs = new Set<() => void>();

  constructor(host: PaneHost) {
    this.host = host;
  }

  get tab(): Tab {
    return this.tabs[this.active] as Tab;
  }

  // What the components of the pane follow: a number that goes up when the pane draws again.
  readonly subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };
  readonly getVersion = (): number => this.version;
  /** Draws the pane again, and nothing else. */
  touch(): void {
    this.version++;
    for (const fn of [...this.subs]) fn();
  }
  /** Everything that depends on the tab, and what features draw of it. */
  renderAll(): void {
    this.touch();
    this.host.rendered(this);
  }

  makeTab(uri: Uri, mode?: ViewMode | null): Tab {
    const tab = new Tab(useApp.getState().windowId, uri, mode || settings()?.view_mode || 'list');
    // The pane that shows the tab then, which is not this one once the tab was moved.
    tab.onPending = (t) => this.host.pending(t);
    return tab;
  }

  browsable(row: Row | null | undefined): Uri | null {
    if (!row) return null;
    return row.isDir ? row.uri : registry.vfs.browse(row);
  }

  childOf(uri: Uri): string[] | null {
    return childOf(this.tab.uri, uri);
  }

  // Places --------------------------------------------------------------------------------------------------------

  navigate(uri: Uri | null, { history = true, select = null }: NavigateOptions = {}): void {
    const tab = this.tab;
    if (!uri || !tab) return;
    if (history && tab.uri && !samePlace(tab.uri, uri)) {
      tab.back.push(tab.uri);
      tab.forward = [];
    }
    // Search results keep the order of their matches, the best first, until a column is chosen; a folder never does.
    if (schemeOf(uri) === 'search' && schemeOf(tab.uri) !== 'search') tab.sort = { by: 'none', desc: false, foldersFirst: false, group: '' };
    else if (schemeOf(uri) !== 'search' && tab.sort?.by === 'none') tab.sort = null;
    tab.uri = uri;
    tab.reset();
    tab.pendingSelect = select;
    tab.scrollTop = 0;
    this.renaming = null;
    this.filterOpen = false;
    if (this.listEl) this.listEl.scrollTop = 0;
    this.list();
    this.renderAll();
    this.host.changed(this);
  }

  refresh(): void {
    this.list();
  }

  private list(): void {
    const tab = this.tab;
    const showHidden = !!settings()?.show_hidden;
    tab.requested = true;
    tab.showHidden = showHidden;
    api.fs.list({ view: tab.id, uri: tab.uri, sort: this.sortOf(tab), showHidden }).catch((error: unknown) => {
      tab.loading = false;
      tab.error = messageOf(error);
      if (this.tab === tab) this.renderAll();
    });
  }

  /** A tab listed while the hidden files were shown otherwise is shown as Settings says now. */
  syncHidden(tab: Tab, show = !!settings()?.show_hidden): void {
    if (!tab.generation || tab.showHidden === show) return;
    tab.showHidden = show;
    api.view
      .hidden({ view: tab.id, show })
      .then((d) => this.tab === tab && this.regenerate(d.generation, d.count, d.groups))
      .catch(() => undefined);
  }

  /** Goes to a place typed or picked in the path bar; the history keeps it as typed once it opens. */
  goTyped(uri: Uri): void {
    this.tab.typed = uri;
    this.navigate(uri);
  }

  // Sorting and groups --------------------------------------------------------------------------------------------

  sortOf(tab: { sort: ViewSort | null }): ViewSort {
    return tab.sort ?? settings()?.sort ?? DEFAULT_SORT;
  }

  sortBy(column: string): void {
    const tab = this.tab;
    const by: SortBy = SORT_KEYS.find((k) => k === column) ?? 'name';
    const now = this.sortOf(tab);
    const sort: Sort = { ...now, by, desc: now.by === by ? !now.desc : by === 'mtime' || by === 'size' };
    tab.sort = sort;
    api.view
      .sort({ view: tab.id, sort })
      .then((d) => this.tab === tab && this.regenerate(d.generation, undefined, d.groups))
      .catch(say);
    void api.settings.set({ patch: { sort } }).catch(say);
    this.touch();
    bumpPanes();
    this.host.saveSoon();
  }

  /** Shows the list in groups ("kind", "date", "size") or in none, as Finder's "Use Groups"; the next folders take it too. */
  groupBy(group: '' | 'kind' | 'date' | 'size'): void {
    const tab = this.tab;
    const sort: ViewSort = { ...this.sortOf(tab), group };
    tab.sort = sort;
    api.view
      .sort({ view: tab.id, sort })
      .then((d) => this.tab === tab && this.regenerate(d.generation, undefined, d.groups))
      .catch(say);
    void api.settings.set({ patch: { sort: { group } } }).catch(say);
    this.host.saveSoon();
  }

  /** The headers of groups are lines of their own in a list. */
  grouped(): Groups | null {
    const tab = this.tab;
    return tab?.mode === 'list' && tab.groups.length ? tab.groups : null;
  }
  /** The line row `i` is drawn on. */
  lineOf(i: number): number {
    let headers = 0;
    for (const [start] of this.grouped() ?? []) {
      if (start > i) break;
      headers++;
    }
    return i + headers;
  }
  /** What is drawn on a line: the index of a row, or -1 - g for the header of group g. */
  atLine(line: number): number {
    const groups = this.grouped() ?? [];
    for (let g = 0; g < groups.length; g++) {
      const header = (groups[g]?.[0] ?? 0) + g;
      if (line === header) return -1 - g;
      if (line < header) return line - g;
    }
    return line - groups.length;
  }

  /** A new generation of the same listing (sorted or filtered again): the rows come back in the new order. */
  regenerate(generation: number, count?: number, groups?: Groups): void {
    const tab = this.tab;
    this.holdRename();
    this.snapshot(false);
    tab.generation = generation;
    if (count != null) tab.count = count;
    if (groups) tab.groups = groups;
    tab.rows = new Map();
    tab.byName = new Map();
    this.touch();
    bumpPanes();
  }

  setFilter(text: string): void {
    const tab = this.tab;
    // Search results are searched again with Enter: filtered as typed, they would lose the matches found without accents.
    if (!tab?.generation || schemeOf(tab.uri) === 'search') return;
    tab.filter = text;
    api.view
      .filter({ view: tab.id, text })
      .then((d) => this.tab === tab && this.regenerate(d.generation, d.count, d.groups))
      .catch(say);
    this.touch();
    bumpPanes();
  }

  // Motion --------------------------------------------------------------------------------------------------------

  /** Where each item on screen is, by name, so that the next drawing moves them from there (and brings new ones in). */
  snapshot(arrivals: boolean): void {
    const tab = this.tab;
    const at = new Map<string, [number, number]>();
    for (const [i, el] of this.itemEls) {
      const e = tab.rows.get(i);
      if (e) at.set(e.name, [el.offsetLeft, el.offsetTop]);
    }
    // shortcut: rows loaded after the window below (a scroll within it) may come in as new, kept short for that.
    this.was = at.size ? { uri: tab.uri, at, known: arrivals ? new Set(tab.byName.keys()) : null, until: performance.now() + 1200 } : null;
  }

  /** The item `name` drawn in `el` moves from where the last listing drew it, or comes in if that one did not have it. */
  motion(el: HTMLElement, name: string): void {
    const was = this.was;
    if (!was) return;
    if (performance.now() > was.until || !samePlace(was.uri, this.tab.uri)) {
      this.was = null;
      return;
    }
    const from = was.at.get(name);
    if (from) {
      was.at.delete(name);
      const dx = from[0] - el.offsetLeft;
      const dy = from[1] - el.offsetTop;
      if (dx || dy) Motion.slide(el, dx, dy);
    } else if (was.known && !was.known.has(name)) {
      was.known.add(name);
      Motion.arrive(el);
    }
  }

  /** Plays the items `names` in sight out; `done` resolves when they are gone and `back()` shows them again. */
  leave(names: string[]): { done: Promise<unknown>; back: () => void } {
    const going = new Set(names);
    const played: Animation[] = [];
    let n = 0;
    for (const [i, el] of this.itemEls) {
      const e = this.tab.rows.get(i);
      if (!e || !going.has(e.name)) continue;
      const a = Motion.leave(el, n++);
      if (a) played.push(a);
    }
    return { done: Promise.all(played.map((a) => a.finished.catch(() => undefined))), back: () => played.forEach((a) => a.cancel()) };
  }

  /** The selected items on screen flash, as they are copied or cut. */
  flashSelected(): void {
    for (const [i, el] of this.itemEls) {
      const e = this.tab.rows.get(i);
      if (e && this.tab.isSel(e.name)) Motion.flash(el);
    }
  }

  // Columns -------------------------------------------------------------------------------------------------------

  wantedColumns(): ColumnKey[] {
    return wantedColumns(settings(), schemeOf(this.tab?.uri) === 'search');
  }
  shownColumns(width = this.listEl?.clientWidth ?? 0): Array<ColumnKey | 'name'> {
    return shownColumns(this.tab?.mode ?? 'list', width, this.wantedColumns(), this.cols);
  }
  /** Takes saved widths, those of known columns only, kept between 50 and 400 points. */
  takeWidths(cols: Partial<Record<string, number>> | undefined): void {
    for (const key of COLUMN_KEYS) {
      const w = Number(cols?.[key]);
      if (w > 0) this.cols[key] = Math.min(400, Math.max(50, w));
    }
  }

  // Rows ----------------------------------------------------------------------------------------------------------

  ensure(first: number, last: number): void {
    const tab = this.tab;
    if (!tab || this.fetching || !tab.generation) return;
    let start = -1;
    for (let i = Math.max(0, first); i < Math.min(last, tab.count); i++) {
      if (!tab.rows.has(i)) {
        start = i;
        break;
      }
    }
    if (start < 0) return;
    const from = Math.max(0, start - 30);
    const count = Math.min(500, last - from + 60);
    const generation = tab.generation;
    this.fetching = true;
    let again = false;
    api.view
      .rows({ view: tab.id, start: from, count, generation })
      .then((d) => {
        if (this.tab !== tab || d.generation !== tab.generation) return;
        tab.take(from, d.rows);
        this.afterRows(tab);
      })
      .catch((error: unknown) => {
        // "stale": the tab has a newer generation on its way; the rows are asked for again once it is drawn.
        again = messageOf(error) === 'stale';
      })
      .finally(() => {
        this.fetching = false;
        if (again) requestAnimationFrame(() => this.touch());
        else this.touch();
      });
  }

  /** Rows came: a selection, a rename or a move of the cursor that waited for its item takes place. */
  afterRows(tab: Tab): void {
    if (tab.pendingSelect) {
      const names = tab.pendingSelect.filter((n) => tab.byName.has(n));
      if (names.length) {
        tab.pendingSelect = null;
        tab.clearSel();
        for (const n of names) tab.sel.add(n);
        tab.anchor = tab.lead = tab.byName.get(names[0] ?? '') ?? -1;
        this.scrollTo(tab.lead);
        this.host.selectionChanged(this);
      }
    }
    if (tab.pendingRename && tab.byName.has(tab.pendingRename)) {
      const name = tab.pendingRename;
      tab.pendingRename = null;
      tab.clearSel();
      tab.sel.add(name);
      tab.anchor = tab.lead = tab.byName.get(name) ?? -1;
      this.scrollTo(tab.lead);
      this.host.selectionChanged(this);
      requestAnimationFrame(() => this.startRename(name));
    }
    const move = tab.pendingMove;
    if (move && tab.rows.has(move.index)) {
      tab.pendingMove = null;
      this.goTo(move.index, move.extend);
    }
  }

  /** A selection or rename that waits for an item not loaded yet: its index is asked for, then the rows around it. */
  seek(names: string[]): void {
    const tab = this.tab;
    const name = names[0];
    if (name == null) return;
    api.view
      .indexOf({ view: tab.id, name })
      .then((d) => {
        if (d.index == null || this.tab !== tab) return;
        this.scrollTo(d.index);
        this.ensure(d.index, d.index + 1);
        this.touch();
      })
      .catch(() => undefined);
  }

  /** The index of the loaded row an event happened on, or null. */
  indexAt(target: EventTarget | null): number | null {
    const el = target instanceof Element ? target.closest('[data-index]') : null;
    if (!el || !this.listEl?.contains(el)) return null;
    const i = Number(el.getAttribute('data-index'));
    return i < this.tab.count && this.tab.rows.has(i) ? i : null;
  }

  // Selection -----------------------------------------------------------------------------------------------------

  /**
   * A press in the list: select one, turn one over with Command (Ctrl in the Windows keys), a range with Shift; on nothing
   * the selection goes. A press beside the items (on nothing, or in a row away from its icon and name, as in Finder)
   * draws a frame that selects what it covers.
   */
  pointer(e: MouseEvent): void {
    if (e.button !== 0 && e.button !== 2) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('input')) return;
    this.focusList();
    const tab = this.tab;
    const i = this.indexAt(target);
    const onItem = i != null && (tab.mode === 'icons' || tab.mode === 'gallery' || !!target?.closest('[data-hit]'));
    const onScrollbar = target === this.listEl && !!this.listEl && e.offsetX >= this.listEl.clientWidth;
    const toggle = e.metaKey || (e.ctrlKey && settings()?.keymap === 'windows');
    if (e.button === 0 && (!e.ctrlKey || toggle) && !onItem && !onScrollbar) {
      if (i == null && !toggle && !e.shiftKey && tab.selCount()) {
        tab.clearSel();
        this.host.selectionChanged(this);
      }
      this.marqueeFrom(e, i, toggle);
      return;
    }
    if (i == null) return;
    const name = tab.rows.get(i)?.name ?? '';
    if (e.button === 2) {
      if (!tab.isSel(name)) this.selectOnly(i);
      return;
    }
    if (e.shiftKey && tab.anchor >= 0) void this.selectRange(tab.anchor, i);
    else if (toggle) this.toggleAt(i);
    // A click on the only selected item keeps it; on one of several it waits for the drag that may follow.
    else if (!tab.isSel(name) || tab.selCount() === 1) this.selectOnly(i);
    this.host.pointerDown(this, e, i);
  }

  /** The frame drawn from a press beside the items; near the top or bottom edge the list scrolls on. */
  private marqueeFrom(down: MouseEvent, row: number | null, toggle: boolean): void {
    const tab = this.tab;
    const start = this.contentPoint(down);
    const before = { all: tab.all, sel: new Set(tab.sel), except: new Set(tab.except) };
    const adds = toggle || down.shiftKey;
    let at: MouseEvent = down;
    let drawing = false;
    let scrolling = 0;
    const update = () => {
      const p = this.contentPoint(at);
      const r = { left: Math.min(start.x, p.x), top: Math.min(start.y, p.y), right: Math.max(start.x, p.x), bottom: Math.max(start.y, p.y) };
      this.marquee = { left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top };
      const hit = this.indicesIn(r);
      tab.all = before.all && adds;
      tab.sel = adds ? new Set(before.sel) : new Set();
      tab.except = tab.all ? new Set(before.except) : new Set();
      for (const i of hit) {
        const name = tab.rows.get(i)?.name;
        if (name == null) continue;
        const want = toggle ? !before.sel.has(name) && !(before.all && !before.except.has(name)) : true;
        if (want !== tab.isSel(name)) tab.toggle(name);
      }
      const first = hit[0];
      const last = hit[hit.length - 1];
      if (first != null && last != null) {
        tab.anchor = first;
        tab.lead = last;
        this.ensure(first, last + 1);
      }
      this.touch();
    };
    const edge = () => {
      const list = this.listEl;
      if (!list) return;
      const r = list.getBoundingClientRect();
      const dy = at.clientY < r.top + 12 ? at.clientY - r.top - 12 : at.clientY > r.bottom - 12 ? at.clientY - r.bottom + 12 : 0;
      if (dy && drawing) {
        list.scrollTop += Math.max(-28, Math.min(28, dy));
        update();
      }
      scrolling = dy ? requestAnimationFrame(edge) : 0;
    };
    const move = (m: MouseEvent) => {
      if (!drawing && Math.hypot(m.clientX - down.clientX, m.clientY - down.clientY) < 4) return;
      drawing = true;
      at = m;
      update();
      if (!scrolling) scrolling = requestAnimationFrame(edge);
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      cancelAnimationFrame(scrolling);
      if (drawing) {
        this.marquee = null;
        this.host.selectionChanged(this);
        return;
      }
      // A click in a row away from its name: the row, as a click on its name would choose it.
      if (row == null || !tab.rows.has(row)) return;
      if (down.shiftKey && tab.anchor >= 0) void this.selectRange(tab.anchor, row);
      else if (toggle) this.toggleAt(row);
      else this.selectOnly(row);
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  }

  /** A point of the window in the coordinates of the rows, which scroll with the list. */
  private contentPoint(e: MouseEvent): { x: number; y: number } {
    const r = this.sizerEl?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }

  /** The indices of the items a frame (in row coordinates) covers: whole rows in a list, the cells of icons. */
  private indicesIn(r: { left: number; top: number; right: number; bottom: number }): number[] {
    const tab = this.tab;
    const out: number[] = [];
    if (tab.mode !== 'icons') {
      for (let line = Math.max(0, Math.floor(r.top / this.rowH)); line <= Math.floor(r.bottom / this.rowH); line++) {
        const i = this.grouped() ? this.atLine(line) : line;
        if (i >= 0 && i < tab.count) out.push(i);
      }
      return out;
    }
    const { icon, cellW, cellH } = metrics(settings());
    const side = icon + 40;
    const covers = (left: number, top: number) => left < r.right && left + side > r.left && top < r.bottom && top + side > r.top;
    const per = this.per || 1;
    const offset = Math.max(0, ((this.listEl?.clientWidth ?? 0) - 16 - per * cellW) / 2);
    const lastLine = Math.floor((r.bottom - 6) / cellH);
    for (let line = Math.max(0, Math.floor((r.top - 6 - side) / cellH)); line <= lastLine; line++) {
      for (let c = 0; c < per; c++) {
        const i = line * per + c;
        if (i >= tab.count) break;
        if (covers(c * cellW + offset, line * cellH + 6)) out.push(i);
      }
    }
    return out;
  }

  selectOnly(i: number): void {
    const tab = this.tab;
    const e = tab.rows.get(i);
    tab.clearSel();
    if (e) tab.sel.add(e.name);
    tab.anchor = tab.lead = i;
    this.host.selectionChanged(this);
  }

  private toggleAt(i: number): void {
    const tab = this.tab;
    const name = tab.rows.get(i)?.name;
    if (name == null) return;
    tab.toggle(name);
    tab.anchor = tab.lead = i;
    this.host.selectionChanged(this);
  }

  /** Selects from `a` to `b`, asking for the rows in between that are not loaded. */
  async selectRange(a: number, b: number): Promise<void> {
    const tab = this.tab;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    for (let start = lo; start <= hi; start += 500) {
      let missing = false;
      for (let k = start; k < Math.min(start + 500, hi + 1); k++) {
        if (!tab.rows.has(k)) {
          missing = true;
          break;
        }
      }
      if (!missing) continue;
      const d = await api.view.rows({ view: tab.id, start, count: 500, generation: tab.generation }).catch(() => null);
      if (!d || d.generation !== tab.generation) return;
      tab.take(start, d.rows);
    }
    tab.all = false;
    tab.except.clear();
    tab.sel.clear();
    for (let i = lo; i <= hi; i++) {
      const e = tab.rows.get(i);
      if (e) tab.sel.add(e.name);
    }
    tab.lead = b;
    this.host.selectionChanged(this);
  }

  selectAll(): void {
    const tab = this.tab;
    tab.all = true;
    tab.except.clear();
    tab.sel.clear();
    this.host.selectionChanged(this);
  }

  clearSelection(): void {
    this.tab.clearSel();
    this.host.selectionChanged(this);
  }

  /** The selection was changed from outside (an action): the pane and what follows it draw again. */
  selectionChanged(): void {
    this.host.selectionChanged(this);
  }

  select(index: number, how: 'only' | 'toggle' | 'range' = 'only'): void {
    if (!this.tab.rows.has(index)) return;
    if (how === 'toggle') this.toggleAt(index);
    else if (how === 'range' && this.tab.anchor >= 0) void this.selectRange(this.tab.anchor, index);
    else this.selectOnly(index);
  }

  private goTo(i: number, extend: boolean): void {
    if (extend && this.tab.anchor >= 0) void this.selectRange(this.tab.anchor, i);
    else this.selectOnly(i);
  }

  move(delta: number, extend = false): void {
    const tab = this.tab;
    if (!tab?.count) return;
    let i = delta === Infinity ? tab.count - 1 : delta === -Infinity ? 0 : tab.lead < 0 ? (delta > 0 ? 0 : tab.count - 1) : tab.lead + delta;
    i = Math.max(0, Math.min(tab.count - 1, i));
    this.scrollTo(i);
    if (tab.rows.has(i)) this.goTo(i, extend);
    else {
      tab.pendingMove = { index: i, extend };
      this.ensure(i, i + 1);
      this.touch();
    }
  }

  /** Scrolls row `i` into sight. */
  scrollTo(i: number): void {
    const list = this.listEl;
    if (!list || i < 0) return;
    const line = this.grouped() ? this.lineOf(i) : Math.floor(i / (this.per || 1));
    const top = line * this.rowH;
    const bottom = top + this.rowH;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }

  /** Typing a name finds it, as in Finder; what is typed within a second adds up. */
  find(text: string): void {
    const tab = this.tab;
    clearTimeout(this.findTimer);
    this.typed += text;
    this.findTimer = setTimeout(() => (this.typed = ''), 1000);
    api.view
      .find({ view: tab.id, prefix: this.typed })
      .then((d) => {
        if (d.index == null || this.tab !== tab) return;
        this.scrollTo(d.index);
        if (tab.rows.has(d.index)) this.selectOnly(d.index);
        else {
          tab.pendingMove = { index: d.index, extend: false };
          this.ensure(d.index, d.index + 1);
          this.touch();
        }
      })
      .catch(() => undefined);
  }

  /** The keys of the list: the arrows, Home, End and the pages, and typing a name. True when the key was taken. */
  keydown(e: KeyboardEvent): boolean {
    const mode = this.tab.mode;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    // The column view goes out to the folder on the left and into the folder selected on the right.
    if (mode === 'columns' && plain && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      this.host.action(e.key === 'ArrowLeft' ? 'columnOut' : 'columnIn', this);
      return true;
    }
    // A gallery's strip runs sideways: every arrow moves by one.
    if (mode === 'gallery' && plain && e.key.startsWith('Arrow')) {
      this.move(e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1, e.shiftKey);
      return true;
    }
    const icons = mode === 'icons';
    const per = icons ? this.per || 1 : 1;
    const page = Math.max(1, Math.floor((this.listEl?.clientHeight ?? 0) / this.rowH) - 1) * per;
    const steps: Record<string, number> = { ArrowDown: per, ArrowUp: -per, ArrowRight: icons ? 1 : 0, ArrowLeft: icons ? -1 : 0, PageDown: page, PageUp: -page, Home: -Infinity, End: Infinity };
    const step = steps[e.key];
    if (step !== undefined && plain) {
      if (step) this.move(step, e.shiftKey);
      return true;
    }
    // Typing a name finds it, unless a feature gave the key an action of its own.
    if (e.key.length === 1 && plain && e.key !== ' ' && !e.isComposing) {
      const keymap = settings()?.keymap === 'windows' ? 'windows' : 'mac';
      if (registry.keys.extra(keymap)[chordOf(e)]) return false;
      this.find(e.key.toLowerCase());
      return true;
    }
    return false;
  }

  // Renaming in place ---------------------------------------------------------------------------------------------

  /** The name becomes a field with the part before the extension selected. */
  startRename(name: string): void {
    const tab = this.tab;
    const i = tab.byName.get(name);
    if (i == null || !tab.capabilities.rename) return;
    this.scrollTo(i);
    this.renaming = { index: i, name, draft: this.renameDraft };
    this.renameDraft = undefined;
    this.touch();
  }

  /** The listing changes under the name field: it comes back, with what was typed, once the item is listed again. */
  holdRename(): void {
    if (!this.renaming) return;
    this.tab.pendingRename = this.renaming.name;
    this.renameDraft = this.renaming.draft;
    this.renaming = null;
  }

  /** The field is done: `value` is the new name, or null to leave the name as it was. */
  finishRename(value: string | null, refocus: boolean): void {
    const r = this.renaming;
    if (!r) return;
    this.renaming = null;
    const tab = this.tab;
    const entry = tab.rows.get(r.index);
    if (refocus || document.activeElement === document.body) this.focusList();
    const name = value?.trim();
    if (!name || name === r.name || !entry) {
      this.touch();
      return;
    }
    api.fs.rename({ uri: entry.uri, name }).then(
      () => {
        tab.pendingSelect = [name];
        if (this.tab === tab) this.refresh();
      },
      (error: unknown) => {
        say(error);
        this.touch();
      },
    );
  }

  editAddress(): void {
    this.editingAddress = true;
    this.touch();
  }

  /** Opens the filter field of the path bar. */
  openFilter(): void {
    this.filterOpen = true;
    this.touch();
  }

  // Tabs ----------------------------------------------------------------------------------------------------------

  /** A new tab where the current one is, or at `uri` with `select` selected once listed; one in the background lists when first shown. */
  newTab(uri?: Uri | null, select: string[] | null = null, { background = false, at = this.tabs.length }: NewTabOptions = {}): void {
    const where = uri || this.tab?.uri || useApp.getState().places?.home || 'file:///';
    const tab = this.makeTab(where, this.tab?.mode);
    this.tabs.splice(at, 0, tab);
    if (background) {
      if (at <= this.active) this.active++;
      this.renderAll();
      this.host.saveSoon();
      return;
    }
    this.active = at;
    tab.uri = '';
    this.navigate(where, { history: false, select });
  }

  activate(i: number): void {
    if (i === this.active || !this.tabs[i]) return;
    this.renaming = null;
    this.renamingTab = null;
    this.active = i;
    this.show();
  }

  /** Shows the tab that is active: one restored with the window lists the first time it is shown. */
  show(): void {
    const tab = this.tab;
    if (!tab.requested) {
      const uri = tab.uri;
      tab.uri = '';
      this.navigate(uri, { history: false });
      return;
    }
    this.syncHidden(tab);
    this.renderAll();
    this.host.changed(this);
  }

  /** Closes tab `i`; the last tab of a pane closes the pane, when the window has another. */
  closeTab(i: number): void {
    if (this.tabs.length < 2) {
      if (this.host.all().length > 1) this.host.closePane(this);
      return;
    }
    const [tab] = this.tabs.splice(i, 1);
    if (tab) api.view.close({ view: tab.id }).catch(() => undefined);
    if (this.active >= this.tabs.length) this.active = this.tabs.length - 1;
    else if (i < this.active) this.active--;
    this.renamingTab = null;
    this.show();
  }

  /** Opens tab `i` in a window of its own; the tab leaves this one unless it is the last. */
  tabToWindow(i: number): void {
    const tab = this.tabs[i];
    if (!tab) return;
    api.app.newWindow({ uri: tab.uri }).catch(say);
    if (this.tabs.length > 1 || this.host.all().length > 1) this.closeTab(i);
  }

  renameTab(i: number): void {
    if (!this.tabs[i]) return;
    this.renamingTab = i;
    this.touch();
  }

  /** The tab's name field is done: an empty name, or the folder's own, gives the tab its folder's name back. */
  finishRenameTab(value: string | null): void {
    const i = this.renamingTab;
    if (i == null) return;
    this.renamingTab = null;
    const tab = this.tabs[i];
    if (tab && value != null) {
      const name = value.trim();
      tab.title = name && !(tab.uri && name === registry.places.nameOf(tab.uri)) ? name.slice(0, 80) : null;
      this.host.saveSoon();
    }
    this.renderAll();
    this.focusList();
  }

  focusList(): void {
    this.listEl?.focus({ preventScroll: true });
  }

  contextMenu(x: number, y: number, index: number | null): void {
    this.host.contextMenu(this, x, y, index);
  }

  stackMenu(way: 'back' | 'forward', x: number, y: number): void {
    this.host.stackMenu(this, way, x, y);
  }
}
