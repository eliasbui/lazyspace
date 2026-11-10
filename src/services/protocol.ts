// The wire protocol between the page and the Rust host (src-tauri/src), typed from the handlers.
//
// A request is { id, method: "area.verb", args }; the answer is { id, ok: true, data } or { id, ok: false, error }, and
// the host also sends { event, data }. `Methods` maps every method to its arguments and result, `Events` maps every
// event to its payload. A method with no arguments has `args: void`. A Rust `Value::Null` result is typed `null`.
//
// Shapes that were written by hand in the old page (the panes layout) are typed from how the page builds them.

/** A place as the app writes it: `file:///Users/me/a%20b.txt`, `archive://...`, `sftp://id/path`, `search://...`. */
export type Uri = string;

/** Seconds since 1970. */
export type Seconds = number;

export type Language = 'vi' | 'en';
export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export type KeymapName = 'mac' | 'windows';
export type ViewMode = 'list' | 'icons' | 'columns' | 'gallery';
export type WindowRole = 'main' | 'desktop' | 'shelf';
export type AccentName = 'system' | 'blue' | 'purple' | 'pink' | 'red' | 'orange' | 'yellow' | 'green' | 'graphite';

// ---------------------------------------------------------------------------------------------------------------------
// Files

/** "app" and "package" are folders Finder shows as one item; "link" is a symbolic link (isDir tells if it goes inside). */
export type EntryKind = 'dir' | 'file' | 'app' | 'package' | 'link';

/** One item of a folder (src-tauri/src/vfs/mod.rs `Entry`). */
export interface Entry {
  name: string;
  uri: Uri;
  kind: EntryKind;
  /** Whether opening it goes inside: a folder, or a link to one. */
  isDir: boolean;
  size: number;
  mtime: Seconds;
  ctime: Seconds;
  hidden: boolean;
  /** Lower case, without the dot. */
  ext: string;
  /** What `lazy://icon` draws: `ext:png`, `type:public.folder`, or `path:<path>`. */
  icon: string;
}

/** A Finder tag of an item of this Mac: its name and colour number (0 to 7). */
export type TagRef = [name: string, colour: number];

/** An item as `view.rows` gives it: the entry plus what is worked out when the row is drawn. */
export interface Row extends Entry {
  /** The kind in words in the language of the host ("Folder", "PNG image"). */
  type: string;
  tags?: TagRef[];
  /** The size of a folder, once `view.sizes` has worked it out. */
  dirSize?: number;
}

/** What a place allows, so the page can leave out what cannot be done there. */
export interface Capabilities {
  write: boolean;
  rename: boolean;
  trash: boolean;
  watch: boolean;
  sizes: boolean;
  localPath: boolean;
}

export type SortBy = 'name' | 'size' | 'mtime' | 'ctime' | 'kind' | 'ext' | 'where';
/** "" for no groups. */
export type GroupBy = '' | 'kind' | 'date' | 'size';

/** How a tab's listing is sorted. Settings only accepts a `by` of `SortBy`. */
export interface Sort {
  by: SortBy;
  desc: boolean;
  foldersFirst: boolean;
  group: GroupBy;
}

/** A sort as a view takes it: a search keeps the order of the hits with `by: "none"`. */
export interface ViewSort extends Omit<Sort, 'by'> {
  by: SortBy | 'none';
}

/** Where each group starts in what is shown, with its name. Empty without groups. */
export type Groups = Array<[start: number, name: string]>;

/** Which items an action is for: some by name, or all but some. */
export type Selection = { names: string[] } | { all: true; except: string[] };

/**
 * The items a method acts on: URIs, or a selection of a tab (the page sends `{ view, selection }` for a big folder).
 * The host refuses an empty one ("Nothing is selected").
 */
export type Targets =
  | { uris: Uri[]; view?: string; selection?: Selection }
  | { uris?: Uri[]; view: string; selection: Selection };

export interface Volume {
  name: string;
  path: string;
  ejectable: boolean;
  internal: boolean;
  total: number;
  free: number;
}

/** The well-known places (`native.home`). A folder this Mac does not have is null. */
export interface Places {
  home: Uri;
  desktop: Uri | null;
  documents: Uri | null;
  downloads: Uri | null;
  movies: Uri | null;
  music: Uri | null;
  pictures: Uri | null;
  applications: Uri;
  trash: Uri;
  /** A `search://` place: the files used lately. */
  recents: Uri;
}

