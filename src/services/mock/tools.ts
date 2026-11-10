import type { CloudKind, DiskNode, HashResult, SyncAction, SyncPair, SyncSide, SyncState, TwinGroup } from '../protocol';
import { phones } from './fixtures';
import { type Node, baseName, fileUri, joinPath, makeUri, parentOf } from './fs';
import type { Handlers } from './handlers';
import { targetPaths, targetUris } from './ops';
import { plan } from './rename';
import type { MockState } from './state';
import { hexOf, sleep, tr } from './util';

// The features that work on files as jobs: batch rename, archives, hashes, the disk map, twins, sync; and the devices
// and servers.

const CLOUD_KINDS: CloudKind[] = ['drive', 'dropbox', 'onedrive', 'onedrive_work', 'sharepoint', 'box', 'pcloud', 'mega', 'yandex', 'koofr', 'jottacloud', 'sharefile'];
const SCHEMES = ['sftp', 'ftp', 'ftps', 's3', 'oss', 'smb', 'afp', 'nfs', 'dav', 'davs'];
const MB = 1_048_576;

function renameItems(s: MockState, targets: Parameters<Handlers['rename.preview']>[0]): { paths: string[]; rows: ReturnType<typeof plan> } {
  const paths = targetPaths(s, targets);
  const items = paths.map((p) => {
    const e = s.fs.stat(p);
    return { name: e.name, isDir: e.kind === 'dir', parent: baseName(parentOf(p) ?? '/') };
  });
  const taken = new Set(s.fs.list(parentOf(paths[0] ?? '/') ?? '/').map((e) => e.name));
  return { paths, rows: plan(targets.rules, items, taken) };
}

function compareTrees(s: MockState, left: string, right: string, options: NonNullable<Parameters<Handlers['sync.compare']>[0]['options']>): SyncPair[] {
  const collect = (root: string): Map<string, Node> => {
    const out = new Map<string, Node>();
    s.fs.walk(root, (path, node) => {
      if (options.ignoreHidden && path.slice(root.length + 1).split('/').some((p) => p.startsWith('.'))) return;
      out.set(path.slice(root.length + 1), node);
    });
    return out;
  };
  const [l, r] = [collect(left), collect(right)];
  const side = (n: Node | undefined): SyncSide | null => (n ? { size: n.kind === 'file' ? n.size : 0, mtime: n.mtime, isDir: n.kind === 'dir' } : null);
  const mode = options.mode ?? 'ltr';
  const propose = (state: SyncState): SyncAction => {
    if (state === 'same') return 'skip';
    if (mode === 'ltr') return state === 'leftOnly' || state === 'leftNewer' || state === 'conflict' ? 'ltr' : state === 'rightOnly' && options.mirror ? 'deleteRight' : 'skip';
    if (mode === 'rtl') return state === 'rightOnly' || state === 'rightNewer' || state === 'conflict' ? 'rtl' : state === 'leftOnly' && options.mirror ? 'deleteLeft' : 'skip';
    return state === 'leftOnly' || state === 'leftNewer' ? 'ltr' : state === 'rightOnly' || state === 'rightNewer' ? 'rtl' : 'skip';
  };
  const pairs: SyncPair[] = [];
  for (const rel of [...new Set([...l.keys(), ...r.keys()])].sort()) {
    const a = l.get(rel);
    const b = r.get(rel);
    let state: SyncState;
    if (a && !b) state = 'leftOnly';
    else if (b && !a) state = 'rightOnly';
    else if (a && b) {
      const close = Math.abs(a.mtime - b.mtime) <= 2;
      if (a.kind === 'dir' || b.kind === 'dir') state = 'same';
      else if (a.size === b.size && (close || options.content)) state = 'same';
      else state = close ? 'conflict' : a.mtime > b.mtime ? 'leftNewer' : 'rightNewer';
    } else continue;
    if (state === 'same' && a?.kind === 'dir') continue;
    pairs.push({ rel, left: side(a), right: side(b), state, action: propose(state) });
  }
  return pairs;
}

