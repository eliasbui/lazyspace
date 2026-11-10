// Disks and devices as they come and go (src-tauri/src/features/devices.rs). The sidebar follows a disk mounted, unmounted or
// renamed, and a tab on a disk that went goes home; a note in the corner of the main window says what came, with what can
// be done with it: open or eject a disk, install the app a disk image holds and eject the image, or browse a phone or a
// camera, which macOS mounts as no disk, here (src/features/phones) or in the apps that read one. Settings can turn the
// notes off; what an eject the user asked for has to say is shown either way.
import { isWordKey, t } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { fmtSize } from '@/lib/format';
import { panes, type PaneHandle } from '@/lib/panes-api';
import { registry } from '@/lib/registry';
import { sidebar } from '@/lib/sidebar-api';
import { confirm, errorText, say, toast } from '@/lib/ui';
import { fileUri, isLocal, pathOf, schemeOf, withPath } from '@/lib/uri';
import { api, iconUrl, on, pixelRatio, type DeviceNote, type Uri, type VolumeNote } from '@/services';
import { busy, close, failed, note, volumeOf, type DeviceSymbol, type NoteAction } from './notes';
import { compareVersions } from './versions';

type ImageApp = VolumeNote['apps'][number];

const shown = (): boolean => {
  const { role, settings } = useApp.getState();
  return role === 'main' && settings?.notify_devices !== false;
};
const iconOf = (path: string, points = 36): string => iconUrl(`path:${path}`, points * pixelRatio());
const baseName = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;
const imageName = (d: VolumeNote): string => (d.image ? baseName(d.image) : d.name);
const nameOf = (path: string): string => sidebar.volumes().find((v) => v.path === path)?.name || baseName(path);
const launch = (path: string): void => void api.native.open({ uris: [fileUri(path)] }).catch(say);

/** A folder as the window writes it: Applications by its name, a folder under home from `~`. */
function folderName(path: string): string {
  if (path === '/Applications') return t('applications');
  const home = useApp.getState().places?.home;
  const root = home ? pathOf(home) : null;
  return root && (path === root || path.startsWith(`${root}/`)) ? `~${path.slice(root.length)}` : path;
}

/** What a note offers for an app of a disk image, by the version Applications has of it. */
function plan(app: ImageApp): { text: string; label: string | null; primary?: boolean } {
  if (app.installed == null) return { text: '', label: t('dev.install'), primary: true };
  if (!app.version || !app.installed) return { text: t('dev.hasSome'), label: t('dev.replace') };
  const order = compareVersions(app.version, app.installed);
  if (order > 0) return { text: t('dev.hasOlder', app.installed), label: t('dev.update', app.version), primary: true };
  if (order < 0) return { text: t('dev.hasNewer', app.installed), label: t('dev.installThis', app.version) };
  return { text: t('dev.hasSame'), label: null };
}

const openAction = (d: VolumeNote, key: string): NoteAction => ({
  label: t('dev.open'),
  run: () => {
    panes.focused()?.newTab(d.uri);
    close(key);
  },
});
const ejectActions = (d: VolumeNote): NoteAction[] => (d.ejectable ? [{ label: t('dev.eject'), run: () => void eject(d.path, d.name) }] : []);

