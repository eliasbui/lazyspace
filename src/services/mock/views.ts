import type { Capabilities, Entry, Groups, Row, Selection, TagRef, ViewSort } from '../protocol';
import type { Virtual } from './fs';
import { fold, natural, tr } from './util';

// The listing of each tab, kept in the mock as in the host: the page asks for rows by range and a listing has a
// generation. A folder made on demand (a Virtual) is never stored: rows are made by index.

/** The most rows one `view.rows` gives. */
export const MAX_ROWS = 500;

const KINDS: Record<string, [vi: string, en: string]> = {
  png: ['Ảnh PNG', 'PNG image'],
  jpg: ['Ảnh JPEG', 'JPEG image'],
  heic: ['Ảnh HEIC', 'HEIC image'],
  pdf: ['Tài liệu PDF', 'PDF Document'],
  txt: ['Văn bản thuần', 'Plain Text Document'],
  md: ['Tài liệu Markdown', 'Markdown document'],
  docx: ['Tài liệu Word', 'Microsoft Word document'],
  xlsx: ['Bảng tính Excel', 'Microsoft Excel spreadsheet'],
  key: ['Bản trình chiếu Keynote', 'Keynote Presentation'],
  zip: ['Tệp nén ZIP', 'ZIP archive'],
  dmg: ['Ảnh đĩa', 'Disk Image'],
  mp3: ['Âm thanh MP3', 'MP3 audio'],
  mp4: ['Phim MPEG-4', 'MPEG-4 movie'],
  mov: ['Phim QuickTime', 'QuickTime movie'],
  csv: ['Tệp CSV', 'CSV document'],
  ts: ['Mã TypeScript', 'TypeScript source'],
  tsx: ['Mã TypeScript', 'TypeScript source'],
  json: ['Tệp JSON', 'JSON document'],
};

/** The kind of an item in words, as Finder's Kind column says it. */
export function kindName(entry: Entry): string {
  if (entry.kind === 'dir') return tr('Thư mục', 'Folder');
  if (entry.kind === 'app') return tr('Ứng dụng', 'Application');
  if (entry.kind === 'package') return tr('Gói', 'Package');
  if (entry.kind === 'link') return tr('Liên kết', 'Symbolic link');
  const known = KINDS[entry.ext];
  if (known) return tr(known[0], known[1]);
  return entry.ext ? `${entry.ext.toUpperCase()} ${tr('tài liệu', 'document')}` : tr('Tài liệu', 'Document');
}

export interface Listing {
  /** The items, when the folder is small. */
  entries?: Entry[];
  /** The folder made on demand, when it is not. */
  virtual?: Virtual;
}

export class MockView {
  generation = 0;
  request = 0;
  loading = true;
  filter = '';
  readonly sizes = new Map<string, number>();
  count = 0;
  groups: Groups = [];
  private entries: Entry[] = [];
  private labels: string[] = [];
  private virtual?: Virtual;
  /** The indices of the stored items that are shown; for a Virtual, the ones that match the filter (null: all). */
  private shown: number[] | null = null;
  private shownFolders = 0;

  constructor(
    public uri: string,
    public sort: ViewSort,
    public showHidden: boolean,
    public capabilities: Capabilities,
  ) {}

  load(listing: Listing): void {
    this.virtual = listing.virtual;
    this.entries = listing.entries ?? [];
    this.loading = false;
    this.arrange();
  }

  /** Sorts the stored items and works out what is shown. */
  arrange(): void {
    if (!this.virtual) this.sortStored();
    this.reshow();
  }

  private sizeOf(e: Entry): number {
    return e.isDir || e.kind === 'app' || e.kind === 'package' ? (this.sizes.get(e.name) ?? 0) : e.size;
  }

