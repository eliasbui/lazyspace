import { create } from 'zustand';
import { panes } from '@/lib/panes-api';
import { isLocal } from '@/lib/uri';
import { api, type GitStatus, type Uri } from '@/services';

/** The branch of each view, with the place it was asked for; the pill reads it when the panes keep no branch of their own. */
export const useGit = create<{ byView: Record<string, { uri: Uri; branch: string | null }> }>(() => ({ byView: {} }));

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function paint(view: string, uri: Uri, state: GitStatus | null): void {
  panes.findTab(view)?.tab.setGit?.(state?.items ?? null, state?.branch || null);
  useGit.setState((s) => ({ byView: { ...s.byView, [view]: { uri, branch: state?.branch || null } } }));
}

/** Asks for the state of the folder of `view` a quarter of a second after its listing settles, once for a burst. */
export function ask(view: string, uri: Uri): void {
  clearTimeout(timers.get(view));
  if (!isLocal(uri)) {
    paint(view, uri, null);
    return;
  }
  timers.set(
    view,
    setTimeout(() => {
      timers.delete(view);
      api.git.status({ uri }).then(
        (state) => {
          if (panes.findTab(view)?.tab.uri === uri) paint(view, uri, state);
        },
        () => undefined,
      );
    }, 250),
  );
}
