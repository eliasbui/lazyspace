import { create } from 'zustand';
import { t } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { say, toast } from '@/lib/ui';
import { isLocal } from '@/lib/uri';
import { api, type Entry, type Uri } from '@/services';

export const STASH = 'stash://';

interface StashState {
  /** How many items are on the shelf. */
  count: number;
  /** Whether Lanes, the download manager by the same author, is installed. */
  hasLanes: boolean;
}

export const useStash = create<StashState>(() => ({ count: 0, hasLanes: false }));

/** Links kept as files, which Lanes can download. */
export const isLink = (uri: Uri): boolean => /\.(webloc|url|txt)$/i.test(uri);

export function download(uris: Uri[]): void {
  api.lanes.send({ uris: uris.filter(isLink) }).then((d) => toast(t('lanesSent', d.sent)), say);
}

/** Puts items on the shelf; the main window says how many went on. */
export function add(uris: Uri[]): void {
  api.stash.add({ uris }).then((d) => {
    if (d.added && useApp.getState().role === 'main') toast(t('stashAdded', d.added));
  }, say);
}

const THUMBNAILED = /^(jpe?g|png|gif|heic|heif|webp|tiff?|bmp|psd|mov|mp4|m4v|avi|pdf|key|pages|numbers|cr2|nef|arw|dng|raf|orf)$/i;

/** Whether the system draws a Quick Look thumbnail of this item: a picture, a film or a document of this Mac. */
export const thumbnailed = (entry: Entry): boolean => entry.kind === 'file' && THUMBNAILED.test(entry.ext) && isLocal(entry.uri);
