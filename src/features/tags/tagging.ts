import type { PaneHandle } from '@/lib/panes-api';
import { tagColour } from '@/lib/tags';
import { say } from '@/lib/ui';
import { api, type Row } from '@/services';

/** Whether an item carries the tag of a colour, by its number or by its name. */
export const hasTag = (entry: Row, colour: number): boolean => (entry.tags ?? []).some(([name, c]) => Number(c) === colour || tagColour(name) === colour);

/** Puts the tag of `colour` on the items, or takes it off, and lists the pane again to show it. */
export function setTag(pane: PaneHandle, entries: Row[], colour: number, on: boolean): Promise<void> {
  return api.tags.set({ uris: entries.map((e) => e.uri), colour, on }).then(() => pane.refresh(), say);
}
