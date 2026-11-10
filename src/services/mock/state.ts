import type { Capabilities, Connection, CloudAccount, Entry, HistoryPlace, MenuLayout, PanesState, Settings, TagRef, UserAction, ViewSort, Volume, Workspace } from '../protocol';
import { seedFiles } from './data';
import { builtinTemplates, clouds, defaultSettings, initialConnections, openInTools, userActions, VOLUMES } from './fixtures';
import { MockFs, baseName, fileUri, joinPath, makeUri, parentOf, parseUri, type ParsedUri } from './fs';
import { Jobs, type Emit } from './jobs';
import { type Listing, Views } from './views';
import { hashOf, sleep, tr } from './util';

/** A step the user can take back. */
export interface UndoStep {
  title: string;
  run(): void;
}

const LOCAL: Capabilities = { write: true, rename: true, trash: true, watch: true, sizes: true, localPath: true };
const REMOTE: Capabilities = { write: true, rename: true, trash: false, watch: false, sizes: false, localPath: false };
const READ_ONLY: Capabilities = { write: false, rename: false, trash: false, watch: false, sizes: false, localPath: false };

const WORDS = ['alpha', 'backup', 'config', 'data', 'export', 'images', 'logs', 'notes', 'reports', 'shared', 'tmp', 'video'];
const REMOTE_SCHEMES = ['sftp', 'ftp', 'ftps', 's3', 'oss', 'device', 'archive'];

/** Everything the mock keeps between requests. */
export class MockState {
  readonly now = Math.floor(Date.now() / 1000);
  readonly fs = new MockFs();
  readonly views = new Views({ tagsOf: (uri) => this.tagsOf(uri) });
  readonly jobs: Jobs;
  settings: Settings = defaultSettings();
  windowRole: 'main' | 'desktop' | 'shelf' = 'main';
  folder: string | null = null;
  updateAvailable = false;
  clipboard: { uris: string[]; cut: boolean } = { uris: [], cut: false };
  readonly undo: UndoStep[] = [];
  history: HistoryPlace[] = [];
  volumes: Volume[] = VOLUMES.map((v) => ({ ...v }));
  stash: string[] = [];
  connections: Connection[] = initialConnections();
  readonly live = new Set<string>();
  rclone: { installed: boolean; remotes: string[]; accounts: Record<string, CloudAccount> } = {
    installed: true,
    remotes: ['gdrive'],
    accounts: { gdrive: { backend: 'drive', kind: 'drive', account: 'demo@example.com' } },
  };
  clouds = clouds();
  actions: UserAction[] = userActions();
  templates = builtinTemplates();
  userTemplates: Array<{ id: string; name: string; ext: string; text: string }> = [];
  tools = openInTools();
  workspaces: Workspace[] = [];
  menuLayout: MenuLayout = { order: [], hidden: [], icons: {}, separators: [] };
  layout: PanesState | null = null;
  fileViewer = false;
  nextWindow = 2;
  systemTheme: 'light' | 'dark' = 'light';
  desktopCells = new Map<string, [number, number]>();
  index = { ready: true, building: false };
  listeners = new Set<(event: string, data: unknown) => void>();

  constructor() {
    seedFiles(this.fs, this.now);
    this.fs.ensure('/Users/demo/Library/Mobile Documents/com~apple~CloudDocs', this.now);
    this.fs.ensure('/Users/demo/Library/CloudStorage/Dropbox', this.now);
    this.jobs = new Jobs(this.emit);
    this.history = ['/Users/demo/Documents/Work', '/Users/demo/Downloads', '/Users/demo/Pictures', '/Users/demo/Projects/lazyspace'].map((p, i) => ({ uri: fileUri(p), typed: i === 3, at: this.now - (i + 1) * 3600 }));
    this.workspaces = [
      {
        id: 'ws1',
        name: 'Work',
        created: this.now - 5 * 86_400,
        state: { layout: 'h2', tree: null, focus: 0, panes: [{ active: 0, tabs: [{ uri: fileUri('/Users/demo/Documents/Work') }] }, { active: 0, tabs: [{ uri: fileUri('/Users/demo/Downloads') }] }] },
      },
    ];
  }

  /** Sends an event to everyone who listens, on the next turn, as the host posts it. */
  readonly emit: Emit = (event, data) => {
    setTimeout(() => this.listeners.forEach((l) => l(event, data)), 0);
  };

  tagsOf(uri: string): TagRef[] | undefined {
    const parsed = parseUri(uri);
    return parsed.scheme === 'file' ? this.fs.node(parsed.path)?.tags : undefined;
  }

  // Listing ------------------------------------------------------------------------------------------------------

  capabilitiesOf(uri: ParsedUri): Capabilities {
    if (uri.scheme === 'file') return LOCAL;
    return REMOTE_SCHEMES.includes(uri.scheme) ? REMOTE : READ_ONLY;
  }

  /** The items of a place, or the folder made on demand. Throws the host's error for a place it cannot open. */
  listingOf(uriText: string): Listing {
    const uri = parseUri(uriText);
    if (uri.scheme === 'file') {
      const folder = this.fs.folder(uri.path);
      return folder.virtual ? { virtual: folder.virtual } : { entries: this.fs.list(uri.path) };
    }
    if (uri.scheme === 'search') return { entries: uri.authority.includes('recent') ? this.recents(uri.path) : [] };
    if (uri.scheme === 'stash') return { entries: this.stashEntries() };
    if (REMOTE_SCHEMES.includes(uri.scheme)) return { entries: this.remoteEntries(uri) };
    throw new Error(`${tr('Không mở được địa chỉ', 'Cannot open addresses of')} ${uri.scheme}://`);
  }