/** An app that can open an item (`native.apps_for`). */
export interface AppInfo {
  path: string;
  name: string;
  /** The system's choice. */
  default: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------
// Settings (src-tauri/src/settings.rs). Field names are the snake_case the Rust writes; `sort` keeps `foldersFirst`.
//
// The old page also sends `sidebar_hidden` and `full_disk_later`, which Rust does not know: `settings.set` refuses
// a key it does not have. They are left out here on purpose.

export interface PreviewSettings {
  side: 'right' | 'bottom';
  on: boolean;
}

export interface DesktopSettings {
  on: boolean;
  hide_finder_icons: boolean;
}

export type ColumnKey = 'mtime' | 'ctime' | 'size' | 'kind' | 'ext' | 'where';

export interface Settings {
  language: Language;
  theme: ThemeChoice;
  /** Liquid Glass behind the window (beta). */
  glass: boolean;
  keymap: KeymapName;
  show_hidden: boolean;
  folder_sizes: boolean;
  view_mode: ViewMode;
  sort: Sort;
  confirm_delete: boolean;
  preview: PreviewSettings;
  desktop: DesktopSettings;
  accent: AccentName;
  sidebar_icons: 'mono' | 'color';
  /** 48, 64, 96 or 128. */
  icon_size: 48 | 64 | 96 | 128;
  text_size: 'small' | 'medium' | 'large';
  /** Empty for the system's, "ui-rounded", "ui-serif", "ui-monospace", or an installed family by name. */
  font: string;
  check_updates: boolean;
  file_viewer: boolean;
  always_tabs: boolean;
  /** The columns of the list view after the name, in order, each once. */
  columns: ColumnKey[];
  copy_queue: boolean;
  verify_copies: boolean;
  notify_devices: boolean;
  background: boolean;
  /** Folders pinned to the sidebar, as URIs. */
  favourites: Uri[];
  /** Kept as JSON, null by default. The page does not use it. */
  sidebar_sections: unknown;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** `settings.set` merges this into the settings key by key, nested objects too, and refuses unknown keys and values. */
export type SettingsPatch = DeepPartial<Settings>;

// ---------------------------------------------------------------------------------------------------------------------
// The layout of a window (`panes.state`, `app.hello.layout`, workspaces). Built by the page; Rust keeps it as it is,
// except that it adds `window` (the size in points) when it saves.

export type TabColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';

export interface TabState {
  uri: Uri;
  mode?: ViewMode | null;
  sort?: ViewSort | null;
  title?: string | null;
  color?: TabColor | null;
}

export interface PaneState {
  active: number;
  /** Widths of the list columns in pixels, by column. */
  cols?: Partial<Record<ColumnKey | 'name', number>>;
  tabs: TabState[];
}

/** A pane is a leaf `{ p: index }`; a split has a direction, the share of each kid, and the kids. */
export type LayoutTree = { p: number } | { dir: 'row' | 'col'; sizes: number[]; kids: LayoutTree[] };

export interface PanesState {
  /** A preset ("single", "h2", "v2", "h3", "l1r2", "grid", "h4", "g6") or "custom". */
  layout: string;
  tree: LayoutTree | null;
  focus: number;
  sidebarWidth?: number;
  sidebarHidden?: boolean;
  panes: PaneState[];
  window?: { width: number; height: number };
}

export interface Workspace {
  id: string;
  name: string;
  created: Seconds;
  state: PanesState;
}

// ---------------------------------------------------------------------------------------------------------------------
// Jobs and their questions

export type JobKind =
  | 'copy'
  | 'move'
  | 'trash'
  | 'delete'
  | 'undo'
  | 'hash'
  | 'disk'
  | 'twins'
  | 'sync.compare'
  | 'sync.apply'
  | 'archive.extract'
  | 'archive.create'
  | 'rename'
  | 'cloud'
  | 'action';

export interface JobInfo {
  id: number;
  kind: JobKind;
  title: string;
}

export interface FileSummary {
  size: number;
  mtime: Seconds;
  isDir: boolean;
}

/** A question a running job asks the user; answer it with `jobs.answer`. */
export type Question =
  | { type: 'conflict'; name: string; folder: boolean; source: FileSummary; target: FileSummary }
  | { type: 'password'; what: string }
  | { type: 'confirm'; text: string };

/** Answers: the choice of a conflict, yes or no to a confirm, `{ text }` to a password. */
export type Answer = 'replace' | 'skip' | 'keepBoth' | 'merge' | 'stop' | 'yes' | 'no' | { text: string };

/** `copy` and `move` jobs. `pairs` are local [from, to] paths for the undo. */
export interface TransferResult {
  pairs: Array<[from: string, to: string]>;
  names: string[];
  to: Uri;
  skipped: number;
}

export interface TrashResult {
  moves: Array<[trashed: string, original: string]>;
}

export interface Digests {
  md5: string;
  sha1: string;
  sha224: string;
  sha256: string;
  sha384: string;
  sha512: string;
  crc32: string;
}

export interface HashResult {
  uri: Uri;
  name: string;
  size: number;
  hashes: Digests;
}

/** A node of the disk map: two levels deep, the biggest first, the rest in one node with `other: true`. */
export interface DiskNode {
  name: string;
  path?: string;
  size: number;
  dir?: boolean;
  other?: boolean;
  children?: DiskNode[];
}

export interface TwinGroup {
  size: number;
  uris: Uri[];
}

export type SyncState = 'same' | 'leftNewer' | 'rightNewer' | 'leftOnly' | 'rightOnly' | 'conflict';
export type SyncAction = 'skip' | 'ltr' | 'rtl' | 'deleteLeft' | 'deleteRight';

export interface SyncSide {
  size: number;
  mtime: Seconds;
  isDir: boolean;
}

export interface SyncPair {
  rel: string;
  left: SyncSide | null;
  right: SyncSide | null;
  state: SyncState;
  action: SyncAction;
}

export interface SyncOptions {
  mode?: 'ltr' | 'rtl' | 'both';
  content?: boolean;
  ignoreHidden?: boolean;
  mirror?: boolean;
}

export interface InstallResult {
  name: string;
  path: string;
  uri: Uri;
  folder: string;
  volume: string | null;
  image: string | null;
  ejected: boolean;
  ejectError: string | null;
}

/** What `data` holds in `jobs.finished`, by the kind of job. A job that has no result ends with null. */
export interface JobResults {
  copy: TransferResult | InstallResult;
  move: TransferResult;
  trash: TrashResult;
  delete: null;
  undo: null;
  hash: HashResult[];
  disk: { map: DiskNode };
  twins: { twins: TwinGroup[]; folder: Uri };
  'sync.compare': { pairs: SyncPair[]; same: number; truncated: boolean };
  'sync.apply': { done: number };
  'archive.extract': { names: string[]; to: Uri | null };
  'archive.create': { names: string[]; to: Uri };
  rename: { names: string[]; to: Uri | null };
  /** Signing in to a cloud, or installing rclone (null). */
  cloud: { remote: string; account: CloudAccount | null } | null;
  /** An action of the user's own: `output` is empty when the action is quiet. */
  action: { action: string; output: string };
}

export type JobData = JobResults[JobKind];

export type JobFinished =
  | { id: number; ok: true; data: JobData }
  | { id: number; ok: false; cancelled: true }
  | { id: number; ok: false; error: string };

// ---------------------------------------------------------------------------------------------------------------------
// Menus

/** A node of a context menu tree. The host refuses unknown fields, more than 4 levels or 200 items. */
export interface MenuNode {
  id?: string;
  label?: string;
  /** The name of an SF Symbol. */
  icon?: string | null;
  enabled?: boolean;
  checked?: boolean;
  /** As the keymap writes it: "Cmd+Shift+N". */
  shortcut?: string | null;
  separator?: boolean;
  submenu?: MenuNode[];
}

/** The user's arrangement of the context menu (menu.json). */
export interface MenuLayout {
  order: string[];
  hidden: string[];
  icons: Record<string, string>;
  separators: string[];
}

/**
 * Ids of the menu bar that the host sends as `menu.action`. The host handles `app.quit`, `file.new_window`,
 * `window.close`, `help.home`, `help.report`, `tray.show` and `tray.quit` itself and never sends them.
 */
export type MenuAction =
  | 'app.settings'
  | 'file.new_tab'
  | 'file.new_folder'
  | 'file.eject'
  | 'file.close_tab'
  | 'view.list'
  | 'view.icons'
  | 'view.columns'
  | 'view.gallery'
  | 'view.hidden'
  | 'go.back'
  | 'go.forward'
  | 'go.enclosing'
  | 'go.home'
  | 'go.desktop'
  | 'go.downloads'
  | 'go.applications';

// ---------------------------------------------------------------------------------------------------------------------
// Features

export interface UserAction {
  id: string;
  name: string;
  /** A line of zsh; the selected items are its arguments. */
  command: string;
  /** What it is offered for. */
  when: 'any' | 'files' | 'folders' | 'none';
  /** Where its output goes. */
  output: 'toast' | 'terminal' | 'none';
}

export interface HistoryPlace {
  uri: Uri;
  typed: boolean;
  at: Seconds;
}

export interface IndexHit {
  path: string;
  folder: boolean;
  score: number;
}

export interface Template {
  id: string;
  name: string;
  ext: string;
  builtin: boolean;
}

export interface OpenInTool {
  id: string;
  name: string;
  kind: 'terminal' | 'editor';
  path: string;
  /** The tool used last, per kind. */
  default: boolean;
}

export type GitLetter = '?' | 'M' | 'R' | 'A' | 'D' | 'U';

export interface GitStatus {
  root: Uri;
  /** The branch, or a short commit when detached; null when neither is known. */
  branch: string | null;
  /** The state of each item of the folder by name; a folder takes the strongest state inside it. */
  items: Record<string, GitLetter>;
}

export interface ViewerState {
  fileViewer: boolean;
  folders: boolean;
  available: boolean;
}

export type HelperId = 'photos' | 'image-capture' | 'finder';

/** A phone or camera as the sidebar shows it. */
export interface Phone {
  key: string;
  name: string;
  kind: 'apple' | 'camera' | 'mtp';
  uri: Uri;
  readable: boolean;
  state: '' | 'opening' | 'reading' | 'ready' | 'locked' | 'failed';
  percent: number;
}

export type RenameRule =
  | { type: 'replace'; find: string; with?: string; regex?: boolean; caseInsensitive?: boolean; scope?: 'name' | 'ext' | 'all' }
  | { type: 'insert'; text: string; at?: 'start' | 'end' | 'index'; index?: number }
  | { type: 'remove'; from?: number; count: number; fromEnd?: boolean }
  | { type: 'number'; start?: number; step?: number; pad?: number; at?: 'start' | 'end' | 'index'; index?: number; sep?: string }
  | { type: 'parent'; at?: 'start' | 'end' | 'index'; sep?: string }
  | { type: 'case'; mode: 'lower' | 'upper' | 'title' | 'sentence' }
  | { type: 'ext'; set?: string | null; case?: 'lower' | 'upper' | 'title' | 'sentence' | null };

export interface RenameRow {
  from: string;
  to: string;
  /** Why this name cannot be used, or null. */
  problem: string | null;
}

export type ArchiveFormat = 'zip' | '7z' | 'tar' | 'tar.gz' | 'tar.xz' | 'tar.bz2';

// Remote servers and clouds

export type ConnectionScheme = 'sftp' | 'ftp' | 'ftps' | 's3' | 'oss' | 'smb' | 'afp' | 'nfs' | 'dav' | 'davs';

/** A saved server. It never holds its secret: that goes to the Keychain under the id. */
export interface Connection {
  /** Empty for a new one: the host gives it an id when it saves. */
  id: string;
  name: string;
  scheme: ConnectionScheme;
  host: string;
  port: number | null;
  /** The user name, or the access key id of S3 and OSS. */
  user: string;
  path: string;
  region: string;
  endpoint: string;
  bucket: string;
  keyFile: string;
  guest: boolean;
}

export type CloudKind =
  | 'drive'
  | 'dropbox'
  | 'onedrive'
  | 'onedrive_work'
  | 'sharepoint'
  | 'box'
  | 'pcloud'
  | 'mega'
  | 'yandex'
  | 'koofr'
  | 'jottacloud'
  | 'sharefile';

export interface CloudAccount {
  backend: string;
  kind: string;
  /** The email or name the cloud gives; null until it is known (`remote.changed` tells when). */
  account: string | null;
}

export interface RcloneAdvanced {
  clientId?: string;
  clientSecret?: string;
  tenant?: string;
  site?: string;
}

export interface RemoteList {
  connections: Array<Connection & { live: boolean }>;
  rclone: {
    installed: boolean;
    remotes: string[];
    accounts: Record<string, CloudAccount>;
    kinds: CloudKind[];
  };
}

/** The folder of a cloud's own app, found in ~/Library/CloudStorage and the like. */
export interface CloudFolder {
  name: string;
  account: string | null;
  service: 'icloud' | 'drive' | 'onedrive' | 'dropbox' | 'box' | 'cloud';
  uri: Uri;
}

// ---------------------------------------------------------------------------------------------------------------------
// Methods

type Job = { job: number };

export interface Methods {
  // app
  'app.drag': { args: void; result: null };
  'app.drawn': { args: void; result: null };
  'app.log': { args: { message: string }; result: null };
  'app.new_window': { args: { uri?: Uri | null }; result: { window: number } };
  'app.open_url': { args: { url: string }; result: null };
  'app.ready': { args: void; result: null };
  'app.zoom': { args: void; result: null };

