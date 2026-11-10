import { create } from 'zustand';
import { t } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { bumpPanes, panes, type PaneHandle, type TabView } from '@/lib/panes-api';
import { authorityOf, schemeOf } from '@/lib/uri';
import type { Phone, Uri } from '@/services';

export const SCHEME = 'device';

export const usePhones = create<{ list: Phone[] }>(() => ({ list: [] }));

export const byKey = (key: string): Phone | undefined => usePhones.getState().list.find((p) => p.key === key);

/** What a device is up to, as its tooltip says. */
export function status(p: Phone): string {
  if (!p.readable) return t(p.kind === 'mtp' ? 'ph.mtp' : 'ph.waiting');
  if (p.state === 'reading') return t('ph.reading', p.percent);
  const words = { opening: 'ph.opening', ready: 'ph.ready', locked: 'ph.locked', failed: 'ph.failed' } as const;
  return t(p.state ? words[p.state] : 'ph.closed');
}

/** Every tab showing a place on the device `key`, with its pane and its index. */
function each(key: string, fn: (pane: PaneHandle, tab: TabView, index: number) => void): void {
  for (const pane of panes.all()) pane.tabs.forEach((tab, i) => schemeOf(tab.uri) === SCHEME && authorityOf(tab.uri) === key && fn(pane, tab, i));
}

/** Points tab `index` of `pane` at `uri`, as if it had gone there itself. */
function retarget(pane: PaneHandle, index: number, uri: Uri): void {
  if (index === pane.active) return pane.navigate(uri, { history: false });
  // shortcut: the panes contract cannot move a tab in the background, so it is shown for a moment and lists now instead of when shown.
  const was = pane.active;
  pane.activate(index);
  pane.navigate(uri, { history: false });
  pane.activate(was);
}

/** Takes the list of devices: tabs on one unplugged go home, those on one that changed list again. */
export function setPhones(list: Phone[]): void {
  const before = new Map(usePhones.getState().list.map((p) => [p.key, p]));
  const now = new Map(list.map((p) => [p.key, p]));
  usePhones.setState({ list });
  const home = useApp.getState().places?.home;
  let renamed = false;
  let moved = false;
  for (const [key, was] of before) {
    const p = now.get(key);
    if (!p) {
      if (home)
        each(key, (pane, _tab, i) => {
          retarget(pane, i, home);
          moved = true;
        });
      continue;
    }
    // Found by Image Capture, unlocked, or stopped: what its panes said may be out of date.
    const stale = p.readable !== was.readable || (p.state !== was.state && (['locked', 'failed', 'ready'] as const).some((s) => s === p.state || s === was.state));
    if (stale) each(key, (pane, _tab, i) => i === pane.active && pane.refresh());
    if (p.name !== was.name) renamed = true;
  }
  // A device's name is the name of its place: the path bars and the tabs draw it again.
  if (renamed) bumpPanes();
  // A window without panes (the desktop, the shelf) has no layout to save.
  if (moved) panes.saveSoon();
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** The files of a device changed or were all read; its panes list again, once for a burst of changes. */
export function filesChanged(key: string): void {
  clearTimeout(pending.get(key));
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      each(key, (pane, _tab, i) => i === pane.active && pane.refresh());
    }, 400),
  );
}
