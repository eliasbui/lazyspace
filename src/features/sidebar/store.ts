// The sidebar's state and what features ask of it (src/lib/sidebar-api.ts): the disks, the folders pinned to Quick
// Access (Settings `favourites`), and its width and whether it is shown (Settings `sidebar_sections`, read once when the
// window opens so that each window keeps its own while it lives).
import { create } from 'zustand';
import { setSidebarPrefs } from '@/components/macos/SideItem';
import { t } from '@/i18n';
import { setSetting, useApp } from '@/lib/app-state';
import { panes } from '@/lib/panes-api';
import { registry } from '@/lib/registry';
import { ejectorOf, installSidebar } from '@/lib/sidebar-api';
import { say, toast } from '@/lib/ui';
import { samePlace } from '@/lib/uri';
import { api, type Settings, type Uri, type Volume } from '@/services';

interface SidebarState {
  volumes: Volume[];
  width: number;
  collapsed: boolean;
  /** Folders just pinned, which come into Quick Access with a motion. */
  fresh: Uri[];
  /** Disks being ejected, by path, drawn dim meanwhile. */
  ejecting: string[];
  /** No motion while the edge is dragged or the window comes back as it was. */
  still: boolean;
}

export const useSidebar = create<SidebarState>(() => ({ volumes: [], width: 220, collapsed: false, fresh: [], ejecting: [], still: true }));

export const MIN_WIDTH = 160;
export const MAX_WIDTH = 380;
export const clampWidth = (width: number): number => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));

function savedPrefs(settings: Settings): { width?: number; collapsed?: boolean } {
  const raw = settings.sidebar_sections;
  if (typeof raw !== 'object' || raw === null) return {};
  return {
    width: 'width' in raw && typeof raw.width === 'number' ? raw.width : undefined,
    collapsed: 'collapsed' in raw && typeof raw.collapsed === 'boolean' ? raw.collapsed : undefined,
  };
}

// The first settings the window hears give the sidebar its width and whether it shows; without them, the layout the old
// page kept (layout.json), whose width was a CSS length of the sidebar's column, its margin of 8 included.
const stopInit = useApp.subscribe((s) => {
  if (!s.settings) return;
  stopInit();
  const saved = savedPrefs(s.settings);
  const old: unknown = s.hello?.layout?.sidebarWidth;
  const legacy = typeof old === 'string' ? Number.parseFloat(old) - 8 : typeof old === 'number' ? old : Number.NaN;
  useSidebar.setState({
    width: clampWidth(saved.width ?? (Number.isFinite(legacy) ? legacy : 220)),
    collapsed: saved.collapsed ?? !!s.hello?.layout?.sidebarHidden,
  });
});

const favourites = (): Uri[] => useApp.getState().settings?.favourites ?? [];
const saveLayout = (): void => {
  if (panes.focused()) panes.saveSoon();
};

/** Pins a folder to Quick Access, or takes it out. */
export function pin(uri: Uri, on: boolean): void {
  const now = favourites().filter((u) => !samePlace(u, uri));
  if (on) now.push(uri);
  void setSetting({ favourites: now });
}

/** Moves the pinned folder at `from` to `to` in Quick Access. */
export function reorder(from: number, to: number): void {
  const now = [...favourites()];
  if (!now[from] || to < 0 || to >= now.length || from === to) return;
  now.splice(to, 0, ...now.splice(from, 1));
  void setSetting({ favourites: now });
}

export function pinHere(): void {
  const uri = panes.current()?.uri;
  if (!uri || favourites().some((u) => samePlace(u, uri))) return;
  pin(uri, true);
  toast(t('pinnedQuick', registry.places.nameOf(uri)));
}

// Each folder once, a file not at all, all in one change of Settings: one change per folder would each start from the
// list before the others were added, and keep only the last.
export async function pinDropped(uris: Uri[]): Promise<void> {
  const entries = await Promise.all(uris.map((uri) => api.fs.stat({ uri }).catch(() => null)));
  const before = favourites();
  const now = [...before];
  entries.forEach((entry, k) => {
    const uri = uris[k];
    if (entry?.isDir && uri && !now.some((u) => samePlace(u, uri))) now.push(uri);
  });
  if (now.length > before.length) {
    useSidebar.setState({ fresh: now.slice(before.length) });
    void setSetting({ favourites: now });
  }
  if (entries.some((entry) => !entry?.isDir)) toast(t('notFolder'));
}

export async function loadVolumes(): Promise<void> {
  const volumes = await api.native.volumes().catch(() => null);
  if (volumes) useSidebar.setState({ volumes });
}

export function toggle(): void {
  const collapsed = !useSidebar.getState().collapsed;
  useSidebar.setState({ collapsed });
  void setSidebarPrefs({ collapsed });
  saveLayout();
}

/** The width while the edge is dragged; `done` when it is let go, which keeps it. */
export function setWidth(width: number, done: boolean): void {
  useSidebar.setState({ width: clampWidth(width), still: !done });
  if (!done) return;
  void setSidebarPrefs({ width: useSidebar.getState().width });
  saveLayout();
}

/** Ejects a disk the devices feature's way when it has one, dimming it in the sidebar until that is over. */
export async function ejectDisk(path: string, name: string): Promise<void> {
  useSidebar.setState((s) => ({ ejecting: [...s.ejecting, path] }));
  try {
    const own = ejectorOf();
    await (own ? own(path, name) : api.native.eject({ path }));
  } catch (error) {
    say(error);
  } finally {
    useSidebar.setState((s) => ({ ejecting: s.ejecting.filter((p) => p !== path) }));
    void loadVolumes();
  }
}

installSidebar({
  pin: (uri) => pin(uri, true),
  unpin: (uri) => pin(uri, false),
  pinned: favourites,
  pinHere,
  pinDropped: (uris) => void pinDropped(uris),
  loadVolumes,
  volumes: () => useSidebar.getState().volumes,
  // The marks follow the focused pane by themselves (SideItem reads the panes' revision).
  mark: () => undefined,
  toggle,
  width: () => useSidebar.getState().width,
});

registry.actions.set('toggleSidebar', toggle);
