// The sidebar: the folders pinned to Quick Access, the well-known folders under Bookmarks, the sections features add, the
// disks under Locations. It floats as a pane of glass and holds the window's buttons at its top.
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import {
  AppWindowIcon,
  ArrowCircleDownIcon,
  ClockIcon,
  DesktopIcon,
  FileTextIcon,
  FilmStripIcon,
  FolderIcon,
  GlobeIcon,
  HardDriveIcon,
  HardDrivesIcon,
  HouseIcon,
  ImageIcon,
  MusicNotesIcon,
  TrashIcon,
  type Icon,
} from '@phosphor-icons/react';
import { GlassPanel } from '@/components/macos/Glass';
import { hiddenMenu, hiddenPlaces, placeMenu, removable, SideHead, SideItem, SideSectionContext } from '@/components/macos/SideItem';
import { useT, type WordKey } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { registry, useRegistry } from '@/lib/registry';
import { fileUri, isLocal, nameOf, samePlace } from '@/lib/uri';
import { cn } from '@/lib/utils';
import { on, type Places, type Uri } from '@/services';
import { clampWidth, ejectDisk, loadVolumes, MAX_WIDTH, MIN_WIDTH, pinHere, reorder, setWidth, useSidebar } from './store';

const BOOKMARKS: Array<[place: keyof Places, icon: Icon, ico: string, word: WordKey | null]> = [
  ['recents', ClockIcon, 'clock', 'recents'],
  ['desktop', DesktopIcon, 'desktop', 'desktop'],
  ['downloads', ArrowCircleDownIcon, 'download', 'downloads'],
  ['documents', FileTextIcon, 'doc', 'documents'],
  ['movies', FilmStripIcon, 'film', 'movies'],
  ['music', MusicNotesIcon, 'music', 'music'],
  ['pictures', ImageIcon, 'photo', 'pictures'],
  ['home', HouseIcon, 'house', null],
  ['applications', AppWindowIcon, 'app', 'applications'],
  ['trash', TrashIcon, 'trash', 'trashName'],
];

const NO_PINS: Uri[] = [];

