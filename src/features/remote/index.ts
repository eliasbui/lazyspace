// Server connections (W8, ui/parts/80-remote.js): the Cloud and Servers sections of the sidebar, the sheet that adds or
// edits a connection (Cmd+K), what a server asks for on the way in, and the names of places on servers.
import { useApp } from '@/lib/app-state';
import { openSheet, registry, type Crumb } from '@/lib/registry';
import { authorityOf, nameOf, pathOf, schemeOf, withPath } from '@/lib/uri';
import { on, type Uri } from '@/services';
import { SERVER_SCHEMES } from './kinds';
import { CloudSection, ServersSection } from './Sections';
import { ServerSheet, type ServerSheetProps } from './ServerSheet';
import { byId, load, onViewError, oneDriveApp } from './store';

// The connection's name at the top of a place on a server, then the folders.
const rootName = (uri: Uri): string => (schemeOf(uri) === 'rclone' ? authorityOf(uri) : (byId(authorityOf(uri))?.name ?? authorityOf(uri)));

export function register(): void {
  for (const scheme of [...SERVER_SCHEMES, 'rclone']) {
    registry.places.name(scheme, (uri) => (pathOf(uri) === '/' ? rootName(uri) : nameOf(uri)));
    registry.places.crumbs(scheme, (uri) => {
      const crumbs: Crumb[] = [[withPath(uri, '/'), rootName(uri), null]];
      let at = '';
      for (const part of pathOf(uri).split('/').filter(Boolean)) crumbs.push([withPath(uri, (at = `${at}/${part}`)), part, null]);
      return crumbs;
    });
  }

  registry.sidebar.section({ id: 'cloud', title: null, order: 70, Component: CloudSection });
  registry.sidebar.section({ id: 'remote', title: null, order: 75, Component: ServersSection });
  registry.sheets.register<ServerSheetProps | undefined>({ id: 'serverSheet', Component: ServerSheet });

  registry.actions.set('connectServer', () => openSheet('serverSheet'));
  registry.actions.set('addOneDriveApp', () => oneDriveApp());
  registry.keys.add({ 'Cmd+K': 'connectServer' });

  const main = () => useApp.getState().role === 'main';
  // The role of the window comes with the hello itself, before the app's store has it.
  on('app.hello', (hello) => void (hello.windowRole === 'main' && load()));
  // The accounts of rclone's remotes, found on the network after a listing, are in.
  on('remote.changed', () => void (main() && load()));
  on('view.error', ({ view, error }) => void onViewError(view, error));
  // Clouds whose apps were signed in to meanwhile, and connections made in another window, show when the window comes
  // forward.
  window.addEventListener('focus', () => void (main() && load()));
}
