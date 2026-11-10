import { useSyncExternalStore } from 'react';
import { usePanesRevision } from '@/lib/panes-api';
import type { Pane } from './pane';

/** Draws a component of a pane again when the pane draws again or anything of the panes changes. */
export function usePane(pane: Pane): number {
  usePanesRevision((s) => s.revision);
  return useSyncExternalStore(pane.subscribe, pane.getVersion);
}

const subscribeFocus = (fn: () => void) => {
  addEventListener('focus', fn);
  addEventListener('blur', fn);
  return () => {
    removeEventListener('focus', fn);
    removeEventListener('blur', fn);
  };
};

/** Whether the window is in front: the selection is drawn in the accent colour only then, as macOS draws it. */
export const useWindowActive = (): boolean => useSyncExternalStore(subscribeFocus, () => document.hasFocus());