  private recents(under: string): Entry[] {
    const found: Array<[string, Entry]> = [];
    this.fs.walk(under, (path, node) => {
      if (node.kind === 'file' && !node.hidden && !node.name.startsWith('.')) found.push([path, this.fs.entryOf(parentOf(path) ?? '/', node)]);
    });
    return found.map(([, e]) => e).sort((a, b) => b.mtime - a.mtime).slice(0, 60);
  }

  stashEntries(): Entry[] {
    return this.stash.flatMap((path) => {
      const node = this.fs.node(path);
      return node ? [{ ...this.fs.entryOf(parentOf(path) ?? '/', node), hidden: false }] : [];
    });
  }

  /** A few believable items for any place on a server, a device or inside an archive. */
  remoteEntries(uri: ParsedUri): Entry[] {
    const seed = hashOf(`${uri.authority}${uri.path}`);
    const out: Entry[] = [];
    for (let i = 0; i < 9; i++) {
      const isDir = i < 3;
      const word = WORDS[(seed + i * 5) % WORDS.length] ?? 'item';
      const name = isDir ? word : `${word}-${(seed >> i) % 90 + 10}.${['txt', 'jpg', 'zip', 'pdf', 'csv'][(seed + i) % 5]}`;
      const ext = isDir ? '' : (name.split('.').pop() ?? '');
      const mtime = this.now - ((seed >> (i + 3)) % 200) * 86_400;
      out.push({
        name,
        uri: makeUri({ ...uri, path: joinPath(uri.path, name) }),
        kind: isDir ? 'dir' : 'file',
        isDir,
        size: isDir ? 0 : ((seed >> i) % 9000) * 1024 + 2048,
        mtime,
        ctime: mtime,
        hidden: false,
        ext,
        icon: isDir ? 'type:public.folder' : `ext:${ext}`,
      });
    }
    return out;
  }

  freeSpaceOf(path: string): number | null {
    const volume = [...this.volumes].sort((a, b) => b.path.length - a.path.length).find((v) => path === v.path || path.startsWith(`${v.path}/`) || v.path === '/');
    return volume?.free ?? null;
  }

  /** Lists a tab: the rows come with `view.changed` a moment later, or `view.error`. Returns the request. */
  startList(view: string, uriText: string, sort: ViewSort, showHidden: boolean): number {
    const uri = parseUri(uriText);
    const request = this.views.begin(view, makeUri(uri), sort, showHidden, this.capabilitiesOf(uri));
    sleep(uri.scheme === 'file' ? 6 : 30).then(() => {
      let listing: Listing;
      try {
        listing = this.listingOf(uriText);
      } catch (error) {
        const current = this.views.has(view) && this.views.get(view).request === request;
        if (current) this.emit('view.error', { view, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      const generation = this.views.finish(view, request, listing);
      if (generation === undefined) return;
      const v = this.views.get(view);
      this.emit('view.changed', { view, generation, count: v.count, uri: v.uri, capabilities: v.capabilities, free: uri.scheme === 'file' ? this.freeSpaceOf(uri.path) : null, groups: v.groups });
      if (this.settings.folder_sizes && v.capabilities.sizes) this.startSizes(view);
    });
    return request;
  }

  /** Works out the sizes of the folders of a tab and sends them in one batch, as `view.sizes`. */
  startSizes(view: string): void {
    const { generation } = this.views.get(view);
    sleep(80).then(() => {
      if (!this.views.has(view) || this.views.get(view).generation !== generation) return;
      const v = this.views.get(view);
      const sizes: Record<string, number> = {};
      for (const e of v.stored()) {
        if (e.isDir || e.kind === 'app' || e.kind === 'package') sizes[e.name] = this.fs.total(parseUri(e.uri).path) || 4096;
      }
      for (const [name, size] of Object.entries(sizes)) v.sizes.set(name, size);
      v.arrange();
      this.emit('view.sizes', { view, generation, sizes });
    });
  }

  stashChanged(): void {
    this.emit('stash.changed', { count: this.stashEntries().length });
    this.changed();
  }

  /** Puts items on the shelf, newest first, once each. Returns how many were new. */
  addToStash(paths: string[]): number {
    const fresh = paths.filter((p, i) => this.fs.exists(p) && !this.stash.includes(p) && paths.indexOf(p) === i);
    this.stash = [...fresh.reverse(), ...this.stash];
    this.stashChanged();
    return fresh.length;
  }

  /** The folders changed on disk: the tabs showing them list again, as the file watcher makes them. */
  changed(...paths: string[]): void {
    const folders = new Set(paths);
    for (const [id, view] of [...this.views.entries()]) {
      const uri = parseUri(view.uri);
      if (uri.scheme === 'file' && folders.has(uri.path)) this.startList(id, view.uri, view.sort, view.showHidden);
      if (uri.scheme === 'stash' || uri.scheme === 'search') this.startList(id, view.uri, view.sort, view.showHidden);
    }
  }

  push(step: UndoStep): void {
    this.undo.push(step);
    if (this.undo.length > 50) this.undo.shift();
  }

  /** The path of a local URI, or the host's error. */
  localPath(uri: string): string {
    const parsed = parseUri(uri);
    if (parsed.scheme !== 'file') throw new Error(tr('Việc này chỉ làm được với tệp trên máy', 'This can only be done with files on this Mac'));
    return parsed.path;
  }

  /** The base name of the trash folder. */
  get trashPath(): string {
    return joinPath(this.fs.home, '.Trash');
  }

  nameOf(uri: string): string {
    return baseName(parseUri(uri).path);
  }
}
