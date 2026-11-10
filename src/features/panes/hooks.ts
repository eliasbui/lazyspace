import { useSyncExternalStore } from 'react';
import { usePanesRevision } from '@/lib/panes-api';
import type { Pane } from './pane';

/** Draws a component of a pane again when the pane draws again or anything of the panes changes. */
export function usePane(pane: Pane): number {
  usePanesRevision((s) => s.revision);
  return useSyncExternalStore(pane.subscribe, pane.getVersion);
}

// The window counts as in front until it is left, as the old page had it (a window opens in front).
let active = true;
const subscribeFocus = (fn: () => void) => {
  const on = () => {
    active = true;
    fn();
  };
  const off = () => {
    active = false;
    fn();
  };
  addEventListener('focus', on);
  addEventListener('blur', off);
  return () => {
    removeEventListener('focus', on);
    removeEventListener('blur', off);
  };
};

/** Whether the window is in front: the selection is drawn in the accent colour only then, as macOS draws it. */
export const useWindowActive = (): boolean => useSyncExternalStore(subscribeFocus, () => active);
