// The update as the About page of Settings shows it: how it stands, and the next step it offers (check, update or
// download for a copy that cannot replace itself, restart). The banner (src/features/update) follows the same events.
import { create } from 'zustand';
import { t, type WordKey } from '@/i18n';
import { say } from '@/lib/ui';
import { api, on } from '@/services';

export type UpdateStage = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';

interface UpdateState {
  stage: UpdateStage;
  latest: string;
  current: string;
  notes: string;
  url: string;
  installable: boolean;
  percent: number;
  error: string;
}

export const useUpdate = create<UpdateState>(() => ({ stage: 'idle', latest: '', current: '', notes: '', url: '', installable: true, percent: 0, error: '' }));

const set = (patch: Partial<UpdateState>) => useUpdate.setState(patch);
const fail = (error: unknown) => set({ stage: 'error', error: error instanceof Error ? error.message : String(error) });

export const busy = (u: UpdateState): boolean => u.stage === 'checking' || u.stage === 'downloading';

/** What the page says of the update now, or nothing. */
export function updateNote(u: UpdateState): string {
  switch (u.stage) {
    case 'checking':
      return t('checking');
    case 'none':
      return t('upToDate');
    case 'available':
      return t('updateOut', u.latest, u.current);
    case 'downloading':
      return u.percent ? t('updatingPct', u.percent) : t('updating');
    case 'ready':
      return t('updateReady');
    case 'error':
      return u.error;
    default:
      return '';
  }
}

/** The words of the one button, by the step it takes. */
export function updateButton(u: UpdateState): WordKey {
  if (u.stage === 'available') return u.installable ? 'updateNow' : 'download';
  if (u.stage === 'downloading') return 'updating';
  if (u.stage === 'ready') return 'restart';
  return 'checkUpdate';
}

/** The next step: open the download page, download the update, restart into it, or check again. */
export function updateStep(): void {
  const u = useUpdate.getState();
  if (u.stage === 'available' && !u.installable) {
    api.app.openUrl({ url: u.url }).catch(say);
    return;
  }
  if (u.stage === 'available') {
    set({ stage: 'downloading', percent: 0 });
    api.update.install().catch(fail);
    return;
  }
  if (u.stage === 'ready') {
    api.update.relaunch().catch(fail);
    return;
  }
  if (busy(u)) return;
  set({ stage: 'checking' });
  api.update.check({ manual: true }).catch(fail);
}

export function listenForUpdates(): void {
  on('update.available', (d) => set({ stage: 'available', latest: d.latest, current: d.current, notes: d.notes || '', url: d.url || '', installable: d.installable !== false }));
  on('update.none', (d) => set({ stage: 'none', current: d.current }));
  on('update.progress', (percent) => set({ stage: 'downloading', percent }));
  on('update.ready', () => set({ stage: 'ready' }));
  on('update.error', (d) => fail(d.error));
}
