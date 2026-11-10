import { create } from 'zustand';
import { choose } from '@/lib/native-choice';
import type { PaneHandle } from '@/lib/panes-api';
import { say } from '@/lib/ui';
import { isLocal } from '@/lib/uri';
import { api, type OpenInTool } from '@/services';

export type ToolKind = OpenInTool['kind'];

/** The terminals and editors of this Mac; the one used last of each kind is its default. */
export const useTools = create<{ list: OpenInTool[] }>(() => ({ list: [] }));

export async function loadTools(): Promise<OpenInTool[]> {
  const list = await api.openin.tools().catch(() => useTools.getState().list);
  useTools.setState({ list });
  return list;
}

/** The folder the pane shows, or the item selected for an editor when one is. */
export function target(pane: PaneHandle, kind: ToolKind): string {
  const tab = pane.tab;
  const one = tab.selCount() === 1 ? tab.selectedEntries()[0] : null;
  return kind === 'editor' && one ? one.uri : tab.uri;
}

/** Opens the pane's folder (or item) in `tool`, or in the default of `kind` without one; that tool becomes the default. */
export function openIn(pane: PaneHandle, kind: ToolKind, tool: string | null): void {
  if (!isLocal(pane.tab.uri)) return;
  api.openin
    .open({ kind, tool, uri: target(pane, kind) })
    .then(() => void loadTools())
    .catch(say);
}

/** A menu of the tools of a kind, the default checked, under a toolbar button. */
export async function chooseTool(pane: PaneHandle, kind: ToolKind, x: number, y: number): Promise<void> {
  const own = (await loadTools()).filter((tool) => tool.kind === kind);
  const id = await choose(
    own.map((tool) => ({ id: tool.id, label: tool.name, checked: tool.default })),
    x,
    y,
  );
  if (id) openIn(pane, kind, id);
}
