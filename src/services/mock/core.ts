import type { AppInfo, HelloData, Places, ResolvedTheme, Settings, Workspace } from '../protocol';
import { CHOICES, FONTS, VERSION, defaultSettings } from './fixtures';
import { baseName, fileUri, joinPath, makeUri, parentOf, parseUri } from './fs';
import type { Handlers } from './handlers';
import { targetUris } from './ops';
import type { MockState } from './state';
import { hashOf, setLanguage, sleep, tr } from './util';

// The core methods: the app, settings, layout, updates, menus, the native helpers, and the small features.

const TAG_NAMES = ['', 'Gray', 'Green', 'Purple', 'Blue', 'Yellow', 'Red', 'Orange'];

export function resolvedTheme(s: MockState): ResolvedTheme {
  return s.settings.theme === 'system' ? s.systemTheme : s.settings.theme;
}

function hello(s: MockState): HelloData {
  return {
    version: VERSION,
    theme: resolvedTheme(s),
    settings: s.settings,
    features: [],
    windowRole: s.windowRole,
    windowId: 1,
    uri: s.folder ? fileUri(s.folder) : null,
    layout: s.layout,
    accessibility: { reduceTransparency: false, increaseContrast: false, reduceMotion: false },
    glassAvailable: true,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const bad = (key: string, value: unknown): Error => new Error(`${tr('Giá trị không hợp lệ cho', 'Not a valid value for')} ${key}: ${String(value)}`);

/** Merges a patch into the settings as the host does: known keys only, same types, only the allowed choices. */
export function patchSettings(current: Settings, patch: unknown): Settings {
  if (!isObject(patch)) throw new Error(tr('Thay đổi cài đặt phải là một đối tượng', 'The settings change must be an object'));
  const defaults: Record<string, unknown> = { ...defaultSettings() };
  const merged: Record<string, unknown> = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
  const merge = (into: Record<string, unknown>, from: Record<string, unknown>, known: Record<string, unknown>, path: string): void => {
    for (const [key, value] of Object.entries(from)) {
      if (!(key in known)) throw new Error(`${tr('Cài đặt không có khóa', 'Settings has no key')} ${path}${key}`);
      const base = known[key];
      const into2 = into[key];
      if (isObject(base) && isObject(value) && isObject(into2)) merge(into2, value, base, `${path}${key}.`);
      else if (base !== null && typeof base !== typeof value) throw bad(`${path}${key}`, value);
      else if (Array.isArray(base) !== Array.isArray(value)) throw bad(`${path}${key}`, value);
      else into[key] = value;
    }
  };
  merge(merged, patch, defaults, '');
  const next = merged as unknown as Settings;
  for (const [key, read, allowed] of CHOICES) if (!allowed.includes(read(next))) throw bad(key, read(next));
  if (next.font.length > 64 || /["\\\u0000-\u001f]/.test(next.font)) throw bad('font', next.font);
  const known = ['mtime', 'ctime', 'size', 'kind', 'ext', 'where'];
  if (next.columns.some((c, i) => !known.includes(c) || next.columns.indexOf(c) !== i)) throw bad('columns', next.columns.join(', '));
  if (![48, 64, 96, 128].includes(next.icon_size)) throw bad('icon_size', next.icon_size);
  return next;
}

function places(s: MockState): Places {
  const at = (name: string): string => fileUri(joinPath(s.fs.home, name));
  return {
    home: fileUri(s.fs.home),
    desktop: at('Desktop'),
    documents: at('Documents'),
    downloads: at('Downloads'),
    movies: at('Movies'),
    music: at('Music'),
    pictures: at('Pictures'),
    applications: fileUri('/Applications'),
    trash: at('.Trash'),
    recents: makeUri({ scheme: 'search', authority: 'recent=1', path: s.fs.home }),
  };
}

type Cell = [col: number, row: number];

/** Cells of the icon grid for `names`: the ones kept stay, the rest take the first free cells, down a column first. */
function placeCells(names: string[], kept: Map<string, Cell>, cols: number, rows: number): Map<string, Cell> {
  const out = new Map<string, Cell>();
  const taken = new Set<string>();
  const key = (c: Cell): string => `${c[0]},${c[1]}`;
  for (const name of names) {
    const cell = kept.get(name);
    if (cell && cell[0] < cols && cell[1] < rows && !taken.has(key(cell))) {
      out.set(name, cell);
      taken.add(key(cell));
    }
  }
  let i = 0;
  for (const name of names) {
    if (out.has(name)) continue;
    const r = Math.max(1, rows);
    let cell: Cell = [Math.floor(i / r), i % r];
    while (taken.has(key(cell))) {
      i++;
      cell = [Math.floor(i / r), i % r];
    }
    out.set(name, cell);
    taken.add(key(cell));
  }
  return out;
}

function moveCells(names: string[], at: Cell, cells: Map<string, Cell>, rows: number): void {
  for (const name of names) cells.delete(name);
  const taken = new Set([...cells.values()].map((c) => `${c[0]},${c[1]}`));
  const r = Math.max(1, rows);
  let i = at[0] * r + Math.min(at[1], r - 1);
  for (const name of names) {
    while (taken.has(`${Math.floor(i / r)},${i % r}`)) i++;
    cells.set(name, [Math.floor(i / r), i % r]);
    taken.add(`${Math.floor(i / r)},${i % r}`);
  }
}

const cellsOf = (cells: Map<string, Cell>): Record<string, Cell> => Object.fromEntries(cells);

function putWorkspace(s: MockState, name: string, state: Workspace['state']): Workspace {
  const trimmed = name.trim();
  if (!trimmed || [...trimmed].length > 80) throw new Error(tr('Tên workspace phải có từ 1 đến 80 ký tự', 'A workspace name has 1 to 80 characters'));
  if (!Array.isArray(state.panes)) throw new Error(tr('Trạng thái cửa sổ không hợp lệ', 'The window state is not valid'));
  const id = s.workspaces.find((w) => w.name === trimmed)?.id ?? `ws${s.now}${s.workspaces.length}`;
  s.workspaces = s.workspaces.filter((w) => w.id !== id);
  const workspace: Workspace = { id, name: trimmed, created: s.now, state };
  s.workspaces.push(workspace);
  return workspace;
}

const INDEX_ROOTS = ['/Users/demo', '/Applications'];

export const coreHandlers = {
  'app.drag': () => null,
  'app.drawn': () => null,
  'app.log': () => null,
  'app.zoom': () => null,
  'app.open_url': ({ url }) => {
    if (!/^https?:\/\//.test(url)) throw new Error(tr('Chỉ mở được địa chỉ web', 'Only web addresses can be opened'));
    return null;
  },
  'app.new_window': (_, s) => ({ window: s.nextWindow++ }),
  'app.ready': (_, s) => {
    sleep(8).then(() => {
      s.emit('app.hello', hello(s));
      if (s.updateAvailable) {
        sleep(300).then(() => s.emit('update.available', { current: VERSION, latest: '0.5.0', notes: 'A new sidebar, faster listings and Liquid Glass.', installable: true, url: 'https://github.com/' }));
      }
    });
    return null;
  },

  'settings.get': (_, s) => s.settings,
  'settings.set': ({ patch }, s) => {
    s.settings = patchSettings(s.settings, patch);
    setLanguage(s.settings.language);
    s.emit('settings.changed', s.settings);
    return s.settings;
  },
  'settings.choose_folder': () => '/Users/demo/Documents',
  'panes.state': ({ state }, s) => {
    if (!isObject(state)) throw new Error(tr('Bố cục phải là một đối tượng', 'The layout must be an object'));
    s.layout = { ...state, window: { width: 1100, height: 720 } };
    return null;
  },

  'update.check': ({ manual }, s) => {
    sleep(350).then(() => {
      if (s.updateAvailable) s.emit('update.available', { current: VERSION, latest: '0.5.0', notes: 'A new sidebar, faster listings and Liquid Glass.', installable: true, url: 'https://github.com/' });
      else if (manual) s.emit('update.none', { current: VERSION });
    });
    return null;
  },
  'update.install': (_, s) => {
    void (async () => {
      for (let percent = 0; percent <= 100; percent += 10) {
        s.emit('update.progress', percent);
        await sleep(120);
      }
      s.emit('update.ready', null);
    })();
    return null;
  },
  'update.relaunch': () => null,

  'menu.show': ({ items }, s) => {
    if (items.length > 200) throw new Error(tr('Menu có quá nhiều mục', 'The menu has too many items'));
    sleep(40).then(() => s.emit('menu.closed', null));
    return null;
  },
  'menuedit.get': (_, s) => s.menuLayout,
  'menuedit.set': ({ layout }, s) => {
    s.menuLayout = layout;
    return null;
  },
  'drag.arm': (targets, s) => {
    targetUris(s, targets);
    return null;
  },
  'drag.disarm': () => null,

  'native.apps_for': (): AppInfo[] => [
    { path: '/Applications/Preview.app', name: 'Preview', default: true },
    { path: '/Applications/Safari.app', name: 'Safari', default: false },
    { path: '/Applications/Visual Studio Code.app', name: 'Visual Studio Code', default: false },
  ],
  'native.eject': ({ path }, s) => {
    const volume = s.volumes.find((v) => v.path === path && v.ejectable);
    if (!volume) throw new Error(tr('Không đẩy ra được', 'This disk cannot be ejected'));
    s.volumes = s.volumes.filter((v) => v !== volume);
    sleep(150).then(() => s.emit('volumes.changed', { kind: 'unmounted', path }));
    return null;
  },
  'native.fonts': () => FONTS,
  'native.full_disk': () => ({ granted: true }),
  'native.get_info': (targets, s) => {
    targetUris(s, targets);
    return null;
  },
  'native.home': (_, s) => places(s),
  'native.office_apps': () => ({ word: null, excel: null, powerpoint: null }),
  'native.open': (targets, s) => {
    targetUris(s, targets);
    return null;
  },
  'native.open_full_disk': () => null,
  'native.open_with': (targets, s) => {
    targetUris(s, targets);
    return null;
  },
  'native.quicklook': () => null,
  'native.reveal': (targets, s) => {
    targetUris(s, targets);
    return null;
  },
  'native.share': () => null,
  'native.volumes': (_, s) => s.volumes,

  'openin.tools': (_, s) => s.tools,
  'openin.open': ({ tool, kind, uri }, s) => {
    s.localPath(uri);
    const found = tool ? s.tools.find((t) => t.id === tool) : s.tools.find((t) => t.kind === kind && t.default);
    if (!found) throw new Error(tr('Không tìm thấy ứng dụng này', 'That app cannot be found'));
    s.tools = s.tools.map((t) => (t.kind === found.kind ? { ...t, default: t.id === found.id } : t));
    return null;
  },
  'openin.add': ({ path, kind }, s) => {
    if (!path.endsWith('.app')) throw new Error(tr('Hãy chọn một ứng dụng (.app)', 'Choose an app (.app)'));
    s.tools = [...s.tools.filter((t) => t.path !== path), { id: `extra-${hashOf(path)}`, name: baseName(path).replace(/\.app$/, ''), kind, path, default: false }];
    return null;
  },

  'viewer.state': (_, s) => ({ fileViewer: s.fileViewer, folders: false, available: true }),
  'viewer.enable': ({ on }, s) => {
    s.fileViewer = on;
    s.settings = { ...s.settings, file_viewer: on };
    s.emit('settings.changed', s.settings);
    return { fileViewer: on, folders: false, available: true };
  },
  'viewer.reveal': ({ uris }, s) => {
    for (const uri of uris) {
      const path = s.localPath(uri);
      const entry = s.fs.stat(path);
      s.emit('viewer.show', entry.isDir ? { uri, names: [] } : { uri: fileUri(parentOf(path) ?? '/'), names: [entry.name] });
    }
    return null;
  },

  'desktop.state': (_, s) => ({ on: s.settings.desktop.on, hideFinderIcons: s.settings.desktop.hide_finder_icons, finderIcons: !s.settings.desktop.hide_finder_icons }),
  'desktop.enable': ({ on, hideFinderIcons }, s) => {
    s.settings = { ...s.settings, desktop: { on, hide_finder_icons: hideFinderIcons } };
    s.emit('settings.changed', s.settings);
    return null;
  },
  'desktop.place': ({ view, cols, rows }, s) => {
    s.desktopCells = placeCells(s.views.get(view).names(), s.desktopCells, cols, rows);
    return { cells: cellsOf(s.desktopCells) };
  },
  'desktop.move': ({ view, names, col, row, cols, rows }, s) => {
    const cells = placeCells(s.views.get(view).names(), s.desktopCells, cols, rows);
    moveCells(names, [Math.min(col, Math.max(0, cols - 1)), row], cells, rows);
    s.desktopCells = cells;
    return { cells: cellsOf(cells) };
  },

  'lanes.available': () => false,
  'lanes.send': () => {
    throw new Error(tr('Chưa cài Lanes', 'Lanes is not installed'));
  },

  'index.state': (_, s) => ({ ready: s.index.ready, building: s.index.building, count: 48_213 }),
  'index.rebuild': (_, s) => {
    s.index = { ready: s.index.ready, building: true };
    sleep(600).then(() => {
      s.index = { ready: true, building: false };
    });
    return null;
  },
  'index.search': ({ q, under, limit }, s) => {
    const needle = q.trim().toLowerCase();
    const hits: Array<{ path: string; folder: boolean; score: number }> = [];
    if (needle) {
      for (const root of INDEX_ROOTS) {
        s.fs.walk(root, (path, node) => {
          const lower = path.toLowerCase();
          if (under && !path.startsWith(under)) return;
          if (node.name.toLowerCase().includes(needle)) hits.push({ path, folder: node.kind !== 'file', score: 1000 - path.length + (node.name.toLowerCase().startsWith(needle) ? 200 : 0) + (lower.includes('/library/') ? -300 : 0) });
        });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return { items: hits.slice(0, Math.min(limit ?? 50, 5000)), ready: s.index.ready };
  },

  'templates.list': (_, s) => [...s.templates.map(({ id, name, ext, builtin }) => ({ id, name, ext, builtin })), ...s.userTemplates.map(({ id, name, ext }) => ({ id, name, ext, builtin: false }))],
  'templates.folder': (_, s) => {
    const dir = joinPath(s.fs.home, 'Library/Application Support/LazySpace/templates');
    s.fs.ensure(dir, s.now);
    return fileUri(dir);
  },
  'templates.add': ({ uri }, s) => {
    const entry = s.fs.stat(s.localPath(uri));
    s.userTemplates.push({ id: `user-${entry.name}`, name: entry.name, ext: entry.ext, text: '' });
    return null;
  },
  'templates.create': ({ uri, id }, s) => {
    const dir = s.localPath(uri);
    const template = s.templates.find((t) => t.id === id) ?? s.userTemplates.find((t) => t.id === id);
    if (!template) throw new Error(tr('Không có mẫu này', 'There is no such template'));
    const base = template.ext ? `${tr('Không tên', 'Untitled')}.${template.ext}` : tr('Không tên', 'Untitled');
    const name = s.fs.exists(joinPath(dir, base)) ? s.fs.uniqueName(dir, base) : base;
    s.fs.file(dir, name, 0, s.now, template.text);
    s.push({ title: `${tr('Tạo tệp', 'New File')} "${name}"`, run: () => void s.fs.remove(joinPath(dir, name)) });
    s.changed(dir);
    return s.fs.stat(joinPath(dir, name));
  },

  'actions.list': (_, s) => s.actions,
  'actions.save': ({ actions }, s) => {
    if (actions.length > 50 || actions.some((a) => !a.id || !a.name.trim() || !a.command.trim())) throw new Error(tr('Lệnh không hợp lệ', 'Not a valid command'));
    s.actions = actions;
    return actions;
  },
  'actions.run': ({ id, folder }, s) => {
    const action = s.actions.find((a) => a.id === id);
    if (!action) throw new Error(tr('Không còn lệnh này', 'That command is gone'));
    s.localPath(folder);
    if (action.output === 'terminal') return null;
    const job = s.jobs.spawn('action', action.name, async (ctx) => {
      await ctx.progress(1, 2, action.command, 200);
      return { action: action.name, output: action.output === 'none' ? '' : '42 total' };
    });
    return { job };
  },

  'workspaces.list': (_, s) => s.workspaces,
  'workspaces.save': ({ name, state }, s) => putWorkspace(s, name, state),
  'workspaces.rename': ({ id, name }, s) => {
    const found = s.workspaces.find((w) => w.id === id);
    if (!found) throw new Error(tr('Không có workspace này', 'There is no such workspace'));
    s.workspaces = s.workspaces.filter((w) => w.id !== id);
    putWorkspace(s, name, found.state);
    return null;
  },
  'workspaces.delete': ({ id }, s) => {
    s.workspaces = s.workspaces.filter((w) => w.id !== id);
    return null;
  },

  'history.list': (_, s) => s.history,
  'history.add': ({ uri, typed }, s) => {
    const normal = makeUri(parseUri(uri));
    const before = s.history.find((p) => p.uri === normal);
    s.history = [{ uri: normal, typed: (typed ?? false) || (before?.typed ?? false), at: Math.floor(Date.now() / 1000) }, ...s.history.filter((p) => p.uri !== normal)].slice(0, 60);
    return null;
  },
  'history.remove': ({ uri }, s) => {
    s.history = s.history.filter((p) => p.uri !== uri);
    return s.history;
  },
  'history.clear': (_, s) => {
    s.history = [];
    return [];
  },

  'tags.set': ({ uris, colour, on }, s) => {
    if (colour < 1 || colour > 7) throw new Error(tr('Không có màu thẻ này', 'There is no such tag colour'));
    const name = TAG_NAMES[colour] ?? '';
    const parents = new Set<string>();
    for (const uri of uris) {
      const path = s.localPath(uri);
      const node = s.fs.node(path);
      if (!node) throw new Error(`${tr('Không tìm thấy', 'Not found')}: ${path}`);
      const rest = (node.tags ?? []).filter(([n, c]) => c !== colour && n !== name);
      node.tags = on ? [...rest, [name, colour]] : rest;
      parents.add(parentOf(path) ?? '/');
    }
    s.changed(...parents);
    return null;
  },
} satisfies Partial<Handlers>;