  private sortStored(): void {
    const { sort } = this;
    const grouped = sort.group !== '';
    if (sort.by === 'none' && !grouped) {
      this.labels = [];
      return;
    }
    const today = new Date().setHours(0, 0, 0, 0) / 1000;
    const group = new Map(this.entries.map((e) => [e.name, groupOf(e, sort.group, kindName(e), this.sizeOf(e), today)]));
    const where = (e: Entry): string => e.uri.slice(0, e.uri.lastIndexOf('/')).toLowerCase();
    const order = (a: Entry, b: Entry): number => {
      const ga = group.get(a.name);
      const gb = group.get(b.name);
      if (grouped && ga && gb) {
        const byGroup = ga.rank - gb.rank || (ga.tie < gb.tie ? -1 : ga.tie > gb.tie ? 1 : 0);
        if (byGroup !== 0 || sort.by === 'none') return byGroup;
      }
      if (sort.foldersFirst && a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let by = 0;
      switch (sort.by) {
        case 'size':
          by = this.sizeOf(a) - this.sizeOf(b);
          break;
        case 'mtime':
          by = a.mtime - b.mtime;
          break;
        case 'ctime':
          by = a.ctime - b.ctime;
          break;
        case 'kind':
          by = natural(kindName(a), kindName(b));
          break;
        case 'ext':
          by = a.ext < b.ext ? -1 : a.ext > b.ext ? 1 : 0;
          break;
        case 'where': {
          const [x, y] = [where(a), where(b)];
          by = x < y ? -1 : x > y ? 1 : 0;
          break;
        }
        default:
      }
      if (sort.desc) by = -by;
      if (by !== 0) return by;
      const names = natural(a.name, b.name);
      return sort.desc && sort.by === 'name' ? -names : names;
    };
    this.entries = [...this.entries].sort(order);
    this.labels = grouped ? this.entries.map((e) => group.get(e.name)?.label ?? '') : [];
  }

  private reshow(): void {
    const needle = fold(this.filter);
    if (this.virtual) {
      const { virtual } = this;
      // shortcut: a filter of a huge folder scans every name once; it keeps only the matching indices.
      if (needle === '') this.shown = null;
      else {
        const found: number[] = [];
        for (let i = 0; i < virtual.count; i++) if (fold(virtual.at(i).name).includes(needle)) found.push(i);
        this.shown = found;
      }
      this.count = this.shown ? this.shown.length : virtual.count;
      this.shownFolders = this.shown ? this.shown.filter((x) => x < virtual.folders).length : virtual.folders;
      this.groups = [];
      return;
    }
    const shown: number[] = [];
    this.entries.forEach((e, i) => {
      if ((this.showHidden || !e.hidden) && (needle === '' || fold(e.name).includes(needle))) shown.push(i);
    });
    this.shown = shown;
    this.count = shown.length;
    this.groups = [];
    shown.forEach((index, at) => {
      const label = this.labels[index];
      if (label === undefined) return;
      if (this.groups.length === 0 || this.groups[this.groups.length - 1]?.[1] !== label) this.groups.push([at, label]);
    });
  }

  /** Whether the shown order of a Virtual is the stored one turned round. */
  private get reversed(): boolean {
    const { by, desc } = this.sort;
    // shortcut: a Virtual is in name order and its times fall with the index; other columns keep the name order.
    if (by === 'name') return desc;
    if (by === 'mtime' || by === 'ctime') return !desc;
    return false;
  }

  /** The entry at position `i` of what is shown. */
  at(i: number): Entry | undefined {
    if (i < 0 || i >= this.count) return undefined;
    if (!this.virtual) {
      const index = this.shown?.[i];
      return index === undefined ? undefined : this.entries[index];
    }
    const { shown, virtual } = this;
    const m = this.count;
    const folders = this.shownFolders;
    let k = i;
    if (this.reversed) k = this.sort.foldersFirst && folders > 0 && folders < m ? (i < folders ? folders - 1 - i : m - 1 + folders - i) : m - 1 - i;
    return virtual.at(shown ? (shown[k] ?? 0) : k);
  }

  names(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.count; i++) out.push(this.at(i)?.name ?? '');
    return out;
  }

  all(): Entry[] {
    const out: Entry[] = [];
    for (let i = 0; i < this.count; i++) {
      const e = this.at(i);
      if (e) out.push(e);
    }
    return out;
  }

  /** The stored items, before the filter (for folder sizes). */
  stored(): Entry[] {
    return this.entries;
  }
}

interface Group {
  rank: number;
  tie: string;
  label: string;
}

function groupOf(e: Entry, group: string, kind: string, size: number, today: number): Group {
  const folders = { rank: 0, tie: '', label: tr('Thư mục', 'Folders') };
  if (group === 'kind') return e.isDir ? folders : { rank: 1, tie: kind.toLowerCase(), label: kind };
  if (group === 'size') {
    if (e.isDir) return folders;
    const [rank, vi, en] =
      size >= 1e9 ? [1, 'Rất lớn (trên 1 GB)', 'Huge (over 1 GB)'] : size >= 1e8 ? [2, 'Lớn (100 MB đến 1 GB)', 'Large (100 MB to 1 GB)'] : size >= 1e6 ? [3, 'Vừa (1 MB đến 100 MB)', 'Medium (1 MB to 100 MB)'] : size > 0 ? [4, 'Nhỏ (dưới 1 MB)', 'Small (under 1 MB)'] : [5, 'Trống', 'Empty'];
    return { rank: Number(rank), tie: '', label: tr(String(vi), String(en)) };
  }
  if (group === 'date') {
    const t = e.mtime;
    const [rank, vi, en] =
      t >= today ? [0, 'Hôm nay', 'Today'] : t >= today - 86_400 ? [1, 'Hôm qua', 'Yesterday'] : t >= today - 7 * 86_400 ? [2, '7 ngày trước', 'Previous 7 Days'] : t >= today - 30 * 86_400 ? [3, '30 ngày trước', 'Previous 30 Days'] : t >= today - 365 * 86_400 ? [4, 'Trong năm qua', 'Earlier This Year'] : [5, 'Cũ hơn', 'Older'];
    return { rank: Number(rank), tie: '', label: tr(String(vi), String(en)) };
  }
  return { rank: 0, tie: '', label: '' };
}