  // actions
  'actions.list': { args: void; result: UserAction[] };
  /** A job, or null when the output goes to Terminal. */
  'actions.run': { args: { id: string; folder: Uri; uris?: Uri[] }; result: Job | null };
  'actions.save': { args: { actions: UserAction[] }; result: UserAction[] };

  // archive
  'archive.create': {
    args: Targets & {
      format: ArchiveFormat;
      name?: string | null;
      password?: string | null;
      level?: number | null;
      /** Volumes of this many MB; 0 for one file. */
      splitMb?: number;
    };
    result: Job;
  };
  'archive.extract': { args: Targets & { to?: Uri | null }; result: Job };
  'archive.password': { args: { uri: Uri; password: string }; result: null };

  // clipboard
  'clipboard.copy': { args: Targets; result: null };
  'clipboard.cut': { args: Targets; result: null };
  /** Moves what was copied instead of copying it when `move` is set, or when it was cut. */
  'clipboard.paste': { args: { to: Uri; move?: boolean }; result: Job };
  /** The URIs that were cut and are still on the clipboard. */
  'clipboard.state': { args: void; result: { cut: Uri[] } };
  'clipboard.text': { args: { text: string }; result: null };

  // desktop
  'desktop.enable': { args: { on: boolean; hideFinderIcons: boolean }; result: null };
  'desktop.move': {
    args: { view: string; names: string[]; col: number; row: number; cols: number; rows: number };
    result: { cells: Record<string, [col: number, row: number]> };
  };
  'desktop.place': { args: { view: string; cols: number; rows: number }; result: { cells: Record<string, [col: number, row: number]> } };
  'desktop.state': { args: void; result: { on: boolean; hideFinderIcons: boolean; finderIcons: boolean } };

