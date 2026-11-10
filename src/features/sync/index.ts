// Comparing and syncing two folders: from two folders selected, or from the folders of this pane and the next.
import { panes } from '@/lib/panes-api';
import { registry } from '@/lib/registry';
import { fromPanes, listen, open } from './store';
import { SyncSheet } from './SyncSheet';

export function register(): void {
  listen();
  registry.sheets.register<undefined>({ id: 'syncSheet', Component: SyncSheet });
  registry.actions.set('compareFolders', (pane) => void fromPanes(pane));
  registry.keys.add({ 'Cmd+Alt+K': 'compareFolders' });
  registry.menu.add({
    id: 'sync',
    label: 'syncMenu',
    icon: 'arrow.triangle.2.circlepath',
    group: 55,
    order: 5,
    when: (c) => c.count === 2 && c.entries.length === 2 && c.entries.every((e) => e.isDir),
    run: (c) => {
      const [a, b] = c.entries;
      if (a && b) open(a.uri, b.uri);
    },
  });
  registry.menu.add({
    id: 'comparePanes',
    label: 'comparePanes',
    icon: 'arrow.triangle.2.circlepath',
    group: 55,
    order: 6,
    action: 'compareFolders',
    when: (c) => c.count === 0 && panes.all().length > 1,
    run: (c) => void fromPanes(c.pane),
  });
}
