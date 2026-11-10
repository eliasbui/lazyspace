// The two sections of the sidebar: Cloud (the folders of the clouds' own apps, then what rclone signed in to, each with
// its account on a second line so two accounts of one cloud are told apart) and Servers (the saved connections).
//
// A cloud is a place: its button carries `data-uri`, `data-web` (its web page) and `data-name` (the name shown), so the
// sidebar's own menu of a place (open in a tab or a window, open on the web, hide, sign out) finds it.
import type { ReactNode } from 'react';
import { ClockIcon, CloudIcon, DatabaseIcon, EjectIcon, HardDrivesIcon, NetworkIcon, PlusIcon } from '@phosphor-icons/react';
import { IconButton, Tip } from '@/components/macos/Tip';
import { Button } from '@/components/ui/button';
import { t as word, useT } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { panes, usePanesRevision } from '@/lib/panes-api';
import { openSheet } from '@/lib/registry';
import { authorityOf, samePlace, schemeOf } from '@/lib/uri';
import { cn } from '@/lib/utils';
import type { CloudKind, Uri } from '@/services';
import { CLOUDS, SERVER_SCHEMES, serviceWord, webOf } from './kinds';
import { choose, deleteConnection, disconnect, oneDriveApp, openConnection, signIn, useRemote, type SavedConnection } from './store';

function SectionHead({ title, addLabel, onAdd }: { title: string; addLabel: string; onAdd: (rect: DOMRect) => void }) {
  return (
    <div className="group/head flex h-7 items-center justify-between pr-1 pl-2.5 text-[11px] font-semibold text-fg-3">
      <span className="truncate">{title}</span>
      <IconButton
        label={addLabel}
        icon={<PlusIcon weight="bold" />}
        size="icon-xs"
        className="text-fg-3 opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100"
        onPress={(e) => {
          const target = e.target instanceof Element ? e.target : null;
          if (target) onAdd(target.getBoundingClientRect());
        }}
      />
    </div>
  );
}

const itemClass = 'h-7 w-full justify-start gap-2 rounded-field px-2.5 text-left font-normal data-[on=true]:bg-pressed';

/** The place a pane shows is marked. */
function useHere(): Uri | null {
  usePanesRevision((s) => s.revision);
  return panes.current()?.uri ?? null;
}

function openPlace(uri: Uri, newTab: boolean): void {
  if (newTab) panes.focused()?.newTab(uri);
  else panes.open(uri);
}

/** A place in the sidebar: a click opens it in the focused pane, with Command in a new tab, the middle button in a tab behind. */
function PlaceItem({ uri, name, sub, tip, web, icon, on, className }: { uri: Uri; name: string; sub?: string; tip: string; web?: string; icon: ReactNode; on: boolean; className?: string }) {
  return (
    <Tip text={tip}>
    <Button
      variant="ghost"
      data-uri={uri}
      data-web={web || undefined}
      data-name={name}
      data-on={on}
      aria-current={on ? 'location' : undefined}
      className={cn(itemClass, sub && 'h-auto min-h-7 py-1', className)}
      onPress={(e) => openPlace(uri, e.metaKey)}
      onAuxClick={(e) => {
        const pane = panes.focused();
        if (e.button === 1 && pane) pane.newTab(uri, null, { background: true, at: pane.active + 1 });
      }}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-tint">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{name}</span>
        {sub ? <span className="truncate text-[11px] leading-tight text-fg-2">{sub}</span> : null}
      </span>
    </Button>
    </Tip>
  );
}

function OfferItem({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Button variant="ghost" className={cn(itemClass, 'text-fg-2 hover:text-fg')} onPress={onPress}>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <PlusIcon />
      </span>
      <span className="truncate">{label}</span>
    </Button>
  );
}

async function addCloud(rect: DOMRect): Promise<void> {
  const choice = await choose(
    [
      ...(['drive', 'onedrive'] as const).map((kind) => ({ id: kind, label: word(CLOUDS[kind]), icon: 'icloud' })),
      { id: 'onedrive_app', label: word('onedriveApp'), icon: 'building.2' },
      { id: 'dropbox', label: word(CLOUDS.dropbox), icon: 'icloud' },
      { separator: true },
      { id: 'other', label: word('otherCloud'), icon: 'ellipsis.circle' },
    ],
    rect.left,
    rect.bottom + 4,
  );
  // A work or school OneDrive goes through Microsoft's app; rclone's way to it (and to SharePoint) stays under Other
  // Service, for organisations that approve rclone or have an app id of their own.
  if (choice === 'onedrive_app') void oneDriveApp();
  else if (choice === 'other') openSheet('serverSheet', { cloud: 'drive' });
  else if (choice === 'drive' || choice === 'onedrive' || choice === 'dropbox') void signIn(choice);
}