  // devices
  'devices.install': { args: { app: string; eject?: boolean }; result: Job };
  'devices.open_app': { args: { app: HelperId }; result: null };
  'devices.phones': { args: void; result: Phone[] };

  // disk
  'disk.map': { args: { uri: Uri }; result: Job };
  'disk.twins': { args: { uri: Uri }; result: Job };

  // drag
  'drag.arm': { args: Targets; result: null };
  'drag.disarm': { args: void; result: null };

  // fs
  'fs.complete': { args: { text: string }; result: { items: string[] } };
  /** `mode` "auto" moves on the same disk and copies to another, as a drop in Finder. It wins over `move`. */
  'fs.copy': { args: { from: Uri[]; to: Uri; move?: boolean; mode?: 'copy' | 'move' | 'auto' }; result: Job };
  'fs.create_file': { args: { uri: Uri; name: string; text?: string }; result: Entry };
  'fs.delete': { args: Targets; result: Job };
  /** Starts listing into the tab `view`; the rows come with `view.changed`. `request` numbers this listing. */
  'fs.list': { args: { view: string; uri: Uri; sort?: ViewSort; showHidden?: boolean }; result: { request: number } };
  /** Without `name`, "untitled folder" (numbered when taken). Returns the new folder. */
  'fs.mkdir': { args: { uri: Uri; name?: string | null }; result: Entry };
  'fs.read_text': { args: { uri: Uri; max?: number }; result: { text: string; truncated: boolean; mtime: Seconds; size: number } };
  'fs.rename': { args: { uri: Uri; name: string }; result: Entry };
  'fs.sizes': { args: { view: string; on: boolean }; result: null };
  'fs.stat': { args: { uri: Uri }; result: Entry };
  'fs.subfolders': { args: { uri: Uri }; result: { items: Array<{ name: string; uri: Uri }> } };
  'fs.trash': { args: Targets; result: Job };
  'fs.undo': { args: void; result: Job };
  /** The title of the step `fs.undo` would take back, or null. */
  'fs.undo_title': { args: void; result: string | null };
  /** `mtime` is what `fs.read_text` gave; the write is refused when the file changed since. */
  'fs.write_text': { args: { uri: Uri; text: string; mtime?: Seconds | null }; result: Entry };

