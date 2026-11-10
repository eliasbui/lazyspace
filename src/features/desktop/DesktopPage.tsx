// The page of the desktop's window: the icons of ~/Desktop on the wallpaper, each in its cell, with a pane's selection
// (a click, Command and Shift, a rectangle, the arrows, typing a name), its keys, its menu, renaming in place, dragging
// out and dropping in.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { isLocal, pathOf } from '@/lib/uri';
import { cn } from '@/lib/utils';
import { api, getHost, iconUrl, pixelRatio, thumbUrl, type Row } from '@/services';
import { actionOf, arrange, commitRename, dropAt, range, runAction, select, selectedRows, showMenu, startDesktop, useDesk, VIEW } from './desk';
import { cellSize, covered, nearest, placeOf, type Direction } from './grid';

/** The kinds Quick Look makes a picture of. */
const THUMBNAILED = /^(jpe?g|png|gif|heic|heif|webp|tiff?|bmp|psd|mov|mp4|m4v|avi|pdf|key|pages|numbers|cr2|nef|arw|dng|raf|orf)$/i;

function Picture({ row, size }: { row: Row; size: number }) {
  const px = size * pixelRatio();
  const thumb = row.kind === 'file' && THUMBNAILED.test(row.ext) && isLocal(row.uri) ? thumbUrl(pathOf(row.uri), px) : null;
  const [failed, setFailed] = useState(false);
  return <img src={thumb && !failed ? thumb : iconUrl(row.icon, px)} alt="" draggable={false} onError={() => setFailed(true)} className="object-contain drop-shadow-sm" style={{ width: size, height: size }} />;
}

