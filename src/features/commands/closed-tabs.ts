// The tabs closed lately, for Reopen Closed Tab. The panes say no word when a tab closes, so the tabs of each pane are
// compared before and after every change of the panes.
import type { Uri } from '@/services';

export interface TabRef {
  /** The id of the tab's view, which stays the same while the tab lives. */
  id: string;
  uri: Uri;
}

/** The tabs of each pane, by the pane's id. */
export type PaneTabs = ReadonlyMap<string, readonly TabRef[]>;

/**
 * The places of the tabs closed between `before` and `after`: a pane that is still there with one tab fewer, whose tab is
 * in no pane any more (a tab moved to another pane is not closed). A pane closed, or a workspace loaded, closes none.
 */
export function closedTabs(before: PaneTabs, after: PaneTabs): Uri[] {
  const alive = new Set<string>();
  for (const tabs of after.values()) for (const tab of tabs) alive.add(tab.id);
  const out: Uri[] = [];
  for (const [pane, tabs] of before) {
    if (after.get(pane)?.length !== tabs.length - 1) continue;
    for (const tab of tabs) if (!alive.has(tab.id)) out.push(tab.uri);
  }
  return out;
}

/** The last places closed, the newest last; at most `max`. */
export function remember(stack: Uri[], closed: Uri[], max = 20): Uri[] {
  return [...stack, ...closed].slice(-max);
}
