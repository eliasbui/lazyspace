// Advanced batch rename: the sheet, its action, its key and its item in the context menu.
import type { PaneHandle } from '@/lib/panes-api';
import { openSheet, registry } from '@/lib/registry';
import { isLocal } from '@/lib/uri';
import { RenameSheet, type RenameProps } from './RenameSheet';

function open(pane: PaneHandle): void {
  const tab = pane.tab;
  if (!tab.selCount() || !isLocal(tab.uri)) return;
  openSheet<RenameProps>('renameSheet', { target: tab.selection(), count: tab.selCount() });
}

export function register(): void {
  registry.sheets.register<RenameProps | undefined>({ id: 'renameSheet', Component: RenameSheet });
  registry.actions.set('batchRename', open);
  registry.keys.add({ 'Cmd+Alt+R': 'batchRename' });
  registry.menu.add({
    id: 'batchRename',
    label: 'batchRename',
    icon: 'pencil.and.list.clipboard',
    group: 20,
    order: 2.5,
    action: 'batchRename',
    when: (c) => c.count > 1 && c.tab.capabilities.rename && isLocal(c.tab.uri),
    run: (c) => open(c.pane),
  });
}