function QuickAccess() {
  const t = useT();
  const pins = useApp((s) => s.settings?.favourites) ?? NO_PINS;
  const fresh = useSidebar((s) => s.fresh);
  const [drag, setDrag] = useState<{ from: number; dy: number } | null>(null);
  // The click that ends a drag opens nothing.
  const dragged = useRef(false);

  useEffect(() => {
    if (!fresh.length) return;
    const timer = setTimeout(() => useSidebar.setState({ fresh: [] }), 1000);
    return () => clearTimeout(timer);
  }, [fresh]);

  // A pinned folder dragged up or down the list takes the place it is let go at.
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    const row = e.button === 0 && e.target instanceof Element ? e.target.closest<HTMLElement>('[data-quick]') : null;
    if (!row) return;
    const from = Number(row.dataset.quick);
    const height = row.getBoundingClientRect().height;
    const startY = e.clientY;
    let to = from;
    let moving = false;
    const move = (m: PointerEvent) => {
      const dy = m.clientY - startY;
      if (!moving && Math.abs(dy) < 5) return;
      moving = true;
      to = Math.min(pins.length - 1, Math.max(0, from + Math.round(dy / height)));
      setDrag({ from, dy });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (!moving) return;
      dragged.current = true;
      setTimeout(() => (dragged.current = false), 0);
      reorder(from, to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      onPointerDown={down}
      onClickCapture={(e) => {
        if (!dragged.current) return;
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <SideHead title={t('quickAccess')} add={{ label: t('pinQuick'), run: pinHere }} />
      {pins.length ? (
        pins.map((uri, i) => (
          <div key={uri} data-quick={i}>
            <SideItem
              uri={uri}
              icon={isLocal(uri) ? <FolderIcon /> : <GlobeIcon />}
              ico={isLocal(uri) ? 'folder' : 'network'}
              label={registry.places.nameOf(uri)}
              quick={{ index: i, count: pins.length, move: (to) => reorder(i, to) }}
              className={cn(drag?.from === i && 'z-10 glass-pop transition-none', fresh.includes(uri) && 'animate-[arrive_900ms_var(--ease-out)]')}
              style={drag?.from === i ? { transform: `translateY(${drag.dy}px)` } : undefined}
            />
          </div>
        ))
      ) : (
        <p className="mb-0.5 rounded-field border border-dashed border-hair-2 px-2.5 py-1.5 text-[11px] leading-snug text-fg-3">{t('quickEmpty')}</p>
      )}
    </div>
  );
}

function Bookmarks() {
  const t = useT();
  const places = useApp((s) => s.places);
  return (
    <>
      <SideHead title={t('bookmarks')} />
      {BOOKMARKS.map(([place, PlaceIcon, ico, word]) => {
        const uri = places?.[place];
        return uri ? <SideItem key={place} uri={uri} icon={<PlaceIcon />} ico={ico} label={word ? t(word) : nameOf(uri)} /> : null;
      })}
    </>
  );
}

function Locations() {
  const t = useT();
  const volumes = useSidebar((s) => s.volumes);
  const ejecting = useSidebar((s) => s.ejecting);
  return (
    <>
      <SideHead title={t('locations')} />
      {volumes.map((v) => (
        <SideItem
          key={v.path}
          uri={fileUri(v.path)}
          icon={v.internal ? <HardDriveIcon /> : <HardDrivesIcon />}
          ico={v.internal ? 'drive' : 'drive.external'}
          label={v.name}
          eject={v.ejectable ? () => void ejectDisk(v.path, v.name) : undefined}
          className={cn(ejecting.includes(v.path) && 'opacity-50')}
        />
      ))}
    </>
  );
}

/** The sections in their order: Quick Access first, then Bookmarks (10), the features' sections, Locations (90). */
function Sections() {
  const t = useT();
  const extra = useRegistry((s) => s.sidebar);
  const list: Array<{ id: string; order: number; title: string | null; node: ReactNode }> = [
    { id: 'quick', order: 5, title: t('quickAccess'), node: <QuickAccess /> },
    { id: 'bookmarks', order: 10, title: t('bookmarks'), node: <Bookmarks /> },
    ...extra.map(({ id, order, title, Component }) => ({
      id,
      order,
      title: title ? t(title) : null,
      node: (
        <>
          {title ? <SideHead title={t(title)} /> : null}
          <Component />
        </>
      ),
    })),
    { id: 'locations', order: 90, title: t('locations'), node: <Locations /> },
  ].sort((a, b) => a.order - b.order);
  // What is dropped on Quick Access is pinned (the panes' drop code reads `data-drop-quick` and lights `data-drop`).
  return list.map((s) => (
    <div key={s.id} data-section={s.id} data-drop-quick={s.id === 'quick' ? '' : undefined} role="group" aria-label={s.title ?? undefined} className="mt-2.5 rounded-field first:mt-0 empty:hidden data-drop:ring-2 data-drop:ring-tint data-drop:ring-inset">
      <SideSectionContext value={s.id}>{s.node}</SideSectionContext>
    </div>
  ));
}

// The places a feature's section draws itself carry `data-uri`, `data-name` and `data-web`: they get the menu of a place,
// and a right click beside them in their section brings back the places hidden from it.
function sectionMenu(e: MouseEvent<HTMLDivElement>): void {
  if (e.defaultPrevented || !(e.target instanceof Element)) return;
  const section = e.target.closest<HTMLElement>('[data-section]');
  const id = section?.dataset.section;
  if (!section || !id) return;
  const place = e.target.closest<HTMLElement>('[data-uri]');
  const uri = place?.dataset.uri;
  if (place && uri) {
    e.preventDefault();
    void placeMenu({ uri, label: place.dataset.name ?? registry.places.nameOf(uri), web: place.dataset.web, section: id }, e.clientX, e.clientY);
  } else if (hiddenMenu(section, e.clientX, e.clientY)) e.preventDefault();
}

/**
 * The places that features draw themselves, as they are drawn: hidden when hidden from the sidebar, and a target of drops
 * (SideItem does both for its own).
 */
function useFeaturePlaces(root: RefObject<HTMLElement | null>): void {
  const settings = useApp((s) => s.settings);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const apply = () => {
      const hidden = hiddenPlaces(settings);
      for (const place of el.querySelectorAll<HTMLElement>('[data-uri]:not([data-side-item])')) {
        const uri = place.dataset.uri ?? '';
        const hide = removable(place.closest<HTMLElement>('[data-section]')?.dataset.section ?? '', uri) && hidden.some((u) => samePlace(u, uri));
        if (place.hidden !== hide) place.hidden = hide;
        if (place.dataset.dropUri !== uri) place.dataset.dropUri = uri;
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [settings, root]);
}

function Resizer() {
  const t = useT();
  const width = useSidebar((s) => s.width);
  // The width follows a drag of the right edge at once, rather than with the motion of showing and hiding.
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = useSidebar.getState().width;
    const move = (m: PointerEvent) => setWidth(startW + m.clientX - startX, false);
    const up = (u: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setWidth(startW + u.clientX - startX, true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('resizeSidebar')}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      data-nodrag=""
      onPointerDown={down}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        setWidth(clampWidth(width + (e.key === 'ArrowLeft' ? -8 : 8)), true);
      }}
      className="absolute inset-y-3 -right-1.5 z-10 w-2 cursor-col-resize rounded-full outline-none focus-visible:bg-tint-soft"
    />
  );
}

export function Sidebar() {
  const t = useT();
  const width = useSidebar((s) => s.width);
  const collapsed = useSidebar((s) => s.collapsed);
  const still = useSidebar((s) => s.still);
  const places = useRef<HTMLDivElement>(null);
  useFeaturePlaces(places);

  useEffect(() => {
    void loadVolumes();
    // Disks come and go while the app runs; their free space is asked for again when the window comes forward.
    const off = on('volumes.changed', () => void loadVolumes());
    const focus = () => void loadVolumes();
    window.addEventListener('focus', focus);
    // The window comes back as it was without moving; from the next frames on, showing and hiding move.
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => useSidebar.setState({ still: false })));
    return () => {
      off();
      window.removeEventListener('focus', focus);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      data-sidebar=""
      data-chrome=""
      className={cn('relative flex shrink-0 transition-[width,margin] duration-(--motion-slow) ease-spring', collapsed && '-mr-2', still && 'transition-none')}
      style={{ width: collapsed ? 0 : width }}
    >
      <GlassPanel
        role="complementary"
        aria-label={t('sidebarLabel')}
        inert={collapsed}
        className={cn('flex min-w-0 flex-1 overflow-hidden transition-opacity duration-(--motion) ease-out', collapsed && 'pointer-events-none opacity-0', still && 'transition-none')}
      >
        <div className="flex shrink-0 flex-col" style={{ width }}>
          <div data-drag="" className="h-13 shrink-0" />
          <div ref={places} onContextMenu={sectionMenu} className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5 [scrollbar-width:none]">
            <Sections />
          </div>
        </div>
      </GlassPanel>
      {collapsed ? null : <Resizer />}
    </div>
  );
}
