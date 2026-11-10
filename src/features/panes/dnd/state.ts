// What a drag draws while it goes on: the tab lifted out of its bar, the line where it would go among other tabs, the
// half of a pane that would become a new pane, and the label that follows items dragged within the window.
import { create } from 'zustand';

export type ZoneSide = 'left' | 'right' | 'top' | 'bottom' | 'center';

export interface DragState {
  lifted: { pane: string; index: number; dx: number; dy: number } | null;
  caret: { pane: string; x: number } | null;
  zone: { pane: string; side: ZoneSide } | null;
  ghost: { text: string; x: number; y: number } | null;
}

export const useDrag = create<DragState>(() => ({ lifted: null, caret: null, zone: null, ghost: null }));