function disk(s: MockState, path: string, name: string, depth: number): DiskNode {
  const node = s.fs.node(path);
  const size = s.fs.total(path);
  const out: DiskNode = { name, path, size, dir: node?.kind === 'dir' };
  if (node?.kind !== 'dir') return depth === 0 ? { ...out, children: [] } : out;
  const kids = [...(node.children?.values() ?? [])].map((k) => disk(s, joinPath(path, k.name), k.name, depth - 1)).sort((a, b) => b.size - a.size);
  const shown = kids.slice(0, 16);
  const rest = kids.slice(16).reduce((sum, k) => sum + k.size, 0);
  if (rest > 0) shown.push({ name: tr('Các mục khác', 'Other items'), size: rest, other: true });
  return { ...out, children: depth > 0 ? shown : [] };
}

export const toolsHandlers = {
  'rename.preview': (args, s) => {
    const { rows } = renameItems(s, args);
    return { rows: rows.slice(0, 1000), total: rows.length, problems: rows.filter((r) => r.problem).length, changed: rows.filter((r) => r.to !== r.from).length };
  },
  'rename.apply': (args, s) => {
    const { paths, rows } = renameItems(s, args);
    const bad = rows.find((r) => r.problem);
    if (bad) throw new Error(`"${bad.to}": ${bad.problem}`);
    const pairs = rows.flatMap((r, i) => (r.to !== r.from ? [[paths[i] ?? '', r.to] as const] : []));
    if (pairs.length === 0) throw new Error(tr('Không có tên nào thay đổi', 'No name changes'));
    const dir = parentOf(pairs[0]?.[0] ?? '/') ?? '/';
    const title = `${tr('Đổi tên', 'Rename')} ${pairs.length} ${tr('mục', 'items')}`;
    return {
      job: s.jobs.spawn('rename', title, async (ctx) => {
        // Two phases, as the host does, so a name taken by another item of the batch is free by then.
        const nodes = pairs.map(([path]) => s.fs.remove(path));
        pairs.forEach(([path, to], i) => {
          const node = nodes[i];
          if (node) s.fs.add(parentOf(path) ?? '/', { ...node, name: to });
        });
        await ctx.progress(1, 1, '', 80);
        s.push({
          title,
          run: () => {
            const back = pairs.map(([path, to]) => s.fs.remove(joinPath(parentOf(path) ?? '/', to)));
            pairs.forEach(([path], i) => {
              const node = back[i];
              if (node) s.fs.add(parentOf(path) ?? '/', { ...node, name: baseName(path) });
            });
            s.changed(dir);
          },
        });
        s.changed(dir);
        return { names: pairs.map(([, to]) => to), to: fileUri(dir) };
      }),
    };
  },

  'archive.create': (args, s) => {
    const sources = targetPaths(s, args);
    if (args.password && args.format !== 'zip' && args.format !== '7z') throw new Error(tr('Chỉ zip và 7z mới đặt được mật khẩu', 'Only zip and 7z take a password'));
    const folder = parentOf(sources[0] ?? '/') ?? '/';
    const base = args.name?.trim() || (sources.length === 1 ? baseName(sources[0] ?? '') : tr('Lưu trữ', 'Archive'));
    const wanted = `${base}.${args.format}`;
    const file = s.fs.exists(joinPath(folder, wanted)) ? s.fs.uniqueName(folder, wanted) : wanted;
    return {
      job: s.jobs.spawn('archive.create', `${tr('Nén', 'Compress')} "${file}"`, async (ctx) => {
        const total = sources.reduce((sum, p) => sum + s.fs.total(p), 0);
        for (const [i, path] of sources.entries()) await ctx.progress(i + 1, sources.length, baseName(path), 120);
        const size = Math.max(1024, Math.floor(total * 0.55));
        const split = (args.splitMb ?? 0) * MB;
        const names = split > 0 && size > split ? Array.from({ length: Math.min(8, Math.ceil(size / split)) }, (_, i) => `${file}.${String(i + 1).padStart(3, '0')}`) : [file];
        names.forEach((n) => s.fs.file(folder, n, split > 0 ? Math.min(size, split) : size, s.now));
        s.changed(folder);
        return { names, to: fileUri(folder) };
      }),
    };
  },
  'archive.extract': (args, s) => {
    const archives = targetPaths(s, args);
    const dest = args.to ? s.localPath(args.to) : null;
    return {
      job: s.jobs.spawn('archive.extract', `${tr('Giải nén', 'Extract')} ${archives.length === 1 ? `"${baseName(archives[0] ?? '')}"` : `${archives.length} ${tr('tệp', 'archives')}`}`, async (ctx) => {
        const names: string[] = [];
        let to: string | null = null;
        for (const [i, archive] of archives.entries()) {
          const into = dest ?? parentOf(archive) ?? '/';
          const stem = baseName(archive).replace(/\.(tar\.(gz|xz|bz2)|[a-z0-9]+)$/i, '');
          const name = s.fs.exists(joinPath(into, stem)) ? s.fs.uniqueName(into, stem, 'number') : stem;
          s.fs.mkdir(into, name, s.now);
          for (const n of ['readme.txt', 'data.csv', 'image.png']) s.fs.file(joinPath(into, name), n, 40_000, s.now - 86_400);
          await ctx.progress(i + 1, archives.length, baseName(archive), 150);
          names.push(name);
          to = fileUri(into);
          s.changed(into);
        }
        return { names, to };
      }),
    };
  },
  'archive.password': ({ password }) => {
    if (!password) throw new Error(tr('Sai mật khẩu', 'Wrong password'));
    return null;
  },

  'hash.start': (args, s) => {
    const uris = targetUris(s, args);
    const entries = uris.map((u) => ({ uri: u, entry: s.fs.stat(s.localPath(u)) })).filter((x) => x.entry.kind === 'file');
    if (entries.length === 0) throw new Error(tr('Hãy chọn tệp, không phải thư mục', 'Choose files, not folders'));
    const title = entries.length === 1 ? `${tr('Tính mã băm', 'Hash')} "${entries[0]?.entry.name}"` : `${tr('Tính mã băm', 'Hash')} ${entries.length} ${tr('tệp', 'files')}`;
    const job = s.jobs.spawn('hash', title, async (ctx) => {
      const results: HashResult[] = [];
      for (const [i, { uri, entry }] of entries.entries()) {
        await ctx.progress(i, entries.length, entry.name, 200);
        const seed = s.fs.node(s.localPath(uri))?.digest ?? uri;
        const result: HashResult = {
          uri,
          name: entry.name,
          size: entry.size,
          hashes: { md5: hexOf(seed, 32), sha1: hexOf(seed, 40), sha224: hexOf(seed, 56), sha256: hexOf(seed, 64), sha384: hexOf(seed, 96), sha512: hexOf(seed, 128), crc32: hexOf(seed, 8) },
        };
        ctx.emit('hash.result', { job: ctx.id, result });
        results.push(result);
      }
      await ctx.progress(entries.length, entries.length, '', 0);
      return results;
    });
    s.emit('hash.started', { job });
    return { job };
  },

  'disk.map': ({ uri }, s) => {
    const path = s.localPath(uri);
    s.fs.folder(path);
    return {
      job: s.jobs.spawn('disk', `${tr('Đo dung lượng', 'Measure')} "${baseName(path)}"`, async (ctx) => {
        await ctx.progress(1, 3, path, 250);
        await ctx.progress(2, 3, path, 250);
        return { map: disk(s, path, baseName(path), 2) };
      }),
    };
  },
  'disk.twins': ({ uri }, s) => {
    const path = s.localPath(uri);
    s.fs.folder(path);
    return {
      job: s.jobs.spawn('twins', `${tr('Tìm tệp trùng trong', 'Find twins in')} "${baseName(path)}"`, async (ctx) => {
        const byDigest = new Map<string, Array<{ path: string; size: number }>>();
        s.fs.walk(path, (p, n) => {
          if (n.kind === 'file' && n.digest) byDigest.set(n.digest, [...(byDigest.get(n.digest) ?? []), { path: p, size: n.size }]);
        });
        await ctx.progress(1, 2, path, 300);
        const twins: TwinGroup[] = [...byDigest.values()].filter((g) => g.length > 1).map((g) => ({ size: g[0]?.size ?? 0, uris: g.map((x) => fileUri(x.path)).sort() }));
        twins.sort((a, b) => b.size * (b.uris.length - 1) - a.size * (a.uris.length - 1));
        return { twins, folder: uri };
      }),
    };
  },

  'sync.compare': ({ left, right, options }, s) => {
    const [l, r] = [s.localPath(left), s.localPath(right)];
    if (l === r || r.startsWith(`${l}/`) || l.startsWith(`${r}/`)) throw new Error(tr('Hai thư mục không được nằm trong nhau', 'One folder cannot be inside the other'));
    return {
      job: s.jobs.spawn('sync.compare', `${tr('So sánh', 'Compare')} "${baseName(l)}" - "${baseName(r)}"`, async (ctx) => {
        await ctx.progress(1, 2, l, 300);
        const pairs = compareTrees(s, l, r, options ?? {});
        return { pairs, same: pairs.filter((p) => p.state === 'same').length, truncated: false };
      }),
    };
  },
  'sync.apply': ({ left, right, steps }, s) => {
    const [l, r] = [s.localPath(left), s.localPath(right)];
    const todo = steps.filter((x) => x.action !== 'skip');
    if (todo.length === 0) throw new Error(tr('Không có gì để đồng bộ', 'There is nothing to sync'));
    return {
      job: s.jobs.spawn('sync.apply', `${tr('Đồng bộ', 'Sync')} ${todo.length} ${tr('mục', 'items')}`, async (ctx) => {
        const copy = (from: string, to: string): void => {
          const source = s.fs.node(from);
          if (!source) return;
          const dir = parentOf(to) ?? '/';
          s.fs.ensure(dir, s.now);
          if (s.fs.node(to)) s.fs.remove(to);
          s.fs.copy(from, dir, baseName(to), source.mtime);
        };
        for (const [i, step] of todo.entries()) {
          if (ctx.cancelled()) throw new Error('cancelled');
          await ctx.progress(i, todo.length, step.rel, 90);
          const [a, b] = [joinPath(l, step.rel), joinPath(r, step.rel)];
          if (step.action === 'ltr') copy(a, b);
          else if (step.action === 'rtl') copy(b, a);
          else if (step.action === 'deleteLeft' && s.fs.node(a)) s.fs.remove(a);
          else if (step.action === 'deleteRight' && s.fs.node(b)) s.fs.remove(b);
        }
        s.changed(l, r);
        return { done: todo.length };
      }),
    };
  },

  'devices.phones': () => phones(),
  'devices.open_app': ({ app }) => {
    if (!['photos', 'image-capture', 'finder'].includes(app)) throw new Error(`${tr('Ứng dụng không rõ', 'Unknown app')}: ${app}`);
    return null;
  },
  'devices.install': ({ app, eject }, s) => {
    const name = baseName(app);
    if (!name.toLowerCase().endsWith('.app')) throw new Error(`"${name}": ${tr('không phải một ứng dụng', 'is not an app')}`);
    const stem = name.replace(/\.app$/i, '');
    return {
      job: s.jobs.spawn('copy', `${tr('Cài', 'Install')} ${stem}`, async (ctx) => {
        for (let i = 1; i <= 5; i++) await ctx.progress(i, 5, name, 150);
        if (s.fs.node(joinPath('/Applications', name))) s.fs.remove(joinPath('/Applications', name));
        s.fs.add('/Applications', { name, kind: 'app', size: 0, mtime: s.now, ctime: s.now, hidden: false, children: new Map() });
        s.changed('/Applications');
        const volume = /^\/Volumes\/[^/]+/.exec(app)?.[0] ?? null;
        const result = { name: stem, path: joinPath('/Applications', name), uri: fileUri(joinPath('/Applications', name)), folder: '/Applications', volume, image: volume ? `${s.fs.home}/Downloads/${stem}.dmg` : null, ejected: Boolean(volume) && (eject ?? true), ejectError: null };
        s.emit('devices.installed', result);
        return result;
      }),
    };
  },

  'remote.list': (_, s) => ({
    connections: s.connections.map((c) => ({ ...c, live: s.live.has(c.id) })),
    rclone: { installed: s.rclone.installed, remotes: s.rclone.remotes, accounts: s.rclone.accounts, kinds: CLOUD_KINDS },
  }),
  'remote.clouds': (_, s) => s.clouds,
  'remote.save': ({ connection }, s) => {
    if (!connection.scheme || !SCHEMES.includes(connection.scheme)) throw new Error(tr('Loại kết nối không hợp lệ', 'Not a valid kind of connection'));
    if (!connection.name?.trim()) throw new Error(tr('Hãy đặt tên cho kết nối', 'Give the connection a name'));
    const base = { id: '', name: '', scheme: connection.scheme, host: '', port: null, user: '', path: '', region: '', endpoint: '', bucket: '', keyFile: '', guest: false };
    const saved = { ...base, ...connection, id: connection.id || hexOf(`${s.now}${s.connections.length}`, 6) };
    s.connections = s.connections.some((c) => c.id === saved.id) ? s.connections.map((c) => (c.id === saved.id ? saved : c)) : [...s.connections, saved];
    return { connection: saved, kept: true };
  },
  'remote.delete': ({ id }, s) => {
    s.connections = s.connections.filter((c) => c.id !== id);
    s.live.delete(id);
    return null;
  },
  'remote.connect': async ({ id }, s) => {
    const conn = s.connections.find((c) => c.id === id);
    if (!conn) throw new Error(tr('Kết nối này không còn nữa', 'This connection is not there any more'));
    await sleep(250);
    s.live.add(id);
    return { uri: makeUri({ scheme: conn.scheme, authority: id, path: conn.scheme === 's3' || conn.scheme === 'oss' ? conn.bucket || '/' : conn.path || '/' }) };
  },
  'remote.disconnect': ({ id }, s) => {
    s.live.delete(id);
    return null;
  },
  'remote.test': async ({ connection }) => {
    await sleep(350);
    if (!connection.host && connection.scheme !== 's3' && connection.scheme !== 'oss') throw new Error(tr('Hãy nhập địa chỉ máy chủ', 'Enter the address of the server'));
    return null;
  },
  'remote.password': ({ password }) => {
    if (!password) throw new Error(tr('Sai mật khẩu', 'Wrong password'));
    return { kept: true };
  },
  'remote.trust': ({ fingerprint }) => {
    if (!fingerprint.startsWith('SHA256:')) throw new Error(tr('Dấu vân tay không hợp lệ', 'Not a valid fingerprint'));
    return null;
  },
  'remote.onedrive_app': () => ({ installed: false }),
  'remote.onedrive_open': () => ({ opened: 'store' }),
  'remote.rclone_install': (_, s) => ({
    job: s.jobs.spawn('cloud', tr('Đang cài rclone', 'Installing rclone'), async (ctx) => {
      for (let i = 1; i <= 4; i++) await ctx.progress(i, 4, 'brew install rclone', 250);
      s.rclone.installed = true;
      return null;
    }),
  }),
  'remote.rclone_add': ({ kind, name }, s) => {
    if (!CLOUD_KINDS.includes(kind)) throw new Error(tr('Không có loại đám mây này', 'There is no such cloud'));
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(tr('Tên chỉ gồm chữ không dấu, số, - và _', 'A name may only have plain letters, digits, - and _'));
    return {
      job: s.jobs.spawn('cloud', `${tr('Đăng nhập', 'Signing in to')} ${name}`, async (ctx) => {
        await ctx.progress(0, 0, tr('Đang chờ trình duyệt', 'Waiting for the browser'), 500);
        const account = { backend: kind === 'drive' ? 'drive' : kind, kind, account: 'demo@example.com' };
        s.rclone.remotes = [...s.rclone.remotes.filter((r) => r !== name), name];
        s.rclone.accounts = { ...s.rclone.accounts, [name]: account };
        s.emit('remote.changed', null);
        return { remote: name, account };
      }),
    };
  },
  'remote.rclone_remove': ({ name }, s) => {
    s.rclone.remotes = s.rclone.remotes.filter((r) => r !== name);
    const { [name]: _gone, ...rest } = s.rclone.accounts;
    s.rclone.accounts = rest;
    return null;
  },
} satisfies Partial<Handlers>;
