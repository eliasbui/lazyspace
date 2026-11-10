import { create } from 'zustand';
import type { PaneHandle } from '@/lib/panes-api';
import { openSheet } from '@/lib/registry';
import { errorText } from '@/lib/ui';
import { api, on, type Digests, type HashResult } from '@/services';

export const ALGOS: Array<[keyof Digests, string]> = [
  ['md5', 'MD5'],
  ['sha1', 'SHA-1'],
  ['sha224', 'SHA-224'],
  ['sha256', 'SHA-256'],
  ['sha384', 'SHA-384'],
  ['sha512', 'SHA-512'],
  ['crc32', 'CRC32'],
];

interface HashState {
  started: boolean;
  job: number | null;
  results: HashResult[];
  error: string | null;
}

/** The hashes the sheet shows, one result per file as the job finds it. */
export const useHash = create<HashState>(() => ({ started: false, job: null, results: [], error: null }));

/** Hashes the selection of the pane, every algorithm for each file, in the sheet. */
export function startHash(pane: PaneHandle, open = true): void {
  useHash.setState({ started: true, job: null, results: [], error: null });
  if (open) openSheet('hash');
  api.hash.start(pane.tab.selection()).then(
    (d) => useHash.setState({ job: d.job }),
    (error: unknown) => useHash.setState({ error: errorText(error) }),
  );
}

/** A hash as typed or pasted: lower case, without spaces, colons or dashes. */
export const normalHash = (text: string): string => text.toLowerCase().replace(/[\s:-]/g, '');

/** The first algorithm and file whose hash is `want`, or null. */
export function matchOf(results: HashResult[], want: string): [algo: string, name: string] | null {
  for (const r of results) for (const [key, label] of ALGOS) if (r.hashes[key] === want) return [label, r.name];
  return null;
}

export function listen(): void {
  on('hash.started', (d) => useHash.setState({ job: d.job }));
  on('hash.result', (d) => {
    if (d.job === useHash.getState().job) useHash.setState((s) => ({ results: [...s.results, d.result] }));
  });
  on('jobs.finished', (d) => {
    if (d.id === useHash.getState().job && !d.ok && 'error' in d) useHash.setState({ error: d.error });
  });
}
