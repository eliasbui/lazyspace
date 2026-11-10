// The column view and the gallery, as Finder has them (ui/parts/25-columns.js), drawn in the body of a pane in place of
// the list: the panes draw them for a tab in the mode `columns` or `gallery`.
import { useApp } from '@/lib/app-state';
import { panes } from '@/lib/panes-api';
import { registry } from '@/lib/registry';
import { ColumnsView } from './ColumnsView';
import { GalleryView } from './GalleryView';
import { shownRows } from './listing';
import { above } from './places';

export function register(): void {
  registry.pane.view('columns', ColumnsView);
  registry.pane.view('gallery', GalleryView);
  // Left goes out to the folder above with this one selected; right goes into the one folder selected, at its first item.
  registry.actions.set('columnOut', (pane) => {
    if (above(pane.tab.uri, useApp.getState().places?.home ?? null).length) panes.action('enclosing', pane);
  });
  registry.actions.set('columnIn', (pane) => {
    const one = pane.tab.selCount() === 1 ? pane.tab.selectedEntries()[0] : null;
    const into = one ? pane.browsable(one) : null;
    if (!into) return;
    const first = shownRows.get(into)?.[0]?.name;
    pane.navigate(into, { select: first ? [first] : null });
  });
}
