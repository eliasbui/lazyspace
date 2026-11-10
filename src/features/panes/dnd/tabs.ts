// Dragging a tab: along its bar or to another pane's, where a line shows where it would go; onto a pane, which takes it,
// or near one of a pane's edges, which splits that pane with the tab in the new half, as File Explorer and Windows' snap
// do; let go outside the window, it opens in a window of its own.
import { manager } from '../manager';
import type { Pane } from '../pane';
import { useDrag, type ZoneSide } from './state';

type Target = { pane: Pane; index: number; x: number } | { pane: Pane; side: ZoneSide };

const tabEls = (pane: Pane): HTMLElement[] => [...(pane.stripEl?.querySelectorAll<HTMLElement>('[data-tab-index]') ?? [])];

/** The pane whose tab bar is under (x, y), the index among its tabs (the dragged one, `el`, left out) and the x of the line. */
function tabDropAt(x: number, y: number, el: Element | undefined): Target | null {
  for (const pane of manager.all()) {
    if (!pane.tabsEl) continue;
    const bar = pane.tabsEl.getBoundingClientRect();
    if (x < bar.left || x > bar.right || y < bar.top - 14 || y > bar.bottom + 14) continue;
    const others = tabEls(pane).filter((t) => t !== el);
    let index = others.findIndex((t) => {
      const r = t.getBoundingClientRect();
      return x < r.left + r.width / 2;
    });
    if (index < 0) index = others.length;
    const next = others[index];
    const last = others[others.length - 1];
    const edge = next ? next.getBoundingClientRect().left - 3 : (last?.getBoundingClientRect().right ?? bar.left + 8) + 1;
    return { pane, index, x: edge - bar.left };
  }
  return null;
}

/** Near an edge of a pane, a new pane on that side; in the middle of another pane, among its tabs. */
function paneDropAt(x: number, y: number, from: Pane): Target | null {
  const all = manager.all();
  for (const pane of all) {
    const r = pane.el?.getBoundingClientRect();
    if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const top = pane.tabsEl ? pane.tabsEl.getBoundingClientRect().bottom : r.top;
    const fx = (x - r.left) / r.width;
    const fy = (y - top) / (r.bottom - top);
    const canSplit = all.length < manager.MAX_PANES && (pane !== from || from.tabs.length > 1);
    let side: ZoneSide = 'center';
    if (canSplit) {
      const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
      if (edge < 0.28) side = edge === fx ? 'left' : edge === 1 - fx ? 'right' : edge === fy ? 'top' : 'bottom';
    }
    if (side === 'center' && pane === from) return null;
    return { pane, side };
  }
  return null;
}

export function dragTab(pane: Pane, down: MouseEvent, i: number): void {
  const el = tabEls(pane)[i];
  if (!el) return;
  let moving = false;
  let target: Target | null = null;
  let outside = false;
  const move = (m: MouseEvent) => {
    if (!moving && Math.hypot(m.clientX - down.clientX, m.clientY - down.clientY) < 5) return;
    moving = true;
    const bar = pane.stripEl?.getBoundingClientRect();
    const onBar = !!bar && m.clientY >= bar.top - 14 && m.clientY <= bar.bottom + 14;
    outside = m.clientX < 0 || m.clientY < 0 || m.clientX > innerWidth || m.clientY > innerHeight;
    target = outside ? null : (tabDropAt(m.clientX, m.clientY, el) ?? paneDropAt(m.clientX, m.clientY, pane));
    useDrag.setState({
      lifted: { pane: pane.id, index: i, dx: m.clientX - down.clientX, dy: onBar ? 0 : m.clientY - down.clientY },
      caret: target && 'index' in target ? { pane: target.pane.id, x: target.x } : null,
      zone: target && 'side' in target ? { pane: target.pane.id, side: target.side } : null,
    });
  };
  const up = () => {
    removeEventListener('mousemove', move);
    removeEventListener('mouseup', up);
    useDrag.setState({ lifted: null, caret: null, zone: null });
    if (!moving) return;
    if (outside) return pane.tabToWindow(i);
    const to = target;
    if (!to) return;
    if (!('side' in to)) manager.moveTab(pane, i, to.pane, to.index);
    else if (to.side === 'center') manager.moveTab(pane, i, to.pane, to.pane.tabs.length);
    else manager.splitWith(pane, i, to.pane, to.side);
  };
  addEventListener('mousemove', move);
  addEventListener('mouseup', up);
}
