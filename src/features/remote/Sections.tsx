// The two sections of the sidebar: Cloud (the folders of the clouds' own apps, then what rclone signed in to, each with
// its account on a second line so two accounts of one cloud are told apart) and Servers (the saved connections). Each
// cloud is a place drawn by the sidebar's own `SideItem`, which gives it the menu of a place (open elsewhere, on the web,
// hide, sign out); a sign out reloads the section.
import { ClockIcon, CloudIcon, DatabaseIcon, EjectIcon, HardDrivesIcon, NetworkIcon, PlusIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { SideHead, SideItem } from '@/components/macos/SideItem';
import { t as word, useT } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { choose } from '@/lib/native-choice';
import { usePanesRevision, panes } from '@/lib/panes-api';
import { openSheet } from '@/lib/registry';
import { authorityOf, schemeOf } from '@/lib/uri';
import type { CloudKind } from '@/services';
import { CLOUDS, SERVER_SCHEMES, serviceWord, webOf } from './kinds';
import { deleteConnection, disconnect, load, oneDriveApp, openConnection, signIn, useRemote, type SavedConnection } from './store';

/** Where a menu opened by a section's add button goes: under the button (the first button of the section). */
function underAdd(section: string): { x: number; y: number } {
  const r = document.querySelector(`[data-section="${section}"] button`)?.getBoundingClientRect();
  return r ? { x: r.left, y: r.bottom + 4 } : { x: 0, y: 0 };
}

async function addCloud(): Promise<void> {
  const { x, y } = underAdd('cloud');
  const choice = await choose(
    [
      ...(['drive', 'onedrive'] as const).map((kind) => ({ id: kind, label: word(CLOUDS[kind]), icon: 'icloud' })),
      { id: 'onedrive_app', label: word('onedriveApp'), icon: 'building.2' },
      { id: 'dropbox', label: word(CLOUDS.dropbox), icon: 'icloud' },
      { separator: true },
      { id: 'other', label: word('otherCloud'), icon: 'ellipsis.circle' },
    ],
    x,
    y,
  );
  // A work or school OneDrive goes through Microsoft's app; rclone's way to it (and to SharePoint) stays under Other
  // Service, for organisations that approve rclone or have an app id of their own.
  if (choice === 'onedrive_app') void oneDriveApp();
  else if (choice === 'other') openSheet('serverSheet', { cloud: 'drive' });
  else if (choice === 'drive' || choice === 'onedrive' || choice === 'dropbox') void signIn(choice);
}

const reload = () => void load();

export function CloudSection() {
  const t = useT();
  const role = useApp((s) => s.role);
  const local = useRemote((s) => s.local);
  const rclone = useRemote((s) => s.rclone);
  if (role !== 'main') return null;

  const items: ReactNode[] = [];
  for (const c of local) {
    items.push(<SideItem key={c.uri} uri={c.uri} label={c.name} sub={c.account ?? undefined} title={c.account ? t('cloudTip', c.name, c.account) : c.name} web={webOf(c.service, c.name, c.account) || undefined} icon={<CloudIcon />} ico="icloud" onRemoved={reload} />);
    // OneDrive with the files used lately in it on this Mac, as the web's Recent has them (Spotlight's recent items under its folder).
    if (c.service === 'onedrive') {
      const recent = `search://recent=1${c.uri.slice('file://'.length)}`;
      items.push(<SideItem key={recent} uri={recent} label={t('cloudRecent')} icon={<ClockIcon />} ico="clock" className="h-6 pl-5 text-[12px] text-fg-2" />);
    }
  }
  for (const r of rclone.remotes) {
    const account = rclone.accounts[r];
    const service = account ? serviceWord(account.kind) : null;
    const name = service ? t(service) : r;
    const uri = `rclone://${encodeURIComponent(r)}/`;
    items.push(
      <SideItem
        key={uri}
        uri={uri}
        label={name}
        sub={account?.account || (name !== r ? r : undefined)}
        title={t('rcloneTip', account?.account ? t('cloudTip', name, account.account) : name, r)}
        web={webOf(account?.kind, name, account?.account) || undefined}
        icon={<CloudIcon />}
        ico="icloud"
        onRemoved={reload}
      />,
    );
  }

  return (
    <>
      <SideHead title={t('clouds')} add={{ label: t('addCloud'), run: () => void addCloud() }} />
      {items.length ? (
        items
      ) : (
        // With nothing yet it offers the two clouds most asked for, so signing in is found without opening a sheet.
        <>
          {(['drive', 'onedrive'] satisfies CloudKind[]).map((kind) => (
            <SideItem key={kind} label={t('addService', t(CLOUDS[kind]))} icon={<PlusIcon />} onPress={() => void signIn(kind)} className="text-fg-2 hover:text-fg" />
          ))}
          <SideItem label={t('addService', t('onedriveWork'))} icon={<PlusIcon />} onPress={() => void oneDriveApp()} className="text-fg-2 hover:text-fg" />
        </>
      )}
    </>
  );
}

const serverIcon = (c: SavedConnection): { icon: ReactNode; ico: string } =>
  c.scheme === 's3' || c.scheme === 'oss' ? { icon: <DatabaseIcon />, ico: 'bucket' } : ['smb', 'afp', 'nfs', 'dav', 'davs'].includes(c.scheme) ? { icon: <NetworkIcon />, ico: 'share' } : { icon: <HardDrivesIcon />, ico: 'server' };

async function connectionMenu(conn: SavedConnection, x: number, y: number): Promise<void> {
  const choice = await choose(
    [
      { id: 'connect', label: word('connect'), icon: 'server.rack' },
      { id: 'edit', label: word('editServer'), icon: 'pencil' },
      { id: 'off', label: word('disconnect'), icon: 'eject', enabled: conn.live },
      { separator: true },
      { id: 'delete', label: word('deleteServer'), icon: 'trash' },
    ],
    x,
    y,
  );
  if (choice === 'connect') void openConnection(conn);
  else if (choice === 'edit') openSheet('serverSheet', { conn });
  else if (choice === 'off') disconnect(conn.id);
  else if (choice === 'delete') void deleteConnection(conn);
}

export function ServersSection() {
  const t = useT();
  const role = useApp((s) => s.role);
  const conns = useRemote((s) => s.conns);
  usePanesRevision((s) => s.revision);
  if (role !== 'main') return null;
  const here = panes.current()?.uri ?? '';
  const id = SERVER_SCHEMES.includes(schemeOf(here)) ? authorityOf(here) : null;
  return (
    <>
      <SideHead title={t('servers')} add={{ label: t('connectServer'), run: () => openSheet('serverSheet') }} />
      {conns.map((c) => (
        <SideItem
          key={c.id}
          label={c.name}
          {...serverIcon(c)}
          on={c.id === id}
          onPress={() => void openConnection(c)}
          onContextMenu={(e) => {
            e.preventDefault();
            void connectionMenu(c, e.clientX, e.clientY);
          }}
          end={
            c.live ? (
              <button
                type="button"
                aria-label={t('disconnect')}
                title={t('disconnect')}
                onClick={() => disconnect(c.id)}
                className="mr-1.5 grid size-5 shrink-0 place-items-center rounded-full text-fg-2 outline-none hover:bg-pressed hover:text-fg focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
              >
                <EjectIcon weight="bold" />
              </button>
            ) : null
          }
        />
      ))}
    </>
  );
}
