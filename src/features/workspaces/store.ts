import { create } from 'zustand';
import { t } from '@/i18n';
import { choose } from '@/lib/native-choice';
import { panes } from '@/lib/panes-api';
import { prompt, say, toast } from '@/lib/ui';
import { api, type Workspace } from '@/services';

/** The saved workspaces, as the host last listed them. */
export const useWorkspaces = create<{ list: Workspace[] }>(() => ({ list: [] }));

export async function loadWorkspaces(): Promise<void> {
  const list = await api.workspaces.list().catch(() => useWorkspaces.getState().list);
  useWorkspaces.setState({ list });
}

/** Saves the window as it is under `name` (over the workspace of that name, if there is one). */
export function saveWorkspace(name: string): Promise<boolean> {
  // `panes.state()` throws while the panes are not started; the promise turns that into a toast.
  return Promise.resolve()
    .then(() => api.workspaces.save({ name, state: panes.state() }))
    .then(
      () => {
        toast(t('workspaceSaved', name));
        void loadWorkspaces();
        return true;
      },
      (error: unknown) => {
        say(error);
        return false;
      },
    );
}

export function restoreWorkspace(workspace: Workspace): void {
  try {
    panes.load(workspace.state);
  } catch (error) {
    say(error);
  }
}

export function renameWorkspace(workspace: Workspace, name: string): void {
  api.workspaces.rename({ id: workspace.id, name }).then(loadWorkspaces, say);
}

export function deleteWorkspace(workspace: Workspace): void {
  api.workspaces.delete({ id: workspace.id }).then(loadWorkspaces, say);
}

/** The menu of a workspace in the sidebar: rename it, save the window over it, or delete it. */
export async function workspaceMenu(workspace: Workspace, x: number, y: number): Promise<void> {
  const choice = await choose(
    [
      { id: 'rename', label: t('renameWorkspace'), icon: 'pencil' },
      { id: 'over', label: t('overwriteWorkspace'), icon: 'square.and.arrow.down' },
      { separator: true },
      { id: 'delete', label: t('deleteWorkspace'), icon: 'trash' },
    ],
    x,
    y,
  );
  if (choice === 'rename') {
    const name = await prompt(t('workspaceName'), { value: workspace.name, ok: t('renameWorkspace') });
    if (name?.trim()) renameWorkspace(workspace, name.trim());
  } else if (choice === 'over') void saveWorkspace(workspace.name);
  else if (choice === 'delete') deleteWorkspace(workspace);
}
