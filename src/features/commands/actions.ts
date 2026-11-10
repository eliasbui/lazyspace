// The actions a dual-pane manager is known for (copy or move to the other pane with F5 and F6, swap the panes, open in the
// other pane), reopening a closed tab, moving between tabs, refreshing, and Finder's Move Item Here.
import { t } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { panes, usePanesRevision, type PaneHandle } from '@/lib/panes-api';
import { registry } from '@/lib/registry';
import { sidebar } from '@/lib/sidebar-api';
import { say, toast } from '@/lib/ui';
import { api } from '@/services';
import { closedTabs, remember, type PaneTabs } from './closed-tabs';

/** The pane after `pane`, round, when there are two or more. */
function other(pane: PaneHandle): PaneHandle | null {
  const all = panes.all();
  if (all.length < 2) return null;
  const at = all.findIndex((p) => p.id === pane.id);
  return all[(at + 1) % all.length] ?? null;
}

function toOther(pane: PaneHandle, mode: 'copy' | 'move'): void {
  const there = other(pane);
  if (!there) return toast(t('needTwoPanes'));
  const uris = pane.tab.selectedEntries().map((e) => e.uri);
  if (uris.length) api.fs.copy({ from: uris, to: there.tab.uri, mode }).catch(say);
}

let closed: string[] = [];
let tabs: PaneTabs = new Map();

function trackClosedTabs(): void {
  const now: PaneTabs = new Map(panes.all().map((p) => [p.id, p.tabs.map((tab) => ({ id: tab.id, uri: tab.uri }))]));
  const gone = closedTabs(tabs, now);
  if (gone.length) closed = remember(closed, gone);
  tabs = now;
}

function stepTab(pane: PaneHandle, by: 1 | -1): void {
  const count = pane.tabs.length;
  if (count > 1) pane.activate((pane.active + by + count) % count);
}

export function registerActions(): void {
  usePanesRevision.subscribe(trackClosedTabs);
  const set = registry.actions.set;
  set('pinQuick', () => sidebar.pinHere());
  set('copyToOther', (pane) => toOther(pane, 'copy'));
  set('moveToOther', (pane) => toOther(pane, 'move'));
  set('openInOther', (pane) => {
    const there = other(pane);
    if (!there) return toast(t('needTwoPanes'));
    const folder = pane.tab.selectedEntries().find((e) => e.isDir);
    there.navigate(folder ? folder.uri : pane.tab.uri);
  });
  set('swapPanes', (pane) => {
    const there = other(pane);
    if (!there) return toast(t('needTwoPanes'));
    const [a, b] = [pane.tab.uri, there.tab.uri];
    pane.navigate(b);
    there.navigate(a);
  });
  set('reopenTab', (pane) => {
    const uri = closed.pop();
    if (uri) pane.newTab(uri);
    else toast(t('noClosedTab'));
  });
  set('nextTab', (pane) => stepTab(pane, 1));
  set('previousTab', (pane) => stepTab(pane, -1));
  set('refresh', (pane) => pane.refresh());
  set('pasteMove', (pane) => void api.clipboard.paste({ to: pane.tab.uri, move: true }).catch(say));
  set('documents', (pane) => {
    const documents = useApp.getState().places?.documents;
    if (documents) pane.navigate(documents);
  });

  // In the context menu too, when there is another pane to send to.
  const twoPanes = (ctx: { count: number }) => ctx.count > 0 && panes.all().length > 1;
  registry.menu.add({ id: 'copyToOther', label: 'cmd.copyToOther', icon: 'arrow.right.doc.on.clipboard', group: 30, order: 4, when: twoPanes, action: 'copyToOther', run: (ctx) => panes.action('copyToOther', ctx.pane) });
  registry.menu.add({ id: 'moveToOther', label: 'cmd.moveToOther', icon: 'arrow.right.square', group: 30, order: 5, when: twoPanes, action: 'moveToOther', run: (ctx) => panes.action('moveToOther', ctx.pane) });

  // newFile, hash, openTerminal and openEditor are the actions of their own features (templates, hash, openin).
  registry.keys.add({
    'Cmd+Ctrl+P': 'pinQuick',
    F5: 'copyToOther',
    F6: 'moveToOther',
    'Ctrl+Tab': 'nextTab',
    'Ctrl+Shift+Tab': 'previousTab',
    'Cmd+Alt+N': 'newFile',
    'Cmd+Alt+H': 'hash',
    'Cmd+Alt+O': 'openInOther',
    'Cmd+Ctrl+T': 'openTerminal',
    'Cmd+Ctrl+E': 'openEditor',
  });
  registry.keys.add(
    {
      'Cmd+Shift+T': 'reopenTab',
      'Cmd+Shift+]': 'nextTab',
      'Cmd+Shift+[': 'previousTab',
      'Cmd+R': 'refresh',
      'Cmd+Alt+V': 'pasteMove',
      'Cmd+Shift+O': 'documents',
      'Cmd+U': 'swapPanes',
      'Cmd+P': 'palette',
      'Cmd+/': 'palette',
    },
    'mac',
  );
  registry.keys.add(
    {
      'Ctrl+Shift+T': 'reopenTab',
      'Ctrl+R': 'refresh',
      'Ctrl+Shift+V': 'pasteMove',
      'Ctrl+U': 'swapPanes',
      'Ctrl+P': 'palette',
      'Ctrl+/': 'palette',
    },
    'windows',
  );
}
