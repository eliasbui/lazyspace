// The saved connections, the clouds rclone signed in to and the folders of the clouds' own apps, and what connecting
// and signing in take: a password or trust in a key a server shows for the first time, rclone installed first.
import { create } from 'zustand';
import { t } from '@/i18n';
import { bumpPanes, panes } from '@/lib/panes-api';
import { sidebar } from '@/lib/sidebar-api';
import { confirm, prompt, say, toast } from '@/lib/ui';
import { authorityOf, isLocal, schemeOf } from '@/lib/uri';
import { api, messageOf, on, type CloudFolder, type CloudKind, type Connection, type MenuNode, type RcloneAdvanced, type RemoteList } from '@/services';
import { PASSWORD, remoteName, SERVER_SCHEMES, TRUST } from './kinds';

export type SavedConnection = RemoteList['connections'][number];

interface RemoteState {
  conns: SavedConnection[];
  rclone: RemoteList['rclone'];
  /** The folders of the clouds' own apps. */
  local: CloudFolder[];
}

export const useRemote = create<RemoteState>(() => ({ conns: [], rclone: { installed: false, remotes: [], accounts: {}, kinds: [] }, local: [] }));

export const byId = (id: string): SavedConnection | undefined => useRemote.getState().conns.find((c) => c.id === id);

let loaded: Promise<void> = Promise.resolve();

/** Asks for the connections and the clouds again; resolves once they are in (or failed quietly, as the old page did). */
export function load(): Promise<void> {
  loaded = Promise.all([api.remote.list(), api.remote.clouds().catch((): CloudFolder[] => [])])
    .then(([list, local]) => {
      useRemote.setState({ conns: list.connections, rclone: list.rclone, local });
      // The path bars of panes on a server show the connection's name, which may have changed.
      if (panes.all().some((p) => SERVER_SCHEMES.includes(schemeOf(p.tab.uri)))) bumpPanes();
    })
    .catch(() => undefined);
  return loaded;
}

export const whenLoaded = (): Promise<void> => loaded;

/** Resolves with whether the job `id` went through once it ends; its error, if any, is shown by the jobs panel. */
function finished(id: number): Promise<boolean> {
  return new Promise((resolve) => {
    const off = on('jobs.finished', (d) => {
      if (d.id !== id) return;
      off();
      resolve(d.ok);
    });
  });
}

/** A small native menu of choices; resolves the id chosen, or null. */
export function choose(items: MenuNode[], x: number, y: number): Promise<string | null> {
  return new Promise((resolve) => {
    const done = (id: string | null) => {
      offChosen();
      offClosed();
      resolve(id);
    };
    const offChosen = on('menu.chosen', (d) => done(d.id));
    const offClosed = on('menu.closed', () => done(null));
    api.menu.show({ items, x, y }).catch(() => done(null));
  });
}

/** Signs in to a cloud through rclone, installing rclone first when it is not there, then opens the cloud in a tab. */
export async function signIn(kind: CloudKind, typed = '', advanced: RcloneAdvanced = {}): Promise<void> {
  try {
    if (!useRemote.getState().rclone.installed) {
      if (!(await confirm(t('rcloneNeeded'), t('rcloneNeededText'), t('installRclone')))) return;
      if (!(await finished((await api.remote.rcloneInstall()).job))) return;
      await load();
      if (!useRemote.getState().rclone.installed) return;
    }
    const name = typed || remoteName(kind, useRemote.getState().rclone.remotes);
    const { job } = await api.remote.rcloneAdd({ kind, name, advanced });
    toast(t('signInBrowser'));
    if (!(await finished(job))) return;
    await load();
    panes.open(`rclone://${encodeURIComponent(name)}/`);
  } catch (error) {
    say(error);
  }
}