  // git
  'git.status': { args: { uri: Uri }; result: GitStatus | null };

  // hash
  'hash.start': { args: Targets; result: Job };

  // history
  'history.add': { args: { uri: Uri; typed?: boolean }; result: null };
  'history.clear': { args: void; result: HistoryPlace[] };
  'history.list': { args: void; result: HistoryPlace[] };
  'history.remove': { args: { uri: Uri }; result: HistoryPlace[] };

  // index
  'index.rebuild': { args: void; result: null };
  'index.search': { args: { q: string; under?: string | null; limit?: number | null }; result: { items: IndexHit[]; ready: boolean } };
  'index.state': { args: void; result: { ready: boolean; building: boolean; count: number } };

  // jobs
  'jobs.answer': { args: { id: number; answer: Answer; applyAll?: boolean }; result: null };
  'jobs.cancel': { args: { id: number }; result: null };
  'jobs.list': { args: void; result: JobInfo[] };
  'jobs.pause': { args: { id: number; paused: boolean }; result: null };

  // lanes
  'lanes.available': { args: void; result: boolean };
  'lanes.send': { args: { uris: Uri[] }; result: { sent: number } };

  // menu
  /** The choice comes back as `menu.chosen`, or `menu.closed` when nothing was chosen. */
  'menu.show': { args: { items: MenuNode[]; x: number; y: number; uris?: Uri[] }; result: null };

