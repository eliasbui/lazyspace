// What features plug into (the old page's `LZ` API, design.md 6.4), as typed registries. A feature calls these from its
// `register()` (src/features/<name>/index.ts); the core draws what is registered and never imports a feature.
//
// Two kinds: registries that components draw (toolbar buttons, sidebar sections, settings sections, sheets, previews, pane
// badges, views) live in a zustand store, so a component that shows them draws again when a feature adds one; the rest
// (context menu items, keys, actions, ways to open an item, names of places) are read when they are used.
import type { ComponentType, ReactNode } from 'react';
import { create } from 'zustand';
import type { WordKey } from '@/i18n';
import type { MenuNode, Row, Uri, ViewMode, WindowRole } from '@/services';
import type { PaneHandle, TabView } from './panes-api';
import { nameOf, schemeOf } from './uri';

// ---------------------------------------------------------------------------------------------------------------------
// The context menu: items with a condition and an action, shown as a native menu (the page sends a tree to Rust).

/** What a context menu is asked for: the pane, the tab, and the items selected (none for the folder's own menu). */
export interface MenuCtx {
  pane: PaneHandle;
  tab: TabView;
  /** The selected rows that are loaded. */
  entries: Row[];
  entry: Row | null;
  count: number;
  where: 'item' | 'empty';
  x: number;
  y: number;
}

export interface MenuItemDef {
  id: string;
  label: WordKey | ((ctx: MenuCtx) => string);
  /** The name of an SF Symbol (the native menu draws it). A name this macOS does not have draws nothing. */
  icon?: string;
  group?: number;
  order?: number;
  when?: (ctx: MenuCtx) => boolean;
  /** The keymap action whose chord is shown beside the item. */
  action?: string;
  checked?: (ctx: MenuCtx) => boolean;
  enabled?: (ctx: MenuCtx) => boolean;
  run?: (ctx: MenuCtx) => void;
  submenu?: MenuItemDef[] | ((ctx: MenuCtx) => MenuItemDef[]);
}

const menuItems: MenuItemDef[] = [];

const byGroup = (a: MenuItemDef, b: MenuItemDef): number => (a.group ?? 50) - (b.group ?? 50) || (a.order ?? 50) - (b.order ?? 50);

/** The items that fit `ctx`, in their groups, as the tree Rust takes; `lookup` finds an item by id for the answer. */
export function menuTree(ctx: MenuCtx, translate: (key: WordKey) => string, shortcutOf: (action: string) => string | undefined, items: MenuItemDef[] = menuItems): { tree: MenuNode[]; lookup: Map<string, MenuItemDef> } {
  const lookup = new Map<string, MenuItemDef>();
  const build = (list: MenuItemDef[]): MenuNode[] => {
    const fits = list.filter((item) => !item.when || item.when(ctx)).sort(byGroup);
    const out: MenuNode[] = [];
    let group: number | undefined;
    for (const item of fits) {
      if (out.length && item.group !== group) out.push({ separator: true });
      group = item.group;
      lookup.set(item.id, item);
      const sub = typeof item.submenu === 'function' ? item.submenu(ctx) : item.submenu;
      out.push({
        id: item.id,
        label: typeof item.label === 'function' ? item.label(ctx) : translate(item.label),
        icon: item.icon,
        enabled: item.enabled ? !!item.enabled(ctx) : true,
        checked: item.checked ? !!item.checked(ctx) : false,
        shortcut: item.action ? shortcutOf(item.action) : undefined,
        submenu: sub ? build(sub) : [],
      });
    }
    return out;
  };
  return { tree: build(items), lookup };
}

// ---------------------------------------------------------------------------------------------------------------------
// Keys and actions

/** The chords an action answers to ("Cmd+Shift+N" = "newFolder"), for the Mac keys, the Windows keys, or both. */
const extraKeys: Record<'all' | 'mac' | 'windows', Record<string, string>> = { all: {}, mac: {}, windows: {} };
/** The keys feature's own keymaps (the old page's KEYMAPS), which it gives with `registry.keys.base`. */
const baseKeys: Record<'mac' | 'windows', Record<string, string>> = { mac: {}, windows: {} };
const actions = new Map<string, (pane: PaneHandle) => void | Promise<void>>();

