// The Stash Shelf. In the main window: a sidebar entry that opens the shelf in a pane, a toolbar button that shows the
// floating shelf, and "Add to Shelf" / "Remove from Shelf" in the context menu. The shelf's own window is ShelfPage.
import { TrayIcon } from '@phosphor-icons/react';
import { t } from '@/i18n';
import { panes } from '@/lib/panes-api';
import { registry } from '@/lib/registry';
import { say } from '@/lib/ui';
import { isLocal } from '@/lib/uri';
import { api, on } from '@/services';
import { ShelfPage } from './ShelfPage';
import { StashSection } from './StashSection';
import { add, download, isLink, STASH, useStash } from './store';

export function register(): void {
  registry.places.name('stash', () => t('stash'));
  registry.places.crumbs('stash', (uri) => [[uri, t('stash'), null]]);
  // Bookmarks are 10: the shelf reads as one more favourite, right under them.
  registry.sidebar.section({ id: 'stash', title: null, order: 11, Component: StashSection });
  registry.role('shelf', ShelfPage);

  registry.toolbar.add({ id: 'stash', side: 'right', order: 70, icon: <TrayIcon />, label: 'stashShow', run: () => void panes.action('toggleShelf') });
  registry.actions.set('toggleShelf', () => void api.stash.show({}).catch(say));
  registry.keys.add({ 'Cmd+Alt+T': 'toggleShelf' });

  registry.menu.add({ id: 'stashAdd', label: 'stashAdd', icon: 'tray.and.arrow.down', group: 46, order: 1, when: (c) => c.count > 0 && isLocal(c.tab.uri), run: (c) => add(c.entries.map((e) => e.uri)) });
  registry.menu.add({ id: 'stashRemove', label: 'stashRemove', icon: 'tray.and.arrow.up', group: 46, order: 2, when: (c) => c.count > 0 && c.tab.uri === STASH, run: (c) => void api.stash.remove({ uris: c.entries.map((e) => e.uri) }).catch(say) });
  registry.menu.add({ id: 'stashClear', label: 'stashClear', icon: 'trash', group: 46, order: 3, when: (c) => c.count === 0 && c.tab.uri === STASH, run: () => void api.stash.clear().catch(say) });
  registry.menu.add({
    id: 'downloadLanes',
    label: 'downloadLanes',
    icon: 'arrow.down.circle',
    group: 47,
    order: 1,
    when: (c) => useStash.getState().hasLanes && c.count > 0 && (isLocal(c.tab.uri) || c.tab.uri === STASH) && c.entries.some((e) => isLink(e.uri)),
    run: (c) => download(c.entries.map((e) => e.uri)),
  });

  on('stash.changed', (d) => {
    useStash.setState({ count: d.count });
    for (const pane of panes.all()) if (pane.tab.uri === STASH) pane.refresh();
  });
  on('app.hello', (hello) => {
    // Files dropped on the sidebar's Stash go on the shelf: the shelf cannot be written to as a folder.
    if (hello.windowRole === 'main')
      panes.setDropHandler((drop, target) => {
        if (target.uri !== STASH) return false;
        add(drop.uris);
        return true;
      });
    api.lanes.available().then(
      (yes) => useStash.setState({ hasLanes: yes }),
      () => undefined,
    );
    api.stash.count().then(
      (count) => useStash.setState({ count }),
      () => undefined,
    );
  });
}