  // menuedit
  'menuedit.get': { args: void; result: MenuLayout };
  'menuedit.set': { args: { layout: MenuLayout }; result: null };

  // native
  'native.apps_for': { args: { uri: Uri }; result: AppInfo[] };
  'native.eject': { args: { path: string; force?: boolean }; result: null };
  'native.fonts': { args: void; result: string[] };
  'native.full_disk': { args: void; result: { granted: boolean } };
  'native.get_info': { args: Targets; result: null };
  'native.home': { args: void; result: Places };
  'native.office_apps': { args: void; result: { word: string | null; excel: string | null; powerpoint: string | null } };
  'native.open': { args: Targets; result: null };
  'native.open_full_disk': { args: void; result: null };
  'native.open_with': { args: Targets & { app: string }; result: null };
  /** Shows the items in Quick Look, or hides the panel when it is open. With no targets it only hides. */
  'native.quicklook': { args: { uris?: Uri[]; view?: string; selection?: Selection; index?: number }; result: null };
  'native.reveal': { args: Targets; result: null };
  'native.share': { args: { uris: Uri[]; x: number; y: number }; result: null };
  'native.volumes': { args: void; result: Volume[] };

  // openin
  'openin.add': { args: { path: string; kind: 'terminal' | 'editor' }; result: null };
  /** Either `tool` (an id) or `kind` (the default tool of that kind). */
  'openin.open': { args: { tool?: string | null; kind?: 'terminal' | 'editor' | null; uri: Uri }; result: null };
  'openin.tools': { args: void; result: OpenInTool[] };

  // panes
  'panes.state': { args: { state: PanesState }; result: null };

  // preview
  /** Answers at once with null; the info arrives as the `preview.ready` event. */
  'preview.info': { args: { uri: Uri }; result: null };