function NameField({ name }: { name: string }) {
  const t = useT();
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) commitRename(name, value);
    else useDesk.setState({ renaming: null });
  };
  return (
    <Input
      autoFocus
      aria-label={t('m.rename')}
      value={value}
      spellCheck={false}
      className="h-auto w-full rounded-[5px] px-1 py-0.5 text-center text-[12px] leading-[15px] md:text-[12px]"
      onChange={(e) => setValue(e.target.value)}
      // The name is chosen without its extension, as Finder does.
      onFocus={(e) => {
        const dot = name.lastIndexOf('.');
        e.target.setSelectionRange(0, dot > 0 ? dot : name.length);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function DesktopPage() {
  const t = useT();
  const { rows, cells, sel, lead, renaming, cut, dropOn, width } = useDesk(
    useShallow((s) => ({ rows: s.rows, cells: s.cells, sel: s.sel, lead: s.lead, renaming: s.renaming, cut: s.cut, dropOn: s.dropOn, width: s.width })),
  );
  const icon = useApp((s) => s.settings?.icon_size ?? 64);
  const box = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [active, setActive] = useState(() => document.hasFocus());
  const typed = useRef({ text: '', at: 0 });

  useEffect(() => {
    // The window paints nothing of its own: the icons lie on the wallpaper.
    document.documentElement.classList.add('desktop');
    startDesktop();
    const el = box.current;
    if (!el) return;
    el.focus();
    const measure = () => {
      const r = el.getBoundingClientRect();
      useDesk.setState({ width: r.width, height: r.height, box: { left: r.left, top: r.top, width: r.width } });
      void arrange();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const focus = () => setActive(true);
    const blur = () => setActive(false);
    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);
    return () => {
      observer.disconnect();
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
    };
  }, []);
  // A new icon size makes a new grid.
  useEffect(() => void arrange(), [icon]);

  const { w, h } = cellSize(icon);
  const nameAt = (target: EventTarget): string | null => (target instanceof Element ? (target.closest<HTMLElement>('[data-desk-name]')?.dataset.deskName ?? null) : null);

  // A rectangle drawn from an empty place selects what it meets; with Command or Shift it adds to the selection.
  function startMarquee(down: ReactPointerEvent, adding: boolean) {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const base = adding ? [...useDesk.getState().sel] : [];
    const x0 = down.clientX - r.left;
    const y0 = down.clientY - r.top;
    const moveTo = (m: PointerEvent) => {
      const x = m.clientX - r.left;
      const y = m.clientY - r.top;
      const rect = { left: Math.min(x0, x), top: Math.min(y0, y), right: Math.max(x0, x), bottom: Math.max(y0, y) };
      setMarquee(rect);
      const met = covered(rect, useDesk.getState().cells, r.width, icon);
      select([...new Set([...base, ...met])], met[met.length - 1] ?? null);
    };
    const up = () => {
      removeEventListener('pointermove', moveTo);
      removeEventListener('pointerup', up);
      setMarquee(null);
    };
    addEventListener('pointermove', moveTo);
    addEventListener('pointerup', up);
  }

  // Outside the app no drag of the system takes the icons, so the page moves them itself.
  function startPageDrag(down: ReactPointerEvent, name: string) {
    let moved = false;
    const moveTo = (m: PointerEvent) => {
      const dx = m.clientX - down.clientX;
      const dy = m.clientY - down.clientY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      setDrag({ dx, dy });
    };
    const up = (u: PointerEvent) => {
      removeEventListener('pointermove', moveTo);
      removeEventListener('pointerup', up);
      setDrag(null);
      if (moved) dropAt({ x: u.clientX, y: u.clientY, uris: selectedRows().map((r) => r.uri), mode: 'move' });
      // A press on a selected icon that did not drag selects it alone.
      else select([name]);
    };
    addEventListener('pointermove', moveTo);
    addEventListener('pointerup', up);
  }

  function pointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    box.current?.focus();
    const name = nameAt(e.target);
    const { sel: now, anchor } = useDesk.getState();
    const toggle = e.metaKey || e.ctrlKey;
    if (!name) {
      if (!toggle && !e.shiftKey) select([]);
      startMarquee(e, toggle || e.shiftKey);
      return;
    }
    if (toggle) {
      const next = new Set(now);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      select([...next], name);
      return;
    }
    if (e.shiftKey) {
      select(range(name), name, anchor ?? name);
      return;
    }
    if (!now.has(name)) select([name]);
    // A press on a selected item readies a drag of the selection out of the window, or onto another place of it.
    if (getHost().native) {
      if (selectedRows().every((r) => isLocal(r.uri))) api.drag.arm({ view: VIEW, selection: { names: [...useDesk.getState().sel] } }).catch(() => undefined);
    } else startPageDrag(e, name);
  }

  function keyDown(e: KeyboardEvent) {
    const action = actionOf(e);
    if (action && runAction(action)) {
      e.preventDefault();
      return;
    }
    const arrows: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const direction = arrows[e.key];
    if (direction && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const state = useDesk.getState();
      const from = state.lead ? state.cells[state.lead] : undefined;
      const next = from ? nearest(from, state.cells, direction) : (rows.find((r) => state.cells[r.name])?.name ?? null);
      if (!next) return;
      if (e.shiftKey) select([...state.sel, next], next, state.anchor);
      else select([next]);
      return;
    }
    // Typing the start of a name selects the first item it fits, as Finder does.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== ' ') {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 1000 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const hit = rows.find((r) => r.name.toLowerCase().startsWith(typed.current.text));
      if (hit) select([hit.name]);
    }
  }

  const leadIndex = rows.findIndex((r) => r.name === lead);

  return (
    <div
      ref={box}
      data-desk-list
      role="listbox"
      aria-label={t('desktopItems')}
      aria-multiselectable
      aria-activedescendant={leadIndex >= 0 ? `desk-${leadIndex}` : undefined}
      tabIndex={0}
      className="group relative h-full w-full overflow-hidden outline-none"
      onPointerDown={pointerDown}
      onDoubleClick={(e) => {
        if (nameAt(e.target) && !renaming) runAction('open');
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const name = nameAt(e.target);
        if (name && !useDesk.getState().sel.has(name)) select([name]);
        if (!name) select([]);
        showMenu(name ? 'item' : 'empty', e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        if (!renaming) keyDown(e);
      }}
    >
      {rows.map((row, index) => {
        const cell = cells[row.name];
        // An item not placed yet waits out of sight.
        if (!cell) return null;
        const selected = sel.has(row.name);
        const at = placeOf(cell, width, icon);
        const moving = !!drag && selected;
        return (
          <div
            key={row.name}
            id={`desk-${index}`}
            role="option"
            aria-selected={selected}
            data-desk-name={row.name}
            className={cn('absolute flex flex-col items-center gap-1 pt-1', moving && 'pointer-events-none opacity-80', cut.has(row.uri) && 'opacity-50')}
            style={{ left: at.left + (moving ? drag.dx : 0), top: at.top + (moving ? drag.dy : 0), width: w, height: h }}
          >
            <div className={cn('rounded-tile p-1', selected && 'desk-pick', dropOn === row.name && 'ring-2 ring-tint')}>
              <Picture key={row.uri} row={row} size={icon} />
            </div>
            {renaming === row.name ? (
              <NameField name={row.name} />
            ) : (
              <span
                className={cn(
                  'line-clamp-2 max-w-full rounded-[5px] px-1.5 py-px text-center text-[12px] leading-[15px] font-medium break-words',
                  selected ? (active ? 'bg-tint text-primary-foreground' : 'desk-pick desk-label') : 'desk-label',
                  row.name === lead && 'group-focus-visible:ring-2 group-focus-visible:ring-ring',
                )}
              >
                {row.name}
              </span>
            )}
          </div>
        );
      })}
      {marquee ? (
        <div className="pointer-events-none absolute rounded-[3px] border border-tint bg-tint-soft" style={{ left: marquee.left, top: marquee.top, width: marquee.right - marquee.left, height: marquee.bottom - marquee.top }} />
      ) : null}
    </div>
  );
}
