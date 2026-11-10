// A tab of a pane: where it is, its history, and the part of its listing the page has (the rows live in Rust; the tab
// keeps those it was given, by index, with the selection, the cursor and the scroll).
import type { TabView } from '@/lib/panes-api';
import type { Capabilities, Groups, Row, Selection, TabColor, Uri, ViewMode, ViewSort } from '@/services';

export const NO_CAPABILITIES: Capabilities = { write: false, rename: false, trash: false, watch: false, sizes: false, localPath: false };

let seq = 1;

export class Tab implements TabView {
  readonly id: string;
  uri: Uri;
  back: Uri[] = [];
  forward: Uri[] = [];
  mode: ViewMode;
  sort: ViewSort | null = null;
  /** A name the user gave the tab in place of its folder's, and the colour it is marked with. */
  title: string | null = null;
  color: TabColor | null = null;

  generation = 0;
  count = 0;
  rows = new Map<number, Row>();
  byName = new Map<string, number>();
  sel = new Set<string>();
  /** Everything is selected but `except`, without the rows of a huge folder being loaded. */
  all = false;
  except = new Set<string>();
  anchor = -1;
  lead = -1;
  loading = true;
  error: string | null = null;
  capabilities: Capabilities = NO_CAPABILITIES;
  groups: Groups = [];
  free: number | null = null;
  filter = '';
  pendingSelect: string[] | null = null;
  pendingRename: string | null = null;
  /** A move of the cursor that waits for its row. */
  pendingMove: { index: number; extend: boolean } | null = null;
  requested = false;
  showHidden = false;
  /** Where the list was scrolled, so the tab shows where it was when it is shown again. */
  scrollTop = 0;
  marks: Record<string, string> | null = null;
  branch: string | null = null;
  /** The place last put in the path history, and the place typed in the path bar that is on its way. */
  recorded: Uri | null = null;
  typed: Uri | null = null;
  /** Called when a feature asks for a selection or a rename once the listing has the item. */
  onPending: ((tab: Tab) => void) | null = null;

  constructor(windowId: number, uri: Uri, mode: ViewMode) {
    this.id = `w${windowId}t${seq++}`;
    this.uri = uri;
    this.mode = mode;
  }

  /** A new listing is on its way: what the page knew of the old one goes. */
  reset(): void {
    this.generation = 0;
    this.count = 0;
    this.rows = new Map();
    this.byName = new Map();
    this.clearSel();
    this.anchor = -1;
    this.lead = -1;
    this.loading = true;
    this.error = null;
    this.capabilities = NO_CAPABILITIES;
    this.groups = [];
    this.free = null;
    this.filter = '';
    this.pendingSelect = null;
    this.pendingRename = null;
    this.pendingMove = null;
  }

  /** Rows of the generation now, from `start`. */
  take(start: number, rows: Row[]): void {
    rows.forEach((row, k) => {
      this.rows.set(start + k, row);
      this.byName.set(row.name, start + k);
    });
  }

  isSel(name: string): boolean {
    return this.all ? !this.except.has(name) : this.sel.has(name);
  }
  selCount(): number {
    return this.all ? this.count - this.except.size : this.sel.size;
  }
  clearSel(): void {
    this.sel.clear();
    this.all = false;
    this.except.clear();
  }
  /** Turns the item over: in the selection when it was not, out when it was. */
  toggle(name: string): void {
    const set = this.all ? this.except : this.sel;
    if (set.has(name)) set.delete(name);
    else set.add(name);
  }
  selection(): { view: string; selection: Selection } {
    return { view: this.id, selection: this.all ? { all: true, except: [...this.except] } : { names: [...this.sel] } };
  }
  selectedEntries(): Row[] {
    return [...this.rows.values()].filter((e) => this.isSel(e.name));
  }
  entry(name: string): Row | null {
    const index = this.byName.get(name);
    return index == null ? null : (this.rows.get(index) ?? null);
  }
  rowAt(index: number): Row | null {
    return this.rows.get(index) ?? null;
  }
  selectWhenListed(names: string[]): void {
    this.pendingSelect = names;
    this.onPending?.(this);
  }
  renameWhenListed(name: string): void {
    this.pendingRename = name;
    this.onPending?.(this);
  }
}