  // remote
  'remote.clouds': { args: void; result: CloudFolder[] };
  'remote.connect': { args: { id: string }; result: { uri: Uri } };
  'remote.delete': { args: { id: string }; result: null };
  'remote.disconnect': { args: { id: string }; result: null };
  'remote.list': { args: void; result: RemoteList };
  'remote.onedrive_app': { args: void; result: { installed: boolean } };
  'remote.onedrive_open': { args: void; result: { opened: 'app' | 'store' } };
  /** `kept` is whether the Keychain took the password for good. */
  'remote.password': { args: { id: string; password: string }; result: { kept: boolean } };
  'remote.rclone_add': { args: { kind: CloudKind; name: string; advanced?: RcloneAdvanced }; result: Job };
  'remote.rclone_install': { args: void; result: Job };
  'remote.rclone_remove': { args: { name: string }; result: null };
  /** `secret` null leaves the stored one, "" deletes it. */
  'remote.save': { args: { connection: Partial<Connection>; secret?: string | null }; result: { connection: Connection; kept: boolean } };
  'remote.test': { args: { connection: Partial<Connection>; secret?: string | null }; result: null };
  'remote.trust': { args: { host: string; port?: number | null; fingerprint: string }; result: null };

  // rename
  'rename.apply': { args: Targets & { rules: RenameRule[] }; result: Job };
  'rename.preview': {
    args: Targets & { rules: RenameRule[] };
    result: { rows: RenameRow[]; total: number; problems: number; changed: number };
  };

  // settings
  /** The chosen folder as a path, or null when the picker was cancelled. */
  'settings.choose_folder': { args: { prompt?: string }; result: string | null };
  'settings.get': { args: void; result: Settings };
  'settings.set': { args: { patch: SettingsPatch }; result: Settings };

  // stash
  'stash.add': { args: { uris: Uri[] }; result: { added: number } };
  'stash.add_clipboard': { args: void; result: { added: number } };
  /** One of `text`, `url`, or `base64` (a file of that content, named `name`). */
  'stash.add_data': {
    args: { name?: string | null; text?: string | null; url?: string | null; base64?: string | null };
    result: { added: number };
  };
  'stash.clear': { args: void; result: null };
  'stash.count': { args: void; result: number };
  'stash.items': { args: void; result: Entry[] };
  'stash.remove': { args: { uris: Uri[] }; result: null };
  /** Shows or hides the shelf window; without `on` it toggles. */
  'stash.show': { args: { on?: boolean }; result: null };

  // sync
  'sync.apply': { args: { left: Uri; right: Uri; steps: Array<{ rel: string; action: SyncAction }> }; result: Job };
  'sync.compare': { args: { left: Uri; right: Uri; options?: SyncOptions }; result: Job };

  // tags
  /** `colour` 1 to 7. */
  'tags.set': { args: { uris: Uri[]; colour: number; on: boolean }; result: null };

  // templates
  'templates.add': { args: { uri: Uri }; result: null };
  /** Makes "Untitled.<ext>" in the folder `uri`. */
  'templates.create': { args: { uri: Uri; id: string }; result: Entry };
  'templates.folder': { args: void; result: Uri };
  'templates.list': { args: void; result: Template[] };

  // update
  'update.check': { args: { manual?: boolean }; result: null };
  'update.install': { args: void; result: null };
  'update.relaunch': { args: void; result: null };

  // view
  'view.close': { args: { view: string }; result: null };
  'view.filter': { args: { view: string; text: string }; result: { generation: number; count: number; groups: Groups } };
  'view.find': { args: { view: string; prefix: string }; result: { index: number | null } };
  'view.hidden': { args: { view: string; show: boolean }; result: { generation: number; count: number; groups: Groups } };
  'view.index_of': { args: { view: string; name: string }; result: { index: number | null } };
  /** Rejects with "stale" when `generation` is not the view's current one; at most 500 rows per call. */
  'view.rows': {
    args: { view: string; start: number; count: number; generation: number };
    result: { rows: Row[]; generation: number; start: number };
  };
  'view.sort': { args: { view: string; sort: ViewSort }; result: { generation: number; groups: Groups } };

  // viewer
  'viewer.enable': { args: { on: boolean }; result: ViewerState };
  'viewer.reveal': { args: { uris: Uri[] }; result: null };
  'viewer.state': { args: void; result: ViewerState };

