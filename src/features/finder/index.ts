// LazySpace in place of Finder (the old page's parts/15-finder.js, src-tauri/src/features/viewer.rs). "Show in LazySpace"
// beside "Show in Finder": the folder of each item in a new tab of the focused pane, the item selected. A window without
// panes of its own (the shelf, the desktop) asks the app, which sends the folders to a main window as `viewer.show`, as
// it does with what macOS sends once LazySpace is the Mac's file viewer. In Settings: the switch that makes it so.
import { panes, type PaneHandle } from '@/lib/panes-api';
import { registry, type MenuCtx } from '@/lib/registry';
import { isLocal } from '@/lib/uri';
import { listenForViewer, reveal } from './viewer';
import { ViewerSection } from './ViewerSection';

/** The selection, or the folder of the tab itself when nothing is selected. */
const targets = (pane: PaneHandle) => (pane.tab.selCount() ? pane.tab.selectedEntries().map((e) => e.uri) : [pane.tab.uri]);

// The items on the shelf's own pane are files of this Mac though the tab is not, so the entries decide.
const local = (ctx: MenuCtx) => (ctx.count ? ctx.entries.length > 0 && ctx.entries.every((e) => isLocal(e.uri)) : isLocal(ctx.tab.uri));

export function register(): void {
  listenForViewer();
  registry.actions.set('revealHere', (pane) => reveal(pane, targets(pane)));
  registry.menu.add({ id: 'revealHere', label: 'm.revealHere', icon: 'folder', group: 50, order: 3, when: local, action: 'revealHere', run: (ctx) => panes.action('revealHere', ctx.pane) });
  registry.keys.add({ 'Cmd+Ctrl+R': 'revealHere' });
  registry.settings.section({ id: 'viewer', title: 'finderTitle', order: 40, Component: ViewerSection });
}
