import type { Entry, GitStatus, PreviewInfo } from '../protocol';
import type { Handlers } from './handlers';
import type { MockState } from './state';
import { kindName } from './views';
import { baseName, extOf, fileUri, joinPath, parentOf, parseUri, validName } from './fs';
import { remove, targetPaths, targetUris, transfer, trash } from './ops';
import { fold, sleep, tr } from './util';

// The core browser: listing a folder into a tab and handing its rows out, file operations as jobs with an undo, the
// clipboard, jobs, the shelf, and the preview.

const volumeOf = (path: string): string => /^\/Volumes\/[^/]+/.exec(path)?.[0] ?? '/';

const titleOf = (verb: [string, string], paths: string[]): string =>
  paths.length === 1 ? `${tr(...verb)} "${baseName(paths[0] ?? '')}"` : `${tr(...verb)} ${paths.length} ${tr('mục', 'items')}`;

const STASH_FOLDER = '/Users/demo/Library/Application Support/LazySpace/stash';

export const browseHandlers = {
  'fs.list': ({ view, uri, sort, showHidden }, s) => ({ request: s.startList(view, uri, sort ?? s.settings.sort, showHidden ?? s.settings.show_hidden) }),

  'view.rows': ({ view, start, count, generation }, s) => s.views.rows(view, start, count, generation),
  'view.sort': ({ view, sort }, s) => {
    const generation = s.views.sort(view, sort);
    return { generation, groups: s.views.get(view).groups };
  },
  'view.filter': ({ view, text }, s) => {
    const generation = s.views.setFilter(view, text);
    const v = s.views.get(view);
    return { generation, count: v.count, groups: v.groups };
  },
  'view.hidden': ({ view, show }, s) => {
    const generation = s.views.setHidden(view, show);
    const v = s.views.get(view);
    return { generation, count: v.count, groups: v.groups };
  },
  'view.find': ({ view, prefix }, s) => ({ index: s.views.find(view, prefix) }),
  'view.index_of': ({ view, name }, s) => ({ index: s.views.indexOf(view, name) }),
  'view.close': ({ view }, s) => {
    s.views.close(view);
    return null;
  },

  'fs.sizes': ({ view, on }, s) => {
    if (on && s.views.get(view).capabilities.sizes) s.startSizes(view);
    return null;
  },
  'fs.complete': ({ text }, s) => {
    const home = s.fs.home;
    const typed = text === '~' ? `${home}/` : text.startsWith('~/') ? `${home}/${text.slice(2)}` : text;
    if (!typed.startsWith('/')) return { items: [] };
    const cut = typed.lastIndexOf('/');
    const dir = cut === 0 ? '/' : typed.slice(0, cut);
    const prefix = typed.slice(cut + 1).toLowerCase();
    let names: string[] = [];
    try {
      names = s.fs.list(dir).filter((e) => e.isDir).map((e) => e.name);
    } catch {
      return { items: [] };
    }
    const items = names
      .filter((n) => n.toLowerCase().startsWith(prefix) && (prefix.startsWith('.') || !n.startsWith('.')))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .slice(0, 20)
      .map((n) => `${dir.replace(/\/$/, '')}/${n}/`);
    return { items };
  },
  'fs.subfolders': ({ uri }, s) => {
    const entries = s.listingOf(uri).entries ?? [];
    const folders = entries.filter((e) => e.isDir && !e.hidden).sort((a, b) => fold(a.name).localeCompare(fold(b.name))).slice(0, 300);
    return { items: folders.map((e) => ({ name: e.name, uri: e.uri })) };
  },
  'fs.stat': ({ uri }, s) => {
    const parsed = parseUri(uri);
    if (parsed.scheme === 'file') return s.fs.stat(parsed.path);
    const parent = parentOf(parsed.path);
    const found = parent ? s.remoteEntries({ ...parsed, path: parent }).find((e) => e.name === baseName(parsed.path)) : undefined;
    const first = found ?? s.remoteEntries(parsed)[0];
    if (!first) throw new Error(`${tr('Không tìm thấy', 'Not found')}: ${uri}`);
    return first;
  },
  'fs.mkdir': ({ uri, name }, s) => {
    const dir = s.localPath(uri);
    const base = tr('thư mục không tên', 'untitled folder');
    const made = name ?? (s.fs.exists(joinPath(dir, base)) ? s.fs.uniqueName(dir, base, 'number') : base);
    s.fs.mkdir(dir, made, s.now);
    const path = joinPath(dir, made);
    s.push({ title: `${tr('Tạo thư mục', 'New Folder')} "${made}"`, run: () => void s.fs.remove(path) });
    s.changed(dir);
    return s.fs.stat(path);
  },
  'fs.create_file': ({ uri, name, text }, s) => {
    validName(name);
    const dir = s.localPath(uri);
    if (s.fs.exists(joinPath(dir, name))) throw new Error(`"${name}": ${tr('đã có một mục cùng tên', 'an item with that name is already there')}`);
    s.fs.file(dir, name, 0, s.now, text ?? '');
    const path = joinPath(dir, name);
    s.push({ title: `${tr('Tạo tệp', 'New File')} "${name}"`, run: () => void s.fs.remove(path) });
    s.changed(dir);
    return s.fs.stat(path);
  },
  'fs.rename': ({ uri, name }, s) => {
    validName(name);
    const path = s.localPath(uri);
    const dir = parentOf(path);
    if (!dir) throw new Error(tr('Không đổi tên được ổ đĩa', 'A disk cannot be renamed here'));
    const old = baseName(path);
    s.fs.rename(path, name);
    if (old !== name) s.push({ title: `${tr('Đổi tên', 'Rename')} "${old}"`, run: () => s.fs.rename(joinPath(dir, name), old) });
    s.changed(dir);
    return s.fs.stat(joinPath(dir, name));
  },
  'fs.read_text': ({ uri, max }, s) => {
    const path = s.localPath(uri);
    const entry = s.fs.stat(path);
    const text = s.fs.node(path)?.text ?? `${entry.name}\n${'The quick brown fox jumps over the lazy dog.\n'.repeat(12)}`;
    const cut = text.slice(0, Math.min(max ?? 1 << 20, 16 << 20));
    return { text: cut, truncated: cut.length < text.length, mtime: entry.mtime, size: entry.size };
  },
  'fs.write_text': ({ uri, text, mtime }, s) => {
    const path = s.localPath(uri);
    const node = s.fs.node(path);
    if (!node) throw new Error(`${tr('Không tìm thấy', 'Not found')}: ${path}`);
    if (mtime !== undefined && mtime !== null && node.mtime !== mtime) throw new Error(tr('Tệp đã bị sửa ở nơi khác từ lúc mở; hãy mở lại', 'The file changed elsewhere since it was opened; open it again'));
    Object.assign(node, { text, size: text.length, mtime: s.now });
    s.changed(parentOf(path) ?? '/');
    return s.fs.stat(path);
  },
  'fs.copy': ({ from, to, move, mode }, s) => {
    if (from.length === 0) throw new Error(tr('Chưa chọn mục nào', 'Nothing is selected'));
    const paths = from.map((u) => s.localPath(u));
    const dest = s.localPath(to);
    const mv = mode === 'move' ? true : mode === 'copy' ? false : mode === 'auto' ? paths.every((p) => volumeOf(p) === volumeOf(dest)) : (move ?? false);
    return { job: s.jobs.spawn(mv ? 'move' : 'copy', titleOf(mv ? ['Chuyển', 'Move'] : ['Chép', 'Copy'], paths), (ctx) => transfer(s, ctx, from, to, mv)) };
  },
  'fs.trash': (targets, s) => {
    const paths = targetPaths(s, targets);
    return { job: s.jobs.spawn('trash', titleOf(['Chuyển vào Thùng rác', 'Move to Trash'], paths), (ctx) => trash(s, ctx, paths)) };
  },
  'fs.delete': (targets, s) => {
    const paths = targetPaths(s, targets);
    return { job: s.jobs.spawn('delete', titleOf(['Xóa hẳn', 'Delete'], paths), (ctx) => remove(s, ctx, paths)) };
  },
  'fs.undo': (_, s) => {
    const step = s.undo.pop();
    if (!step) throw new Error(tr('Không có gì để hoàn tác', 'There is nothing to undo'));
    return {
      job: s.jobs.spawn('undo', `${tr('Hoàn tác', 'Undo')} ${step.title}`, async (ctx) => {
        await ctx.progress(1, 1, '', 60);
        step.run();
        return null;
      }),
    };
  },
  'fs.undo_title': (_, s) => s.undo[s.undo.length - 1]?.title ?? null,

  'clipboard.copy': (targets, s) => {
    s.clipboard = { uris: targetUris(s, targets), cut: false };
    return null;
  },
  'clipboard.cut': (targets, s) => {
    s.clipboard = { uris: targetUris(s, targets), cut: true };
    return null;
  },
  'clipboard.paste': ({ to, move }, s) => {
    const { uris, cut } = s.clipboard;
    if (uris.length === 0) throw new Error(tr('Bảng nhớ tạm không có tệp nào', 'There are no files on the clipboard'));
    const mv = (move ?? false) || cut;
    if (mv) s.clipboard = { uris: [], cut: false };
    const paths = uris.map((u) => s.localPath(u));
    return { job: s.jobs.spawn(mv ? 'move' : 'copy', titleOf(mv ? ['Chuyển', 'Move'] : ['Chép', 'Copy'], paths), (ctx) => transfer(s, ctx, uris, to, mv)) };
  },
  'clipboard.state': (_, s) => ({ cut: s.clipboard.cut ? s.clipboard.uris : [] }),
  'clipboard.text': ({ text }) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    return null;
  },

  'jobs.list': (_, s) => s.jobs.list(),
  'jobs.pause': ({ id, paused }, s) => {
    s.jobs.pause(id, paused);
    return null;
  },
  'jobs.cancel': ({ id }, s) => {
    s.jobs.cancel(id);
    return null;
  },
  'jobs.answer': ({ id, answer, applyAll }, s) => {
    s.jobs.answer(id, answer, applyAll ?? false);
    return null;
  },

  'stash.add': ({ uris }, s) => ({ added: s.addToStash(uris.map((u) => s.localPath(u))) }),
  'stash.add_data': ({ name, text, url, base64 }, s) => {
    s.fs.ensure(STASH_FOLDER, s.now);
    const wanted = name ?? (url ? 'Link.webloc' : text !== undefined && text !== null ? 'Clipping.txt' : 'Pasted file');
    const unique = s.fs.exists(joinPath(STASH_FOLDER, wanted)) ? s.fs.uniqueName(STASH_FOLDER, wanted) : wanted;
    s.fs.file(STASH_FOLDER, unique, base64 ? Math.floor(base64.length * 0.75) : 0, s.now, base64 ? undefined : (url ?? text ?? ''));
    return { added: s.addToStash([joinPath(STASH_FOLDER, unique)]) };
  },
  'stash.add_clipboard': (_, s) => {
    if (s.clipboard.uris.length > 0) return { added: s.addToStash(s.clipboard.uris.map((u) => s.localPath(u))) };
    s.fs.ensure(STASH_FOLDER, s.now);
    s.fs.file(STASH_FOLDER, 'Clipboard text.txt', 0, s.now, 'Text from the clipboard');
    return { added: s.addToStash([joinPath(STASH_FOLDER, 'Clipboard text.txt')]) };
  },
  'stash.remove': ({ uris }, s) => {
    const gone = new Set(uris.map((u) => s.localPath(u)));
    s.stash = s.stash.filter((p) => !gone.has(p));
    s.stashChanged();
    return null;
  },
  'stash.clear': (_, s) => {
    s.stash = [];
    s.stashChanged();
    return null;
  },
  'stash.count': (_, s) => s.stashEntries().length,
  'stash.items': (_, s) => s.stashEntries(),
  'stash.show': () => null,

  'preview.info': ({ uri }, s) => {
    sleep(20).then(() => s.emit('preview.ready', previewOf(s, uri)));
    return null;
  },
  'git.status': ({ uri }, s) => gitStatus(s.localPath(uri)),
} satisfies Partial<Handlers>;