  // workspaces
  'workspaces.delete': { args: { id: string }; result: null };
  'workspaces.list': { args: void; result: Workspace[] };
  'workspaces.rename': { args: { id: string; name: string }; result: null };
  'workspaces.save': { args: { name: string; state: PanesState }; result: Workspace };
}

// ---------------------------------------------------------------------------------------------------------------------
// Events

export interface HelloData {
  version: string;
  theme: ResolvedTheme;
  settings: Settings;
  /** Always empty today. */
  features: string[];
  windowRole: WindowRole;
  windowId: number;
  /** The place the window was asked to open, or null. */
  uri: Uri | null;
  /** The layout of the last main window (layout.json), or null. */
  layout: PanesState | null;
  /** The system's accessibility preferences when the window was made. */
  accessibility: { reduceTransparency: boolean; increaseContrast: boolean; reduceMotion: boolean };
  /** Whether this Mac can draw Liquid Glass (the `glass` setting has an effect). */
  glassAvailable: boolean;
}

export interface VolumeNote {
  path: string;
  uri: Uri;
  name: string;
  /** "image", "network", "internal", "usb", "card", "thunderbolt" or "external". */
  kind: string;
  ejectable: boolean;
  total: number;
  free: number;
  /** The file a disk image was opened from. */
  image: string | null;
  apps: Array<{ path: string; uri: Uri; name: string; version: string | null; target: string; installed: string | null }>;
  packages: Array<{ path: string; uri: Uri; name: string }>;
}

export interface DeviceNote {
  id: number;
  kind: 'apple' | 'camera' | 'mtp';
  name: string;
  vendor: string;
  location: number;
  uri: Uri;
  helpers: Array<{ id: HelperId; name: string }>;
}

export interface PreviewInfo {
  uri: Uri;
  kind: 'folder' | 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other';
  /** The kind in words. */
  type: string;
  entry: Entry;
  /** The copy on this Mac, as a `file://` URI, for an item that is inside an archive or on a server. */
  local?: Uri;
  media?: { duration: number; video?: { width: number; height: number; fps: number; dataRate: number }; audio?: { dataRate: number } };
  /** For a folder: how many items it holds, or null. */
  items?: number | null;
  editable?: boolean;
}

export interface Events {
  'app.hello': HelloData;
  'desktop.screens': null;
  'devices.device': DeviceNote;
  'devices.files': { key: string; uri: Uri };
  'devices.installed': InstallResult;
  'devices.phones': Phone[];
  'devices.removed': { id: number };
  'devices.volume': VolumeNote;
  /** Files dropped on the window; `mode` is from the modifier keys held. */
  drop: { x: number; y: number; uris: Uri[]; mode: 'copy' | 'move' | 'auto' };
  'drop.leave': null;
  'drop.over': { x: number; y: number };
  'hash.result': { job: number; result: HashResult };
  'hash.started': { job: number };
  'jobs.ask': { id: number; question: Question };
  'jobs.finished': JobFinished;
  'jobs.paused': { id: number; paused: boolean };
  'jobs.progress': { id: number; done: number; total: number; current: string };
  'jobs.started': { id: number; kind: JobKind; title: string };
  'menu.action': { id: MenuAction };
  'menu.chosen': { id: string };
  'menu.closed': null;
  /** The answer to `preview.info`; `error` is set instead of the rest when it failed. */
  'preview.ready': PreviewInfo | { uri: Uri; error: string };
  'remote.changed': null;
  'settings.changed': Settings;
  'stash.changed': { count: number };
  'theme.changed': { theme: ResolvedTheme };
  /** A message to show, in the language of the host. */
  toast: string;
  'update.available': { current: string; latest: string; notes: string; installable: boolean; url: string };
  'update.error': { error: string };
  'update.none': { current: string };
  /** Percent, 0 to 100. */
  'update.progress': number;
  'update.ready': null;
  /** A listing is in (or sorted again by the host): `count` rows at `generation`. */
  'view.changed': {
    view: string;
    generation: number;
    count: number;
    uri: Uri;
    capabilities: Capabilities;
    /** Free bytes of the disk the folder is on, for a local place. */
    free: number | null;
    groups: Groups;
  };
  'view.error': { view: string; error: string };
  /** Sizes of folders by name, as they are worked out. */
  'view.sizes': { view: string; generation: number; sizes: Record<string, number> };
  'viewer.show': { uri: Uri; names: string[] };
  'volumes.changed': { kind: 'mounted' | 'unmounted' | 'renamed'; path: string; from?: string };
}

export type MethodName = keyof Methods;
export type EventName = keyof Events;
