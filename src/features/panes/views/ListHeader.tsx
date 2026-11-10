// The header of the list: a click on a column sorts by it (again turns the order over), a drag of its left edge makes it
// wider or narrower, a drag of the column moves it among the others, and a right click lists the columns and the groups.
import { useRef, useState, type MouseEvent } from 'react';
import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react';
import { useT } from '@/i18n';
import { setSetting, useApp } from '@/lib/app-state';
import { cn } from '@/lib/utils';
import type { ColumnKey } from '@/services';
import { COLUMNS, isColumn } from '../columns';
import { manager } from '../manager';
import { columnsMenu } from '../menu/menus';
import type { Pane } from '../pane';

type Shown = Array<ColumnKey | 'name'>;

/** The order of Settings' columns after `key` was dragged to `to` among those shown; those that did not fit keep the end. */
function reordered(shown: Shown, key: ColumnKey, to: number): ColumnKey[] {
  const order = shown.filter(isColumn).filter((c) => c !== key);
  order.splice(to, 0, key);
  const kept = useApp.getState().settings?.columns ?? [];
  return [...order.filter((c) => kept.includes(c)), ...kept.filter((c) => !order.includes(c))];
}

export function ListHeader({ pane, columns, template, gutter, dim }: { pane: Pane; columns: Shown; template: string; gutter: number; dim: boolean }) {
  const t = useT();
  const sort = pane.sortOf(pane.tab);
  const head = useRef<HTMLDivElement | null>(null);
  const [moving, setMoving] = useState<{ key: ColumnKey; dx: number } | null>(null);
  const dragged = useRef(false);

  const resize = (e: MouseEvent, key: ColumnKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const start = pane.cols[key];
    const move = (m: globalThis.MouseEvent) => {
      pane.cols[key] = Math.min(400, Math.max(50, start - (m.clientX - startX)));
      pane.touch();
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      manager.saveSoon();
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  };

  const reorder = (e: MouseEvent, key: ColumnKey) => {
    if (e.button !== 0) return;
    dragged.current = false;
    const cells = [...(head.current?.querySelectorAll<HTMLElement>('[data-col]') ?? [])];
    const rects = new Map(cells.map((c) => [c.dataset.col ?? '', c.getBoundingClientRect()]));
    const own = rects.get(key);
    if (!own) return;
    const startX = e.clientX;
    let dx = 0;
    const move = (m: globalThis.MouseEvent) => {
      dx = m.clientX - startX;
      if (!dragged.current && Math.abs(dx) < 5) return;
      dragged.current = true;
      setMoving({ key, dx });
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      setMoving(null);
      if (!dragged.current) return;
      const centre = own.left + own.width / 2 + dx;
      const others = columns.filter(isColumn).filter((c) => c !== key);
      const to = others.filter((c) => {
        const r = rects.get(c);
        return !!r && r.left + r.width / 2 < centre;
      }).length;
      void setSetting({ columns: reordered(columns, key, to) });
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  };

  return (
    <div
      ref={head}
      role="row"
      className={cn('group/head mx-[8px] grid h-[26px] flex-none items-center text-[11px] font-medium text-fg-2 shadow-[inset_0_-1px_0_var(--hair)] transition-opacity', dim && 'opacity-60')}
      style={{ gridTemplateColumns: template, paddingRight: gutter }}
      onContextMenu={(e) => {
        e.preventDefault();
        void columnsMenu(pane, e.clientX, e.clientY);
      }}
    >
      {columns.map((key, i) => {
        const sorted = sort.by === key;
        const num = !!COLUMNS[key].num;
        const lifted = moving?.key === key;
        return (
          <div
            key={key}
            data-col={key}
            role="columnheader"
            aria-sort={sorted ? (sort.desc ? 'descending' : 'ascending') : 'none'}
            className={cn('relative h-full min-w-0', lifted && 'z-10 rounded-[4px] bg-pane shadow-md')}
            style={lifted ? { transform: `translateX(${moving.dx}px)` } : undefined}
          >
            {i > 0 ? <span aria-hidden className="absolute top-[7px] bottom-[7px] left-0 w-px bg-hair opacity-0 transition-opacity group-hover/head:opacity-100" /> : null}
            <button
              type="button"
              className={cn('flex h-full w-full min-w-0 items-center gap-[4px] px-[8px] text-left', num && 'justify-end', sorted && 'text-fg')}
              onMouseDown={(e) => {
                if (isColumn(key)) reorder(e, key);
              }}
              onClick={() => {
                if (!dragged.current) pane.sortBy(key);
                dragged.current = false;
              }}
            >
              <span className="truncate">{t(COLUMNS[key].word)}</span>
              {sorted ? sort.desc ? <CaretDownIcon weight="bold" className="size-[8px] flex-none opacity-80" /> : <CaretUpIcon weight="bold" className="size-[8px] flex-none opacity-80" /> : null}
            </button>
            {isColumn(key) ? <span aria-hidden className="absolute top-0 -left-[4px] z-10 h-full w-[8px] cursor-col-resize" onMouseDown={(e) => resize(e, key)} /> : null}
          </div>
        );
      })}
    </div>
  );
}
