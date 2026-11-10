// A place in the sidebar, as every section draws it (the old page's `.side-item`): a click opens it in the focused pane
// (with Command in a new tab, with the middle button in a tab behind), its menu opens it elsewhere, pins it, hides it or
// signs out of its cloud, and it is marked while the focused pane shows it. A file dropped on it is copied there (the
// sidebar finds it by `data-side-item` and `data-uri`). A section that draws its places itself gives each `data-uri`,
// `data-name` and `data-web`, and the sidebar gives it the same menu and hides it the same way.
import { createContext, useContext, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { EjectIcon, PlusIcon, PushPinIcon } from '@phosphor-icons/react';
import { t, useT } from '@/i18n';
import { setSetting, useApp } from '@/lib/app-state';
import { choose } from '@/lib/native-choice';
import { panes, usePanesRevision } from '@/lib/panes-api';
import { sidebar } from '@/lib/sidebar-api';
import { confirm, say, toast } from '@/lib/ui';
import { authorityOf, samePlace, schemeOf } from '@/lib/uri';
import { cn } from '@/lib/utils';
import { api, type MenuNode, type Settings, type Uri } from '@/services';

/** The section an item is drawn in: "quick", "bookmarks", "locations" or the id of a feature's section. */
export const SideSectionContext = createContext('');

/** The places hidden from the sidebar (clouds, devices, disks), kept in Settings as `sidebar_sections.hidden`. */
export function hiddenPlaces(settings: Settings | null): Uri[] {
  const raw = settings?.sidebar_sections;
  if (typeof raw !== 'object' || raw === null || !('hidden' in raw) || !Array.isArray(raw.hidden)) return [];
  return raw.hidden.filter((uri): uri is string => typeof uri === 'string');
}

/** Writes `patch` into Settings `sidebar_sections` whole, so that a host that replaces the value keeps the rest of it. */
export function setSidebarPrefs(patch: Record<string, unknown>): Promise<void> {
  const raw = useApp.getState().settings?.sidebar_sections;
  return setSetting({ sidebar_sections: { ...(typeof raw === 'object' && raw !== null ? raw : {}), ...patch } });
}

function setHidden(uri: Uri, on: boolean): void {
  const now = hiddenPlaces(useApp.getState().settings).filter((u) => !samePlace(u, uri));
  if (on) now.push(uri);
  void setSidebarPrefs({ hidden: now });
}

/** Clouds, devices and disks can be hidden; the pinned folders, the bookmarks and the startup disk stay. */
export const removable = (section: string, uri: Uri): boolean => section !== 'quick' && section !== 'bookmarks' && !(section === 'locations' && samePlace(uri, 'file:///'));

export interface Place {
  uri: Uri;
  /** The name shown, for the notes. */
  label: string;
  section: string;
  web?: string;
  quick?: { index: number; count: number; move: (to: number) => void };
  eject?: () => void;
  onRemoved?: () => void;
}

/** A place's own menu: open it here, in a new tab or window or on the web, move or pin it, eject, hide or sign out. */
export async function placeMenu({ uri, label, section, web, quick, eject, onRemoved }: Place, x: number, y: number): Promise<void> {
  const rclone = schemeOf(uri) === 'rclone';
  const items: MenuNode[] = [
    { id: 'open', label: t('m.open'), icon: 'arrow.up.forward.app' },
    { id: 'tab', label: t('m.openTab'), icon: 'plus.rectangle.on.rectangle' },
    { id: 'window', label: t('m.openWindow'), icon: 'macwindow.badge.plus' },
    ...(web ? [{ id: 'web', label: t('openWeb'), icon: 'globe' }] : []),
    { separator: true },
    ...(quick
      ? [
          { id: 'up', label: t('moveUp'), icon: 'arrow.up', enabled: quick.index > 0 },
          { id: 'down', label: t('moveDown'), icon: 'arrow.down', enabled: quick.index < quick.count - 1 },
          { id: 'unpin', label: t('unpinQuick'), icon: 'pin.slash' },
        ]
      : [{ id: 'pin', label: t('m.pin'), icon: 'pin' }]),
    ...(eject ? [{ separator: true }, { id: 'eject', label: t('eject'), icon: 'eject' }] : []),
    ...(removable(section, uri) ? [{ separator: true }, { id: 'hide', label: t('hideItem'), icon: 'eye.slash' }] : []),
    ...(rclone ? [{ id: 'signout', label: t('signOutCloud'), icon: 'rectangle.portrait.and.arrow.right' }] : []),
  ];
  const id = await choose(items, x, y);
  if (id === 'open') panes.open(uri);
  else if (id === 'tab') panes.focused()?.newTab(uri);
  else if (id === 'window') api.app.newWindow({ uri }).catch(say);
  else if (id === 'web' && web) api.app.openUrl({ url: web }).catch(say);
  else if (id === 'unpin') sidebar.unpin(uri);
  else if (id === 'pin') sidebar.pin(uri);
  else if ((id === 'up' || id === 'down') && quick) quick.move(quick.index + (id === 'up' ? -1 : 1));
  else if (id === 'eject') eject?.();
  else if (id === 'hide') {
    setHidden(uri, true);
    // A cloud its own app runs cannot be signed out of here.
    if (section === 'cloud' && !rclone) toast(t('appCloudNote', label));
  } else if (id === 'signout') {
    const name = authorityOf(uri);
    if (!(await confirm(t('signOutTitle', label), t('signOutText'), t('signOutCloud')))) return;
    api.remote.rcloneRemove({ name }).then(() => {
      toast(t('signOutDone', label));
      setHidden(uri, false);
      onRemoved?.();
      const home = useApp.getState().places?.home;
      for (const pane of panes.all()) if (home && schemeOf(pane.tab.uri) === 'rclone' && authorityOf(pane.tab.uri) === name) pane.navigate(home);
    }, say);
  }
}

/** The menu of a section beside its places: the places hidden from it come back. False when none is hidden. */
export function hiddenMenu(section: Element, x: number, y: number): boolean {
  const gone = [...section.querySelectorAll<HTMLElement>('[data-uri][hidden]')].map((el) => el.dataset.uri).filter((uri): uri is string => !!uri);
  if (!gone.length) return false;
  void choose([{ id: 'show', label: t('showHidden', gone.length), icon: 'eye' }], x, y).then((id) => {
    if (id === 'show') void setSidebarPrefs({ hidden: hiddenPlaces(useApp.getState().settings).filter((u) => !gone.some((g) => samePlace(g, u))) });
  });
  return true;
}

export interface SideItemProps extends Partial<Omit<Place, 'label' | 'section'>> {
  label: string;
  /** A second line under the name (the account of a cloud). */
  sub?: string;
  icon: ReactNode;
  /** The name of the icon, which Settings > Appearance colours (`data-ico`). */
  ico?: string;
  title?: string;
  /** What comes after the name: a count, a state. */
  end?: ReactNode;
  /** Whether it is marked; by default while the focused pane shows `uri`. */
  on?: boolean;
  /** For an item that is not a place (an offer to add a cloud): what a click does. */
  onPress?: () => void;
  /** A menu of its own instead of the sidebar's. */
  onContextMenu?: (e: MouseEvent<HTMLDivElement>) => void;
  className?: string;
  /** A drag offset, while it is dragged. */
  style?: CSSProperties;
}

export function SideItem({ uri, label, sub, icon, ico, title, web, end, on, onPress, onContextMenu, quick, eject, onRemoved, className, style }: SideItemProps) {
  const tr = useT();
  const section = useContext(SideSectionContext);
  usePanesRevision((s) => s.revision);
  const marked = on ?? (!!uri && samePlace(uri, panes.current()?.uri));
  const hidden = useApp((s) => !!uri && removable(section, uri) && hiddenPlaces(s.settings).some((u) => samePlace(u, uri)));

  const open = (e: MouseEvent) => {
    if (onPress) return onPress();
    if (!uri) return;
    if (e.metaKey) panes.focused()?.newTab(uri);
    else panes.open(uri);
  };

  return (
    <div
      data-side-item=""
      data-uri={uri}
      data-on={marked || undefined}
      hidden={hidden}
      title={title}
      style={style}
      onContextMenu={(e) => {
        if (onContextMenu) return onContextMenu(e);
        if (!uri) return;
        e.preventDefault();
        void placeMenu({ uri, label, section, web, quick, eject, onRemoved }, e.clientX, e.clientY);
      }}
      onAuxClick={(e) => {
        const pane = panes.focused();
        if (e.button === 1 && uri && pane) pane.newTab(uri, null, { background: true, at: pane.active + 1 });
      }}
      className={cn(
        'group/item relative flex items-center rounded-field text-[13px] transition-colors duration-(--motion-fast) hover:bg-hover data-on:bg-pressed data-drop:ring-2 data-drop:ring-tint data-drop:ring-inset',
        sub ? 'h-10' : 'h-7',
        className,
      )}
    >
      <button type="button" onClick={open} className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-field px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span data-ico={ico} aria-hidden className="grid size-4.5 shrink-0 place-items-center text-fg-2 group-data-on/item:text-tint [&_svg]:size-4">
          {icon}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate group-data-on/item:font-medium">{label}</span>
          {sub ? <span className="block truncate text-[11px] text-fg-2">{sub}</span> : null}
        </span>
        {quick ? <PushPinIcon aria-hidden weight="fill" className="size-2.5 shrink-0 text-fg-3" /> : null}
      </button>
      {end}
      {eject ? (
        <button
          type="button"
          aria-label={tr('eject')}
          title={tr('eject')}
          onClick={eject}
          className="mr-1.5 grid size-5 shrink-0 place-items-center rounded-full text-fg-2 outline-none hover:bg-pressed hover:text-fg focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
        >
          <EjectIcon weight="bold" />
        </button>
      ) : null}
    </div>
  );
}

/** The title of a section, with the small button its section may have (pin the folder open here, add a cloud). */
export function SideHead({ title, add }: { title: string; add?: { label: string; run: () => void } }) {
  return (
    <div className="group/head flex h-6.5 items-center justify-between gap-2 px-2 text-[11px] font-semibold text-fg-2">
      <span className="truncate">{title}</span>
      {add ? (
        <button
          type="button"
          aria-label={add.label}
          title={add.label}
          onClick={add.run}
          className="grid size-4.5 shrink-0 place-items-center rounded-full opacity-0 outline-none transition-opacity group-hover/head:opacity-100 hover:bg-pressed focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
        >
          <PlusIcon weight="bold" />
        </button>
      ) : null}
    </div>
  );
}
