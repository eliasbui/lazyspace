import { useApp } from '@/lib/app-state';
import { panes, usePanesRevision, type PaneHandle } from '@/lib/panes-api';
import { say } from '@/lib/ui';
import { isLocal, pathOf, withPath } from '@/lib/uri';
import { api, on, type Uri } from '@/services';

/** The folders that hold `uris`, each with the names to select in it, in the order met; the top of a disk stands for itself. */
export function folders(uris: Uri[]): Map<Uri, string[]> {
  const out = new Map<Uri, string[]>();
  for (const uri of uris) {
    const path = pathOf(uri);
    if (path === '/') {
      out.set(uri, out.get(uri) ?? []);
      continue;
    }
    const folder = withPath(uri, path.slice(0, path.lastIndexOf('/')) || '/');
    const names = out.get(folder) ?? [];
    names.push(path.split('/').pop() ?? '');
    out.set(folder, names);
  }
  return out;
}

/** A folder in a new tab of `pane`, its items selected once they are listed. */
function open(pane: PaneHandle, uri: Uri, names: string[]): void {
  pane.newTab(uri, names.length ? names : null);
  panes.focus(pane);
  pane.focusList();
}

/** The items of this Mac, each in its folder: in a main window here, from any other window through a main one. */
export function reveal(pane: PaneHandle | null, uris: Uri[]): void {
  const local = uris.filter(isLocal);
  if (!local.length) return;
  if (useApp.getState().role !== 'main' || !pane) {
    api.viewer.reveal({ uris: local }).catch(say);
    return;
  }
  for (const [uri, names] of folders(local)) open(pane, uri, names);
}

/** What the app sends (`viewer.show`) waits for the panes, which start after the window's hello. */
export function listenForViewer(): void {
  const waiting: Array<{ uri: Uri; names: string[] }> = [];
  on('viewer.show', (shown) => {
    if (useApp.getState().role !== 'main') return;
    const pane = panes.focused();
    if (pane) open(pane, shown.uri, shown.names);
    else waiting.push(shown);
  });
  usePanesRevision.subscribe(() => {
    const pane = waiting.length ? panes.focused() : null;
    if (pane) for (const shown of waiting.splice(0)) open(pane, shown.uri, shown.names);
  });
}