export interface RowContext {
  tagsOf(uri: string): TagRef[] | undefined;
}

export class Views {
  private readonly byId = new Map<string, MockView>();
  private next = 0;

  constructor(private readonly context: RowContext) {}

  /** A tab starts listing `uri`; the listing arrives with `finish`. Returns the number of the request. */
  begin(id: string, uri: string, sort: ViewSort, showHidden: boolean, capabilities: Capabilities): number {
    const request = ++this.next;
    let view = this.byId.get(id);
    if (!view) {
      view = new MockView(uri, sort, showHidden, capabilities);
      this.byId.set(id, view);
    }
    if (view.uri !== uri) {
      view.filter = '';
      view.sizes.clear();
    }
    Object.assign(view, { uri, sort, showHidden, capabilities, request, loading: true });
    return request;
  }

  /** The listing of `request` came: sorted and shown unless the tab has asked for another since. */
  finish(id: string, request: number, listing: Listing): number | undefined {
    const generation = ++this.next;
    const view = this.byId.get(id);
    if (!view || view.request !== request) return undefined;
    view.generation = generation;
    view.load(listing);
    return generation;
  }

  get(id: string): MockView {
    const view = this.byId.get(id);
    if (!view) throw new Error(tr('Tab này không còn', 'That tab is gone'));
    return view;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  rows(id: string, start: number, count: number, generation: number): { rows: Row[]; generation: number; start: number } {
    const view = this.get(id);
    if (generation !== view.generation) throw new Error('stale');
    const end = Math.min(start + Math.min(count, MAX_ROWS), view.count);
    const rows: Row[] = [];
    for (let i = Math.min(start, end); i < end; i++) {
      const entry = view.at(i);
      if (entry) rows.push(this.row(view, entry));
    }
    return { rows, generation: view.generation, start };
  }

  private row(view: MockView, entry: Entry): Row {
    const row: Row = { ...entry, type: kindName(entry) };
    const tags = this.context.tagsOf(entry.uri);
    if (tags?.length) row.tags = tags;
    const size = view.sizes.get(entry.name);
    if (size !== undefined) row.dirSize = size;
    return row;
  }

  private change(id: string, edit: (view: MockView) => void): number {
    const generation = ++this.next;
    const view = this.get(id);
    edit(view);
    view.generation = generation;
    view.arrange();
    return generation;
  }

  sort(id: string, sort: ViewSort): number {
    return this.change(id, (v) => {
      v.sort = sort;
    });
  }

  setFilter(id: string, text: string): number {
    return this.change(id, (v) => {
      v.filter = text;
    });
  }

  setHidden(id: string, show: boolean): number {
    return this.change(id, (v) => {
      v.showHidden = show;
    });
  }

  find(id: string, prefix: string): number | null {
    const view = this.get(id);
    const needle = fold(prefix);
    for (let i = 0; i < view.count; i++) if (fold(view.at(i)?.name ?? '').startsWith(needle)) return i;
    return null;
  }

  indexOf(id: string, name: string): number | null {
    const view = this.get(id);
    for (let i = 0; i < view.count; i++) if (view.at(i)?.name === name) return i;
    return null;
  }

  /** The URIs a selection stands for, in the order shown. */
  resolve(id: string, selection: Selection): string[] {
    const view = this.get(id);
    const pick = (name: string): boolean => ('names' in selection ? selection.names.includes(name) : !selection.except.includes(name));
    return view.all().filter((e) => pick(e.name)).map((e) => e.uri);
  }

  close(id: string): void {
    this.byId.delete(id);
  }

  /** The tabs showing `uri`, to list again when it changes. */
  showing(uri: string): string[] {
    return [...this.byId].filter(([, v]) => v.uri === uri).map(([id]) => id);
  }

  entries(): IterableIterator<[string, MockView]> {
    return this.byId.entries();
  }
}
