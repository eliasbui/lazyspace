// The update as one state that the About page of Settings and the banner both show, so whichever is in sight says how
// it stands and offers the next step: check, update (or download, for a copy that cannot replace itself), restart.
import { create } from 'zustand';
import { t, type WordKey } from '@/i18n';
import { useSheets } from '@/lib/registry';
import { say, toast } from '@/lib/ui';
import { api, on } from '@/services';
import { SETTINGS_SHEET } from '@/features/keys';

export type UpdateStep = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';

export interface UpdateState {
  state: UpdateStep;
  latest: string;
  current: string;
  notes: string;
  url: string;
  installable: boolean;
  percent: number;
  error: string;
  /** The banner was put off until the next news. */
  later: boolean;
}

export const useUpdate = create<UpdateState>(() => ({ state: 'idle', latest: '', current: '', notes: '', url: '', installable: true, percent: 0, error: '', later: false }));

export const updateBusy = (u: UpdateState): boolean => u.state === 'checking' || u.state === 'downloading';

/** How it stands, in words. */
export function updateSaid(u: UpdateState): string {
  switch (u.state) {
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

/** The words of the button that takes the next step. */
export function updateLabel(u: UpdateState): WordKey {
  if (u.state === 'available') return u.installable ? 'updateNow' : 'download';
  if (u.state === 'downloading') return 'updating';
  if (u.state === 'ready') return 'restart';
  return 'checkUpdate';
}

const fail = (error: unknown): void => useUpdate.setState({ state: 'error', error: error instanceof Error ? error.message : String(error) });

/** Takes the next step: opens the download page, installs, restarts, or checks. */
export function updateAct(): void {
  const u = useUpdate.getState();
  if (u.state === 'available' && !u.installable) return void api.app.openUrl({ url: u.url }).catch(say);
  if (u.state === 'available') {
    useUpdate.setState({ state: 'downloading', percent: 0 });
    return void api.update.install().catch(fail);
  }
  if (u.state === 'ready') return void api.update.relaunch().catch(fail);
  if (updateBusy(u)) return;
  useUpdate.setState({ state: 'checking' });
  api.update.check({ manual: true }).catch(fail);
}

let connected = false;

/** Starts listening to the host's news of updates; safe to call twice. */
export function connectUpdate(): void {
  if (connected) return;
  connected = true;
  on('update.available', (d) => useUpdate.setState({ state: 'available', latest: d.latest, current: d.current, notes: d.notes || '', url: d.url || '', installable: d.installable !== false, later: false }));
  on('update.none', (d) => useUpdate.setState({ state: 'none', current: d.current }));
  on('update.progress', (percent) => useUpdate.setState({ state: 'downloading', percent }));
  on('update.ready', () => useUpdate.setState({ state: 'ready', later: false }));
  on('update.error', (d) => {
    fail(d.error);
    // Settings shows it in its About row; elsewhere it is a note.
    if (useSheets.getState().open?.id !== SETTINGS_SHEET) toast(d.error);
  });
}
