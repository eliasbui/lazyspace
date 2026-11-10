// The sidebar as features see it (the old page's `Sidebar`). The sidebar feature installs itself with `installSidebar`.
import type { Uri, Volume } from '@/services';

export interface SidebarApi {
  /** Pins a folder to Quick Access. */
  pin(uri: Uri): void;
  /** The folders pinned to Quick Access, in order. */
  pinned(): Uri[];
  /** Pins the folder the focused pane shows. */
  pinHere(): void;
  /** Pins what was dropped on Quick Access. */
  pinDropped(uris: Uri[]): void;
  /** Asks for the disks again (after a mount, an unmount, a connection). */
  loadVolumes(): Promise<void>;
  volumes(): Volume[];
  /** Marks the place the focused pane shows. */
  mark(): void;
  toggle(): void;
  width(): number;
}

let implementation: SidebarApi | null = null;

export function installSidebar(api: SidebarApi): void {
  implementation = api;
}

/** The sidebar. Before the sidebar feature starts, every call does nothing. */
export const sidebar: SidebarApi = {
  pin: (uri) => implementation?.pin(uri),
  pinned: () => implementation?.pinned() ?? [],
  pinHere: () => implementation?.pinHere(),
  pinDropped: (uris) => implementation?.pinDropped(uris),
  loadVolumes: () => implementation?.loadVolumes() ?? Promise.resolve(),
  volumes: () => implementation?.volumes() ?? [],
  mark: () => implementation?.mark(),
  toggle: () => implementation?.toggle(),
  width: () => implementation?.width() ?? 240,
};
