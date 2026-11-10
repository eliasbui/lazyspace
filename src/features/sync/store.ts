// Comparing and syncing two folders, in a sheet: the differences with what each would do, every line's action changeable,
// and nothing done until Sync is pressed and confirmed. Both run as jobs (src-tauri/src/features/sync.rs).
import { create } from 'zustand';
import { t } from '@/i18n';
import { panes, type PaneHandle } from '@/lib/panes-api';
import { openSheet } from '@/lib/registry';
import { confirm, errorText, say } from '@/lib/ui';
import { api, on, type SyncAction, type SyncPair, type SyncState as PairState, type Uri } from '@/services';

export const STATES = ['leftNewer', 'rightNewer', 'leftOnly', 'rightOnly', 'conflict'] as const satisfies readonly PairState[];
export const ACTIONS = ['skip', 'ltr', 'rtl', 'deleteLeft', 'deleteRight'] as const satisfies readonly SyncAction[];
/** The most lines drawn; the rest are counted in the filters. */
export const SHOWN = 2000;

export interface Options {
  mode: 'ltr' | 'rtl' | 'both';
  content: boolean;
  ignoreHidden: boolean;
  mirror: boolean;
}

export type Status = { kind: 'comparing' } | { kind: 'result'; same: number; truncated: boolean } | { kind: 'error'; text: string } | null;

interface SyncStore {
  left: Uri | null;
  right: Uri | null;
  pairs: SyncPair[];
  /** The job that runs (a compare or a sync), or null. */
  job: number | null;
  filter: 'all' | (typeof STATES)[number];
  options: Options;
  status: Status;
}

export const useSync = create<SyncStore>(() => ({
  left: null,
  right: null,
  pairs: [],
  job: null,
  filter: 'all',
  options: { mode: 'ltr', content: false, ignoreHidden: true, mirror: false },
  status: null,
}));

// Each compare or sync asked is a round; the job of an earlier one is not waited for.
let round = 0;

function run(job: Promise<{ job: number }>, failed: (error: unknown) => void): void {
  const mine = ++round;
  useSync.setState({ job: null });
  job.then((d) => mine === round && useSync.setState({ job: d.job }), failed);
}

export function compare(): void {
  const { left, right, options } = useSync.getState();
  if (!left || !right) return;
  useSync.setState({ pairs: [], status: { kind: 'comparing' } });
  run(api.sync.compare({ left, right, options }), (error) => useSync.setState({ status: { kind: 'error', text: errorText(error) } }));
}

/** Listens to the end of the jobs; called once by register(). */
export function listen(): void {
  on('jobs.finished', (d) => {
    if (d.id !== useSync.getState().job) return;
    useSync.setState({ job: null });
    if (!d.ok) {
      useSync.setState({ status: 'cancelled' in d ? null : { kind: 'error', text: d.error } });
      return;
    }
    const data = d.data;
    if (data && typeof data === 'object' && 'same' in data) {
      useSync.setState({ pairs: data.pairs, status: { kind: 'result', same: data.same, truncated: data.truncated } });
    } else if (data && typeof data === 'object' && 'done' in data) {
      compare();
    }
  });
}

export function setOption<K extends keyof Options>(key: K, value: Options[K]): void {
  useSync.setState((s) => {
    const options = { ...s.options, [key]: value };
    if (options.mode === 'both') options.mirror = false;
    return { options };
  });
  compare();
}

export function swap(): void {
  useSync.setState((s) => ({ left: s.right, right: s.left }));
  compare();
}

export function setAction(index: number, action: SyncAction): void {
  useSync.setState((s) => ({ pairs: s.pairs.map((p, i) => (i === index ? { ...p, action } : p)) }));
}

/** Asks, then does what the lines say: copies and moves to the Trash; the folders are compared again after. */
export async function apply(): Promise<void> {
  const { pairs, left, right } = useSync.getState();
  if (!left || !right) return;
  const count = (a: SyncAction) => pairs.filter((p) => p.action === a).length;
  const n = pairs.filter((p) => p.action !== 'skip').length;
  if (!n) return;
  const ok = await confirm(t('syncConfirm', n), t('syncConfirmText', count('ltr'), count('rtl'), count('deleteLeft') + count('deleteRight')), t('doSync'));
  if (!ok) return;
  useSync.setState({ status: { kind: 'comparing' } });
  run(api.sync.apply({ left, right, steps: pairs.map((p) => ({ rel: p.rel, action: p.action })) }), say);
}

/** Opens the sheet on two folders and compares them. */
export function open(left: Uri, right: Uri): void {
  useSync.setState({ left, right, filter: 'all' });
  openSheet('syncSheet');
  compare();
}

/** The two folders selected, else the pane's folder and the next pane's. Returns whether it found two. */
export function fromPanes(pane: PaneHandle | null = panes.focused()): boolean {
  if (!pane) return false;
  const dirs = pane.tab.selectedEntries().filter((e) => e.isDir);
  const [a, b] = dirs;
  if (dirs.length === 2 && a && b) {
    open(a.uri, b.uri);
    return true;
  }
  const all = panes.all();
  if (all.length < 2) return false;
  const next = all[(all.findIndex((p) => p.id === pane.id) + 1) % all.length];
  if (!next) return false;
  open(pane.tab.uri, next.tab.uri);
  return true;
}