export function volumeNote(d: VolumeNote): void {
  const key = `vol:${d.path}`;
  const named = (app: ImageApp): string => (app.version ? `${app.name} ${app.version}` : app.name);
  const [one] = d.apps;
  if (d.apps.length === 1 && one) {
    const p = plan(one);
    const first: NoteAction = p.label ? { label: p.label, primary: p.primary, run: () => void install(key, one, true) } : { label: t('dev.openApp'), run: () => launch(one.target) };
    note(key, { img: iconOf(one.path), title: named(one), text: p.text || t('dev.inImage', imageName(d)), actions: [first, openAction(d, key), ...ejectActions(d)], life: 60000, volume: d });
  } else if (d.apps.length > 1) {
    // Each app is installed on its own, and the image stays for the others.
    const rows = d.apps.map((app) => {
      const p = plan(app);
      return { img: iconOf(app.path, 20), title: named(app), text: p.text, action: p.label ? { label: p.label, primary: p.primary, run: () => void install(key, app, false) } : null };
    });
    note(key, { img: iconOf(d.path), title: d.name, text: t('dev.appsInImage', d.apps.length, imageName(d)), rows, actions: [openAction(d, key), ...ejectActions(d)], life: 60000, volume: d });
  } else if (d.packages[0]) {
    const pkg = d.packages[0];
    const run: NoteAction = { label: t('dev.runInstaller'), primary: true, run: () => void api.native.open({ uris: [pkg.uri] }).catch(say) };
    note(key, { img: iconOf(pkg.path), title: pkg.name, text: t('dev.package', imageName(d)), actions: [run, openAction(d, key), ...ejectActions(d)], life: 60000 });
  } else {
    const word = `dev.kind.${d.kind}`;
    const kind = isWordKey(word) ? t(word) : d.kind;
    const text = d.total > 0 ? t('dev.ready', kind, fmtSize(d.free), fmtSize(d.total)) : kind;
    note(key, { img: iconOf(d.path), title: d.name, text, actions: [{ ...openAction(d, key), primary: true }, ...ejectActions(d)], life: 12000 });
  }
}

// The install jobs that run, by job id, to the key of their note.
const installs = new Map<number, string>();

async function install(key: string, app: ImageApp, eject: boolean): Promise<void> {
  busy(key, t('dev.installing'));
  try {
    const { job } = await api.devices.install({ app: app.path, eject });
    installs.set(job, key);
  } catch (error) {
    failed(key, errorText(error));
  }
}

/** Ejects a disk, from its note or Cmd+E; a refusal comes as a note, with the apps that hold it when that is why, and a way to force it. */
export async function eject(path: string, name = nameOf(path)): Promise<void> {
  const key = `vol:${path}`;
  busy(key, t('dev.ejecting'));
  try {
    await api.native.eject({ path });
    close(key);
    void sidebar.loadVolumes();
  } catch (error) {
    refused(path, name, errorText(error));
  }
}

function refused(path: string, name: string, error: string): void {
  note(`vol:${path}`, {
    img: iconOf(path),
    title: t('dev.ejectFailed', name),
    text: error,
    bad: true,
    actions: [
      { label: t('dev.tryAgain'), run: () => void eject(path, name) },
      { label: t('dev.forceEject'), run: () => void forceEject(path, name) },
    ],
  });
}

async function forceEject(path: string, name: string): Promise<void> {
  if (!(await confirm(t('dev.forceTitle', name), t('dev.forceText'), t('dev.forceEject')))) return;
  busy(`vol:${path}`, t('dev.ejecting'));
  api.native.eject({ path, force: true }).then(
    () => {
      close(`vol:${path}`);
      void sidebar.loadVolumes();
    },
    (error: unknown) => refused(path, name, errorText(error)),
  );
}

/** Points tab `index` of `pane` at `uri`, as if it had gone there itself. */
function retarget(pane: PaneHandle, index: number, uri: Uri): void {
  if (index === pane.active) return pane.navigate(uri, { history: false });
  // shortcut: the panes contract cannot move a tab in the background, so it is shown for a moment and lists now instead of when shown.
  const was = pane.active;
  pane.activate(index);
  pane.navigate(uri, { history: false });
  pane.activate(was);
}

// Tabs on a disk that went go home, as Finder closes the windows of a disk it ejects; on a disk renamed they follow it to
// its new path.
function moveTabs(from: string, to: string | null): void {
  const home = useApp.getState().places?.home;
  const under = (uri: Uri): string | null => {
    const path = ['file', 'search', 'archive'].includes(schemeOf(uri)) ? pathOf(uri) : null;
    return path === from || path?.startsWith(`${from}/`) ? path : null;
  };
  for (const pane of panes.all()) {
    pane.tabs.forEach((tab, i) => {
      const path = under(tab.uri);
      if (path == null) return;
      const uri = to && schemeOf(tab.uri) !== 'archive' ? withPath(tab.uri, to + path.slice(from.length)) : home;
      if (uri) retarget(pane, i, uri);
    });
  }
  panes.saveSoon();
}

// The phones and cameras told of in this window: one plugged in every day to charge is told of once.
const told = new Set<string>();