// ---------------------------------------------------------------------------------------------------------------------
// Ways to open an item, and names of places that are not folders of a disk

type Opener = (row: Row) => Uri | null;
const openers: Opener[] = [];

const placeNames = new Map<string, (uri: Uri) => string>();
/** The crumbs of the path bar of a place a feature owns: `[uri, name, icon key]` from the top down. */
export type Crumb = [uri: Uri, name: string, iconKey?: string | null];
const placeCrumbs = new Map<string, (uri: Uri) => Crumb[]>();

// ---------------------------------------------------------------------------------------------------------------------
// What components draw

export interface ToolbarItemDef {
  id: string;
  /** "left" joins the actions capsule, "right" the capsule before the search field, "layout" the view capsule. */
  side: 'left' | 'right' | 'layout';
  icon: ReactNode;
  label: WordKey;
  order?: number;
  /** Receives the rectangle of the button, for a menu that opens under it. */
  run: (rect: DOMRect) => void;
  /** Runs on a right click on the button (Terminal and Editor pick another app); receives the rectangle of the button. */
  menu?: (rect: DOMRect) => void;
  when?: () => boolean;
  /** Whether the button shows pressed (the preview is on). The feature adds the item again when it changes, so it redraws. */
  active?: () => boolean;
}

export interface SidebarSectionDef {
  id: string;
  title: WordKey | null;
  /** Bookmarks are 10 and Locations 90; a feature's section goes between. */
  order: number;
  Component: ComponentType;
}

export interface SettingsSectionDef {
  id: string;
  title: WordKey;
  order?: number;
  Component: ComponentType;
}

/** What a sheet is handed: the props it was opened with, and the way to close it. */
export interface SheetProps<T = unknown> {
  props: T;
  close: () => void;
}

export interface SheetDef<T = never> {
  id: string;
  Component: ComponentType<SheetProps<T>>;
}

export interface PreviewProvider {
  id: string;
  match: (row: Row) => boolean;
  Component: ComponentType<{ row: Row }>;
}

/** A view of the rows of a tab other than the list and the icons (columns, gallery), drawn in the body of a pane. */
export interface ViewProps {
  pane: PaneHandle;
  tab: TabView;
}

export interface RegistryState {
  toolbar: ToolbarItemDef[];
  sidebar: SidebarSectionDef[];
  settings: SettingsSectionDef[];
  sheets: Record<string, SheetDef<never>>;
  previews: PreviewProvider[];
  /** Small things after the path bar of a pane (the git branch). */
  pathbar: Array<{ id: string; Component: ComponentType<{ pane: PaneHandle }> }>;
  /** A layer over the rows of a pane (a sync in progress, a progress bar). */
  overlays: Array<{ id: string; Component: ComponentType<{ pane: PaneHandle }> }>;
  views: Partial<Record<ViewMode, ComponentType<ViewProps>>>;
  /** The whole page of a window that is not the file manager: the shelf, the desktop. */
  roles: Partial<Record<WindowRole, ComponentType>>;
}

export const useRegistry = create<RegistryState>(() => ({ toolbar: [], sidebar: [], settings: [], sheets: {}, previews: [], pathbar: [], overlays: [], views: {}, roles: {} }));

const upsert = <T extends { id: string }>(list: T[], item: T): T[] => [...list.filter((i) => i.id !== item.id), item];

