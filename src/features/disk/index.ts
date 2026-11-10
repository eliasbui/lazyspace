// What a folder holds by size, drawn as rectangles as DaisyDisk draws it, and the files in it that are the same. Both
// start from the folder selected, or the pane's own, in the context menu or the palette.
import type { MenuCtx } from '@/lib/registry';
import { registry } from '@/lib/registry';
import { panes } from '@/lib/panes-api';
import { isLocal } from '@/lib/uri';
import { DiskSheet } from './DiskSheet';
import { findTwins, folderOf, listen, measure } from './store';
import { TwinsSheet } from './TwinsSheet';

const fits = (ctx: MenuCtx): boolean => (ctx.count === 1 ? !!ctx.entry?.isDir && isLocal(ctx.entry.uri) : ctx.count === 0 && isLocal(ctx.tab.uri));

export function register(): void {
  listen();
  registry.sheets.register<undefined>({ id: 'diskSheet', Component: DiskSheet });
  registry.sheets.register<undefined>({ id: 'twinsSheet', Component: TwinsSheet });
  registry.actions.set('diskMap', (pane) => {
    const uri = folderOf(pane);
    if (uri) measure(uri);
  });
  registry.actions.set('findTwins', (pane) => {
    const uri = folderOf(pane);
    if (uri) findTwins(uri);
  });
  registry.menu.add({ id: 'diskMap', label: 'diskMap', icon: 'chart.pie', group: 70, order: 2, when: fits, run: (c) => panes.action('diskMap', c.pane) });
  registry.menu.add({ id: 'findTwins', label: 'findTwins', icon: 'doc.on.doc', group: 70, order: 3, when: fits, run: (c) => panes.action('findTwins', c.pane) });
}
