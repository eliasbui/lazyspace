// Dragging out: a press on a selected item of this Mac readies a native drag of the selection. Dropping in: files
// dragged over the window light up the folder under the pointer and are copied or moved there. Items not on this Mac
// (a cloud, a server, an archive) have no file a drag of the system could carry, so within the window the page drags
// them itself onto the same targets. A folder or tab held under a drag for a moment opens (spring-loaded).
//
// Targets outside the panes say what they take with attributes: `data-drop-uri` (a place of the sidebar) and
// `data-drop-quick` (Quick Access, which pins what is dropped on it).
import { sidebar } from '@/lib/sidebar-api';
import { say } from '@/lib/ui';
import { isLocal, samePlace } from '@/lib/uri';
import { api, on, type Uri } from '@/services';
import { manager } from '../manager';
import { Motion } from '../motion';
import { useDrag } from './state';

interface Target {
  el: Element;
  uri?: Uri;
  quick?: boolean;
  /** What a drag held over it opens. */
  open?: () => void;
  /** The list of a pane, which takes a drop without a motion of its own. */
  list?: boolean;
}

const SPRING_MS = 800;
let lit: Element | null = null;
let spring: ReturnType<typeof setTimeout> | undefined;

/** Lights the target up (`data-drop`), and opens it if the drag stays on it. */
function light(target: Target | null): void {
  const el = target?.el ?? null;
  if (lit === el) return;
  lit?.removeAttribute('data-drop');
  lit = el;
  lit?.setAttribute('data-drop', '');
  clearTimeout(spring);
  const open = target?.open;
  if (open)
    spring = setTimeout(() => {
      light(null);
      open();
    }, SPRING_MS);
}

/** The folder under the point: a place of the sidebar, a tab, a folder row, else the folder of the pane. */
function targetAt(x: number, y: number): Target | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const place = el.closest('[data-drop-uri]');
  const placeUri = place?.getAttribute('data-drop-uri');
  if (place && placeUri) return { el: place, uri: placeUri, open: () => manager.open(placeUri) };
  const quick = el.closest('[data-drop-quick]');
  if (quick) return { el: quick, quick: true };
  const paneEl = el.closest('[data-pane-id]');
  const pane = manager.all().find((p) => p.el === paneEl);
  if (!pane) return null;
  const tabEl = el.closest('[data-tab-index]');
  if (tabEl) {
    const i = Number(tabEl.getAttribute('data-tab-index'));
    const tab = pane.tabs[i];
    return tab ? { el: tabEl, uri: tab.uri, open: () => pane.activate(i) } : null;
  }
  const rowEl = el.closest('[data-index]');
  const entry = rowEl ? pane.tab.rows.get(Number(rowEl.getAttribute('data-index'))) : undefined;
  if (rowEl && entry?.isDir) return { el: rowEl, uri: entry.uri, open: () => pane.navigate(entry.uri) };
  return pane.tab.capabilities.write && pane.listEl ? { el: pane.listEl, uri: pane.tab.uri, list: true } : null;
}

function take(target: Target, from: Uri[], mode: 'copy' | 'move' | 'auto'): void {
  if (!target.uri) return;
  if (!target.list) Motion.take(target.el);
  api.fs.copy({ from, to: target.uri, mode }).catch(say);
}

/** Drags the selected items that are not on this Mac within the window. Option copies, Command moves, as a drop does. */
function dragWithin(down: MouseEvent, name: string, from: Uri[], source: Uri): void {
  let moving = false;
  const fits = (target: Target | null): target is Target =>
    !!target && (!!target.quick || (!!target.uri && !samePlace(target.uri, source) && !from.some((u) => samePlace(u, target.uri))));
  const move = (m: MouseEvent) => {
    if (!moving && Math.hypot(m.clientX - down.clientX, m.clientY - down.clientY) < 4) return;
    moving = true;
    useDrag.setState({ ghost: { text: from.length > 1 ? `${name} +${from.length - 1}` : name, x: m.clientX + 12, y: m.clientY + 8 } });
    const target = targetAt(m.clientX, m.clientY);
    light(fits(target) ? target : null);
  };
  const end = (u: MouseEvent | KeyboardEvent) => {
    removeEventListener('mousemove', move);
    removeEventListener('mouseup', end);
    removeEventListener('keydown', escape, true);
    light(null);
    if (!moving) return;
    useDrag.setState({ ghost: null });
    if (!(u instanceof MouseEvent)) return;
    const target = targetAt(u.clientX, u.clientY);
    if (!fits(target)) return;
    if (target.quick) return sidebar.pinDropped(from);
    take(target, from, u.altKey ? 'copy' : u.metaKey ? 'move' : 'auto');
  };
  const escape = (k: KeyboardEvent) => {
    if (k.key !== 'Escape' || !moving) return;
    k.stopPropagation();
    end(k);
  };
  addEventListener('mousemove', move);
  addEventListener('mouseup', end);
  addEventListener('keydown', escape, true);
}

export function listenDrops(): void {
  manager.on('pointerdown', ({ pane, event, index }) => {
    if (event.button !== 0 || event.shiftKey || event.metaKey) return;
    const tab = pane.tab;
    const e = tab.rowAt(index);
    if (!e || !tab.isSel(e.name)) return;
    if (isLocal(e.uri)) api.drag.arm(tab.selection()).catch(() => undefined);
    else
      dragWithin(
        event,
        e.name,
        tab.selectedEntries().map((x) => x.uri),
        tab.uri,
      );
  });
  on('drop.over', (d) => light(targetAt(d.x, d.y)));
  on('drop.leave', () => light(null));
  on('drop', (d) => {
    const target = targetAt(d.x, d.y);
    light(null);
    if (!target) return;
    // A feature may take a drop itself: the desktop moves its own icons where they are dropped.
    if (manager.dropHandler?.(d, { uri: target.uri, quick: target.quick, element: target.el })) return;
    if (target.quick) return sidebar.pinDropped(d.uris);
    take(target, d.uris, d.mode);
  });
}