export function deviceNote(d: DeviceNote): void {
  const who = `${d.kind}:${d.name}`;
  if (!shown() || told.has(who)) return;
  told.add(who);
  const symbol: DeviceSymbol = d.kind === 'apple' ? (/^ipad/i.test(d.name) ? 'ipad' : 'iphone') : d.kind === 'camera' ? 'camera' : 'phone.other';
  const key = `dev:${d.id}`;
  const browse: NoteAction[] = d.uri
    ? [
        {
          label: t('dev.browse'),
          run: () => {
            panes.focused()?.newTab(d.uri);
            close(key);
          },
        },
      ]
    : [];
  const helpers: NoteAction[] = d.helpers.map((h) => ({ label: h.name, run: () => void api.devices.openApp({ app: h.id }).catch(say) }));
  // Browsing it here comes first, except for a phone on MTP, which can only be read once it is set to PTP.
  const actions = (d.kind === 'mtp' ? [...helpers, ...browse] : [...browse, ...helpers]).map((a, i) => (i === 0 ? { ...a, primary: true } : a));
  note(key, { symbol, title: t('dev.connected', d.name), text: t(`dev.${d.kind}Text`, d.name), actions, life: 20000 });
}

export function register(): void {
  on('volumes.changed', (d) => {
    void sidebar.loadVolumes();
    if (d.kind === 'unmounted') {
      close(`vol:${d.path}`);
      moveTabs(d.path, null);
    } else if (d.kind === 'renamed' && d.from) {
      close(`vol:${d.from}`);
      moveTabs(d.from, d.path);
    }
  });
  on('devices.volume', (d) => shown() && volumeNote(d));
  on('devices.device', deviceNote);
  on('devices.removed', (d) => close(`dev:${d.id}`));

  on('devices.installed', (d) => {
    const volumeKey = d.volume ? `vol:${d.volume}` : null;
    const image = volumeKey ? volumeOf(volumeKey) : undefined;
    // An image with other apps stays, its row of this one now installed.
    if (image && !d.ejected && image.apps.length > 1) volumeNote({ ...image, apps: image.apps.map((app) => (app.target === d.path ? { ...app, installed: app.version || '' } : app)) });
    else if (volumeKey) close(volumeKey);
    const where = folderName(d.folder);
    const text = d.ejected ? t('dev.installedEjected', where) : d.ejectError ? t('dev.installedNotEjected', where, d.ejectError) : t('dev.installedIn', where);
    const key = `app:${d.path}`;
    const actions: NoteAction[] = [
      {
        label: t('dev.launch', d.name),
        primary: true,
        run: () => {
          launch(d.path);
          close(key);
        },
      },
    ];
    const dmg = d.image;
    if (dmg) actions.push({ label: t('dev.trashImage'), run: () => void api.fs.trash({ uris: [fileUri(dmg)] }).then(() => close(key), say) });
    note(key, { img: iconOf(d.path), title: t('dev.installed', d.name), text, actions, life: 30000 });
  });

  on('jobs.finished', (d) => {
    const key = installs.get(d.id);
    if (key == null) return;
    installs.delete(d.id);
    if (!d.ok) failed(key, 'cancelled' in d ? t('dev.installStopped') : d.error);
  });

  // Eject (Cmd+E, the File menu): the disks selected, as Finder does, else the disk of the place the pane shows.
  registry.actions.set('eject', (pane) => {
    const disks = sidebar.volumes().filter((v) => v.ejectable);
    const chosen = pane.tab.selectedEntries().flatMap((e) => disks.filter((v) => isLocal(e.uri) && pathOf(e.uri) === v.path));
    const here = isLocal(pane.tab.uri) ? pathOf(pane.tab.uri) : '';
    const holding = disks.filter((v) => here === v.path || here.startsWith(`${v.path}/`)).sort((a, b) => b.path.length - a.path.length);
    const targets = chosen.length ? chosen : holding.slice(0, 1);
    if (!targets.length) return toast(t('dev.notEjectable'));
    for (const v of targets) void eject(v.path, v.name);
  });
  registry.keys.add({ 'Cmd+E': 'eject' }, 'mac');
}