const IMAGES = ['png', 'jpg', 'jpeg', 'heic', 'gif', 'webp', 'svg'];
const VIDEOS = ['mp4', 'mov', 'm4v', 'webm'];
const AUDIOS = ['mp3', 'm4a', 'wav', 'flac'];
const TEXTS = ['txt', 'md', 'json', 'csv', 'ts', 'tsx', 'js', 'html', 'sh', 'py', 'log'];

function previewOf(s: MockState, uri: string): PreviewInfo | { uri: string; error: string } {
  try {
    const parsed = parseUri(uri);
    const entry: Entry | undefined = parsed.scheme === 'file' ? s.fs.stat(parsed.path) : s.remoteEntries(parsed)[0];
    if (!entry) throw new Error(`${tr('Không tìm thấy', 'Not found')}: ${uri}`);
    const type = kindName(entry);
    const ext = extOf(entry.name);
    if (entry.isDir) {
      const count = parsed.scheme === 'file' ? (s.fs.node(parsed.path)?.children?.size ?? null) : null;
      return { uri, kind: 'folder', type, entry, items: count };
    }
    const kind = IMAGES.includes(ext) ? 'image' : VIDEOS.includes(ext) ? 'video' : AUDIOS.includes(ext) ? 'audio' : ext === 'pdf' ? 'pdf' : TEXTS.includes(ext) ? 'text' : 'other';
    const info: PreviewInfo = { uri, kind: entry.kind === 'app' || entry.kind === 'package' ? 'other' : kind, type, entry, local: uri };
    if (kind === 'video') info.media = { duration: 213.4, video: { width: 1920, height: 1080, fps: 29.97, dataRate: 8_200_000 }, audio: { dataRate: 128_000 } };
    if (kind === 'audio') info.media = { duration: 187.2, audio: { dataRate: 256_000 } };
    if (kind === 'text') info.editable = entry.size <= 1 << 20;
    return info;
  } catch (error) {
    return { uri, error: error instanceof Error ? error.message : String(error) };
  }
}

const REPO = '/Users/demo/Projects/lazyspace';

function gitStatus(folder: string): GitStatus | null {
  if (folder !== REPO && !folder.startsWith(`${REPO}/`)) return null;
  const items: GitStatus['items'] = folder === REPO ? { src: 'M', 'package.json': 'M', 'notes-todo.txt': '?' } : folder === `${REPO}/src` ? { 'App.tsx': 'M', 'client.ts': 'A' } : {};
  return { root: fileUri(REPO), branch: 'main', items };
}