export function CloudSection() {
  const t = useT();
  const role = useApp((s) => s.role);
  const local = useRemote((s) => s.local);
  const rclone = useRemote((s) => s.rclone);
  const here = useHere();
  if (role !== 'main') return null;

  const items: ReactNode[] = [];
  for (const c of local) {
    items.push(<PlaceItem key={c.uri} uri={c.uri} name={c.name} sub={c.account ?? undefined} tip={c.account ? t('cloudTip', c.name, c.account) : c.name} web={webOf(c.service, c.name, c.account)} icon={<CloudIcon />} on={samePlace(c.uri, here)} />);
    // OneDrive with the files used lately in it on this Mac, as the web's Recent has them (Spotlight's recent items under its folder).
    if (c.service === 'onedrive') {
      const recent = `search://recent=1${c.uri.slice('file://'.length)}`;
      items.push(<PlaceItem key={recent} uri={recent} name={t('cloudRecent')} tip={t('cloudRecent')} icon={<ClockIcon className="size-3.5" />} on={samePlace(recent, here)} className="h-6 pl-7 text-[12px] text-fg-2" />);
    }
  }
  for (const r of rclone.remotes) {
    const account = rclone.accounts[r];
    const service = account ? serviceWord(account.kind) : null;
    const name = service ? t(service) : r;
    const sub = account?.account || (name !== r ? r : '');
    const uri = `rclone://${encodeURIComponent(r)}/`;
    const tip = t('rcloneTip', account?.account ? t('cloudTip', name, account.account) : name, r);
    items.push(<PlaceItem key={uri} uri={uri} name={name} sub={sub} tip={tip} web={webOf(account?.kind, name, account?.account)} icon={<CloudIcon />} on={schemeOf(here) === 'rclone' && authorityOf(here ?? '') === r} />);
  }

  // With nothing yet it offers the two clouds most asked for, so signing in is found without opening a sheet.
  const offers = (
    <>
      {(['drive', 'onedrive'] satisfies CloudKind[]).map((kind) => (
        <OfferItem key={kind} label={t('addService', t(CLOUDS[kind]))} onPress={() => void signIn(kind)} />
      ))}
      <OfferItem label={t('addService', t('onedriveWork'))} onPress={() => void oneDriveApp()} />
    </>
  );

  return (
    <div data-section="cloud" className="flex flex-col">
      <SectionHead title={t('clouds')} addLabel={t('addCloud')} onAdd={(rect) => void addCloud(rect)} />
      {items.length ? items : offers}
    </div>
  );
}

const serverIcon = (c: SavedConnection): ReactNode => (c.scheme === 's3' || c.scheme === 'oss' ? <DatabaseIcon /> : ['smb', 'afp', 'nfs', 'dav', 'davs'].includes(c.scheme) ? <NetworkIcon /> : <HardDrivesIcon />);

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
  const here = useHere();
  if (role !== 'main') return null;
  const id = here && SERVER_SCHEMES.includes(schemeOf(here)) ? authorityOf(here) : null;
  return (
    <div data-section="remote" className="flex flex-col">
      <SectionHead title={t('servers')} addLabel={t('connectServer')} onAdd={() => openSheet('serverSheet')} />
      {conns.map((c) => (
        <div key={c.id} className="group/conn relative">
          <Button
            variant="ghost"
            data-on={c.id === id}
            aria-current={c.id === id ? 'location' : undefined}
            className={cn(itemClass, c.live && 'pr-8')}
            onPress={() => void openConnection(c)}
            onContextMenu={(e) => {
              e.preventDefault();
              void connectionMenu(c, e.clientX, e.clientY);
            }}
          >
            <span className="flex size-4 shrink-0 items-center justify-center text-tint">{serverIcon(c)}</span>
            <span className="truncate">{c.name}</span>
          </Button>
          {c.live ? <IconButton label={t('disconnect')} icon={<EjectIcon />} size="icon-xs" className="absolute top-1 right-1.5 text-fg-2" onPress={() => disconnect(c.id)} /> : null}
        </div>
      ))}
    </div>
  );
}