// OneDrive for work or school through Microsoft's own app, which no organisation has to approve: the app is opened (or
// its page in the App Store), and once a OneDrive folder that was not there shows in ~/Library/CloudStorage, it opens
// in a tab.
let waitingOneDrive: ReturnType<typeof setInterval> | undefined;
export async function oneDriveApp(): Promise<void> {
  try {
    const { installed } = await api.remote.onedriveApp();
    const ok = installed ? await confirm(t('onedriveAppTitle'), t('onedriveAppText'), t('openOneDrive')) : await confirm(t('onedriveInstallTitle'), t('onedriveInstallText'), t('openStore'));
    if (!ok) return;
    const before = new Set(useRemote.getState().local.filter((c) => c.service === 'onedrive').map((c) => c.uri));
    await api.remote.onedriveOpen();
    toast(t('onedriveWaiting'));
    clearInterval(waitingOneDrive);
    const started = Date.now();
    waitingOneDrive = setInterval(() => {
      // Signing in and installing take a while; after half an hour the folder is left to show by itself.
      if (Date.now() - started > 30 * 60 * 1000) return clearInterval(waitingOneDrive);
      void api.remote
        .clouds()
        .catch(() => null)
        .then(async (clouds) => {
          const fresh = clouds?.find((c) => c.service === 'onedrive' && !before.has(c.uri));
          if (!fresh) return;
          clearInterval(waitingOneDrive);
          await load();
          toast(t('onedriveReady', fresh.name));
          panes.focused()?.newTab(fresh.uri);
        });
    }, 3000);
  } catch (error) {
    say(error);
  }
}

/** What a server asks for on the way in; resolves true when it is worth trying again. */
export async function ask(conn: Pick<Connection, 'id' | 'name' | 'host' | 'port'>, error: string): Promise<boolean> {
  if (error.startsWith(PASSWORD)) {
    const password = await prompt(t('passwordFor', conn.name), { text: error.slice(PASSWORD.length), secret: true, ok: t('connect') });
    if (password == null) return false;
    try {
      const { kept } = await api.remote.password({ id: conn.id, password });
      if (!kept) toast(t('secretNotKept'));
    } catch (e) {
      say(e);
    }
    return true;
  }
  if (error.startsWith(TRUST)) {
    const fingerprint = error.slice(TRUST.length);
    const ok = await confirm(t('trustTitle'), t('trustText', conn.port ? `${conn.host}:${conn.port}` : conn.host, fingerprint), t('trust'));
    if (!ok) return false;
    await api.remote.trust({ host: conn.host, port: conn.port || null, fingerprint }).catch(say);
    return true;
  }
  return false;
}

// One question at a time per connection, however many panes show it.
const asking = new Map<string, Promise<boolean>>();
function resolveFor(conn: SavedConnection, error: string): Promise<boolean> {
  let pending = asking.get(conn.id);
  if (!pending) {
    pending = ask(conn, error).finally(() => asking.delete(conn.id));
    asking.set(conn.id, pending);
  }
  return pending;
}

/** Connects and opens the connection's folder in the focused pane, asking what the server needs on the way. */
export async function openConnection(conn: SavedConnection): Promise<void> {
  for (let tries = 0; tries < 5; tries++) {
    try {
      const { uri } = await api.remote.connect({ id: conn.id });
      panes.open(uri);
      void load();
      // A share mounted just now is a disk of Locations too.
      if (isLocal(uri)) void sidebar.loadVolumes();
      return;
    } catch (e) {
      const error = messageOf(e);
      if (!(await resolveFor(conn, error))) {
        if (!error.startsWith(PASSWORD) && !error.startsWith(TRUST)) say(error);
        return;
      }
    }
  }
}

export function disconnect(id: string): void {
  api.remote.disconnect({ id }).then(load, say);
}

export async function deleteConnection(conn: SavedConnection): Promise<void> {
  if (await confirm(t('deleteServer'), t('deleteServerText', conn.name), t('deleteServer'))) api.remote.delete({ id: conn.id }).then(load, say);
}

/** A pane on a server that needs something lists again once it was given. */
export async function onViewError(view: string, error: string): Promise<void> {
  const found = panes.findTab(view);
  if (!found || !SERVER_SCHEMES.includes(schemeOf(found.tab.uri))) return;
  if (!error.startsWith(PASSWORD) && !error.startsWith(TRUST)) return;
  await loaded;
  const conn = byId(authorityOf(found.tab.uri));
  if (conn && (await resolveFor(conn, error))) found.pane.refresh();
}