export const registry = {
  menu: {
    /** Adds an item to the context menu, or replaces the one with its id. */
    add(item: MenuItemDef): void {
      const at = menuItems.findIndex((i) => i.id === item.id);
      if (at >= 0) menuItems.splice(at, 1);
      menuItems.push(item);
    },
    /** Every top-level item in the order of the groups, for the menu editor. */
    list(): MenuItemDef[] {
      return [...menuItems].sort(byGroup);
    },
  },
  keys: {
    /** Adds chords to the keymap: `{ "Cmd+Shift+R": "batchRename" }`, for `only` the Mac or the Windows keys, or both. */
    add(chords: Record<string, string>, only: 'all' | 'mac' | 'windows' = 'all'): void {
      Object.assign(extraKeys[only], chords);
    },
    extra(keymap: 'mac' | 'windows'): Record<string, string> {
      return { ...extraKeys.all, ...extraKeys[keymap] };
    },
    /** The keys feature gives its own chords of a keymap here, so that a list of every key (the commands) can show them. */
    base(keymap: 'mac' | 'windows', chords: Record<string, string>): void {
      baseKeys[keymap] = { ...chords };
    },
    /** Every chord of a keymap: the keys feature's own, with those the features add over them. */
    map(keymap: 'mac' | 'windows'): Record<string, string> {
      return { ...baseKeys[keymap], ...extraKeys.all, ...extraKeys[keymap] };
    },
  },
  actions: {
    /** Defines the action `name` on a pane; the keymap, the menus, the commands and the toolbar run it. */
    set(name: string, run: (pane: PaneHandle) => void | Promise<void>): void {
      actions.set(name, run);
    },
    get: (name: string) => actions.get(name),
    names: () => [...actions.keys()],
  },
  vfs: {
    /** A way to open a kind of item that is not a folder (an archive opens as one): returns the place to browse, or null. */
    opener(open: Opener): void {
      openers.push(open);
    },
    /** Where opening `row` goes inside: a folder, else the first opener that takes it, else null. */
    browse(row: Row): Uri | null {
      if (row.isDir) return row.uri;
      for (const open of openers) {
        const uri = open(row);
        if (uri) return uri;
      }
      return null;
    },
  },
  places: {
    name(scheme: string, name: (uri: Uri) => string): void {
      placeNames.set(scheme, name);
    },
    crumbs(scheme: string, crumbs: (uri: Uri) => Crumb[]): void {
      placeCrumbs.set(scheme, crumbs);
    },
    /** What a place is called in a title, a tab and the path bar. */
    nameOf(uri: Uri): string {
      return placeNames.get(schemeOf(uri))?.(uri) ?? nameOf(uri);
    },
    crumbsOf(uri: Uri): Crumb[] | null {
      return placeCrumbs.get(schemeOf(uri))?.(uri) ?? null;
    },
  },
  toolbar: {
    add: (item: ToolbarItemDef): void => useRegistry.setState((s) => ({ toolbar: upsert(s.toolbar, item) })),
  },
  sidebar: {
    section: (section: SidebarSectionDef): void => useRegistry.setState((s) => ({ sidebar: upsert(s.sidebar, section) })),
  },
  settings: {
    section: (section: SettingsSectionDef): void => useRegistry.setState((s) => ({ settings: upsert(s.settings, section) })),
  },
  sheets: {
    register: <T>(sheet: SheetDef<T>): void => useRegistry.setState((s) => ({ sheets: { ...s.sheets, [sheet.id]: sheet as unknown as SheetDef<never> } })),
  },
  preview: {
    register: (provider: PreviewProvider): void => useRegistry.setState((s) => ({ previews: upsert(s.previews, provider) })),
  },
  /** Gives a window of this role (`app.hello.windowRole`) a page of its own, instead of the file manager. */
  role: (role: WindowRole, Component: ComponentType): void => useRegistry.setState((s) => ({ roles: { ...s.roles, [role]: Component } })),
  pane: {
    pathbar: (item: { id: string; Component: ComponentType<{ pane: PaneHandle }> }): void => useRegistry.setState((s) => ({ pathbar: upsert(s.pathbar, item) })),
    overlay: (item: { id: string; Component: ComponentType<{ pane: PaneHandle }> }): void => useRegistry.setState((s) => ({ overlays: upsert(s.overlays, item) })),
    view: (mode: ViewMode, Component: ComponentType<ViewProps>): void => useRegistry.setState((s) => ({ views: { ...s.views, [mode]: Component } })),
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Sheets: one open at a time, closed by Escape or a click beside it (unless it waits for an answer).

export interface OpenSheet {
  id: string;
  props: unknown;
}

export const useSheets = create<{ open: OpenSheet | null }>(() => ({ open: null }));

export function openSheet<T = undefined>(id: string, props?: T): void {
  useSheets.setState({ open: { id, props } });
}

export function closeSheet(): void {
  useSheets.setState({ open: null });
}
