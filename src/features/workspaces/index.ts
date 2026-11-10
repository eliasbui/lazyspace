// Workspaces (the old page's parts/10-workspaces.js): the window's layout, panes, tabs and places saved under a name in
// the sidebar and brought back with a click; a right click renames, saves over or deletes one.
import { openSheet, registry } from '@/lib/registry';
import { WorkspacesSection } from './WorkspacesSection';
import { WorkspacesSheet } from './WorkspacesSheet';

export function register(): void {
  registry.sidebar.section({ id: 'workspaces', title: 'workspaces', order: 20, Component: WorkspacesSection });
  registry.sheets.register({ id: 'workspaces', Component: WorkspacesSheet });
  registry.actions.set('saveWorkspace', () => openSheet('workspaces'));
  registry.keys.add({ 'Cmd+Alt+W': 'saveWorkspace' });
}
