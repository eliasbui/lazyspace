// What a folder holds by size, and the files in it that are the same (src-tauri/src/features/disk.rs). Both run as jobs;
// their results come back in `jobs.finished`.
import { create } from 'zustand';
import { useApp } from '@/lib/app-state';
import type { PaneHandle } from '@/lib/panes-api';
import { panes } from '@/lib/panes-api';
import { closeSheet, openSheet } from '@/lib/registry';
import { say } from '@/lib/ui';
import { fileUri, isLocal } from '@/lib/uri';
import { api, on, type DiskNode, type JobData, type JobResults, type TwinGroup, type Uri } from '@/services';

interface DiskState {
  /** The folders shown, the deepest last, each with the items under it two levels down. */
  shown: DiskNode[];
  /** Measurements asked for and not back yet. */
  busy: number;
  /** The folder the map was opened on, or null before it was. */
  asked: Uri | null;
  /** The folder the twins are looked for in, and the folder the result named. */
  twinsOf: Uri | null;
  twinsFolder: Uri | null;
  /** The groups of twins, or null while they are looked for. */
  groups: TwinGroup[] | null;
  picked: string[];
}

export const useDisk = create<DiskState>(() => ({ shown: [], busy: 0, asked: null, twinsOf: null, twinsFolder: null, groups: null, picked: [] }));

// The jobs started here, by id; each is told its result, or undefined when it failed or was stopped.
const jobs = new Map<number, (data: JobData | undefined) => void>();

/** Listens to the end of the jobs; called once by register(). */
export function listen(): void {
  on('jobs.finished', (d) => {
    const done = jobs.get(d.id);
    if (!done) return;
    jobs.delete(d.id);
    done(d.ok ? d.data : undefined);
  });
}

const isMap = (d: JobData | undefined): d is JobResults['disk'] => !!d && typeof d === 'object' && 'map' in d;
const isTwins = (d: JobData | undefined): d is JobResults['twins'] => !!d && typeof d === 'object' && 'twins' in d;

function start(job: Promise<{ job: number }>, done: (data: JobData | undefined) => void): void {
  job.then(
    (d) => jobs.set(d.job, done),
    (error: unknown) => {
      say(error);
      done(undefined);
    },
  );
}

/** The folder an action is for: the one folder selected, or the pane's own; null for a place that is not on this Mac. */
export function folderOf(pane: PaneHandle): Uri | null {
  const one = pane.tab.selCount() === 1 ? pane.tab.selectedEntries()[0] : null;
  if (one?.isDir && isLocal(one.uri)) return one.uri;
  return isLocal(pane.tab.uri) ? pane.tab.uri : null;
}

/** The folder a sheet opened with nothing asked looks at: the focused pane's, else home. */
export function defaultFolder(): Uri | null {
  const pane = panes.focused();
  return (pane && folderOf(pane)) ?? useApp.getState().places?.home ?? null;
}

// Each map opened is a round; a measurement of an earlier round that comes back late is dropped.
let round = 0;

/** Opens the map on `uri` and measures it. */
export function measure(uri: Uri): void {
  const mine = ++round;
  useDisk.setState({ shown: [], busy: 1, asked: uri });
  openSheet('diskSheet');
  start(api.disk.map({ uri }), (data) => {
    if (mine !== round) return;
    useDisk.setState((s) => ({ busy: s.busy - 1, shown: isMap(data) ? [...s.shown, data.map] : s.shown }));
  });
}

/** Looks inside a folder of the map: at once with the two levels known, then with its own measurement. */
export function drill(node: DiskNode): void {
  if (!node.dir || !node.path) return;
  const mine = round;
  const path = node.path;
  useDisk.setState((s) => ({ shown: [...s.shown, { ...node }], busy: s.busy + 1 }));
  start(api.disk.map({ uri: fileUri(path) }), (data) => {
    if (mine !== round) return;
    useDisk.setState((s) => {
      const top = s.shown[s.shown.length - 1];
      const shown = isMap(data) && top?.path === data.map.path ? [...s.shown.slice(0, -1), data.map] : s.shown;
      return { shown, busy: s.busy - 1 };
    });
  });
}

export function up(): void {
  useDisk.setState((s) => (s.shown.length > 1 ? { shown: s.shown.slice(0, -1) } : s));
}

/** Shows an item of the map in the focused pane, selected in its folder. */
export function reveal(node: DiskNode): void {
  const pane = panes.focused();
  if (!node.path || !pane) return;
  const path = node.path;
  closeSheet();
  pane.navigate(fileUri(path.slice(0, path.lastIndexOf('/')) || '/'), { select: [node.name] });
}

/** Opens the twins of `uri` and looks for them. */
export function findTwins(uri: Uri): void {
  useDisk.setState({ twinsOf: uri, twinsFolder: null, groups: null, picked: [] });
  openSheet('twinsSheet');
  start(api.disk.twins({ uri }), (data) => {
    if (useDisk.getState().twinsOf !== uri) return;
    useDisk.setState({ groups: isTwins(data) ? data.twins : [], twinsFolder: isTwins(data) ? data.folder : null });
  });
}

export function togglePicked(uri: string, on: boolean): void {
  useDisk.setState((s) => ({ picked: on ? [...s.picked.filter((u) => u !== uri), uri] : s.picked.filter((u) => u !== uri) }));
}

/** Ticks every copy but the first of each group, or none. */
export function pickExtra(extra: boolean): void {
  useDisk.setState((s) => ({ picked: extra ? (s.groups ?? []).flatMap((g) => g.uris.slice(1)) : [] }));
}

/** Moves the ticked files to the Trash; once they are there, they leave their groups, and a group of one goes. */
export function trashPicked(): void {
  const uris = useDisk.getState().picked;
  if (!uris.length) return;
  start(api.fs.trash({ uris }), (data) => {
    if (data === undefined) return;
    const gone = new Set(uris);
    useDisk.setState((s) => ({
      groups: (s.groups ?? []).map((g) => ({ ...g, uris: g.uris.filter((u) => !gone.has(u)) })).filter((g) => g.uris.length > 1),
      picked: s.picked.filter((u) => !gone.has(u)),
    }));
  });
}
