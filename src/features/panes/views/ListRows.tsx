// The rows of the list view, drawn only where they are on screen (a folder of a hundred thousand items scrolls as one
// of ten): the rows not loaded yet are asked for by range and generation, and drawn as placeholders until they come.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { fmtDate, fmtSize } from '@/lib/format';
import { cn } from '@/lib/utils';
import { pathOf } from '@/lib/uri';
import type { ColumnKey, Row } from '@/services';
import { COLUMNS } from '../columns';
import { manager } from '../manager';
import type { Pane } from '../pane';
import { placeLabel } from '../places';
import type { Tab } from '../tab';
import { GitMark, Picture, RenameField, TagDots } from './bits';
import { Marquee } from './Marquee';

type Shown = Array<ColumnKey | 'name'>;

export function ListRows({ pane, tab, columns, template, rowH, strong }: { pane: Pane; tab: Tab; columns: Shown; template: string; rowH: number; strong: boolean }) {
  const groups = pane.grouped();
  const lines = tab.count + (groups?.length ?? 0);
  pane.per = 1;
  pane.rowH = rowH;
  const virtual = useVirtualizer({ count: lines, getScrollElement: () => pane.listEl, estimateSize: () => rowH, overscan: 12 });
  const items = virtual.getVirtualItems();
  let first = Infinity;
  let last = -1;
  for (const item of items) {
    const at = groups ? pane.atLine(item.index) : item.index;
    if (at < 0) continue;
    first = Math.min(first, at);
    last = Math.max(last, at);
  }
  // After every drawing: the rows on screen that are not loaded are asked for (one request at a time).
  useEffect(() => {
    if (last >= 0) pane.ensure(first, last + 1);
  });

  return (
    <div
      ref={(el) => {
        pane.sizerEl = el;
      }}
      className="relative w-full"
      style={{ height: lines * rowH }}
    >
      {items.map((item) => {
        const at = groups ? pane.atLine(item.index) : item.index;
        const group = groups?.[-1 - at];
        if (at < 0)
          return (
            <div
              key={`h${tab.generation}:${item.index}`}
              role="presentation"
              className="absolute inset-x-0 flex items-end px-[8px] pb-[3px] text-[12px] font-bold text-fg shadow-[inset_0_-1px_0_var(--hair)]"
              style={{ top: item.start, height: rowH }}
            >
              {group?.[1]}
            </div>
          );
        return <ListRow key={`${tab.generation}:${at}`} pane={pane} tab={tab} index={at} top={item.start} rowH={rowH} columns={columns} template={template} strong={strong} />;
      })}
      {pane.marquee ? <Marquee box={pane.marquee} /> : null}
    </div>
  );
}

interface RowProps {
  pane: Pane;
  tab: Tab;
  index: number;
  top: number;
  rowH: number;
  columns: Shown;
  template: string;
  strong: boolean;
}

function ListRow({ pane, tab, index, top, rowH, columns, template, strong }: RowProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const e = tab.rows.get(index);
  const sel = !!e && tab.isSel(e.name);
  const bright = sel && strong;
  const name = e?.name;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    pane.itemEls.set(index, el);
    return () => {
      if (pane.itemEls.get(index) === el) pane.itemEls.delete(index);
    };
  }, [pane, index]);
  useLayoutEffect(() => {
    if (name != null && ref.current) pane.motion(ref.current, name);
  }, [pane, name]);
  return (
    <div
      ref={ref}
      id={`${tab.id}-${index}`}
      data-index={index}
      role="option"
      aria-selected={sel}
      className={cn(
        'absolute inset-x-0 grid items-center rounded-[6px] text-[13px] whitespace-nowrap transition-opacity duration-200 data-[drop]:shadow-[inset_0_0_0_2px_var(--tint)]',
        e && index % 2 === 1 && !sel && 'bg-stripe',
        sel && (bright ? 'bg-select text-primary-foreground' : 'bg-select-dim'),
        e && manager.cut.has(e.uri) && 'opacity-45',
      )}
      style={{ top, height: rowH, gridTemplateColumns: template }}
    >
      {e ? <Cells pane={pane} tab={tab} entry={e} index={index} columns={columns} bright={bright} /> : <div className="mx-[8px] h-[8px] w-2/5 animate-pulse rounded-full bg-field" />}
    </div>
  );
}

const sizeText = (e: Row): string => (e.isDir || e.kind === 'app' || e.kind === 'package' ? (e.dirSize != null ? fmtSize(e.dirSize) : '--') : fmtSize(e.size));

function Cells({ pane, tab, entry: e, index, columns, bright }: { pane: Pane; tab: Tab; entry: Row; index: number; columns: Shown; bright: boolean }) {
  const cell = cn('min-w-0 truncate px-[8px] text-[12px] tabular-nums', bright ? 'text-primary-foreground/85' : 'text-fg-2');
  const folder = e.uri.slice(0, e.uri.lastIndexOf('/')) || e.uri;
  const text: Record<ColumnKey, () => string> = {
    mtime: () => fmtDate(e.mtime),
    ctime: () => fmtDate(e.ctime),
    size: () => sizeText(e),
    kind: () => e.type || '',
    ext: () => (e.ext ? e.ext.toUpperCase() : '--'),
    where: () => placeLabel(folder),
  };
  return (
    <>
      <div className="flex min-w-0 items-center gap-[6px] px-[8px]">
        <Picture entry={e} points={16} className="size-[16px]" thumbClass="rounded-[2px]" />
        {pane.renaming?.index === index ? (
          <RenameField pane={pane} entry={e} className="-ml-[3px] flex-1" />
        ) : (
          <span data-hit className={cn('truncate', e.hidden && 'opacity-55')}>
            {e.name}
          </span>
        )}
        <TagDots entry={e} className="ml-[2px]" />
        <GitMark mark={tab.marks?.[e.name]} strong={bright} />
      </div>
      {columns.slice(1).map((key) =>
        key === 'name' ? null : (
          <div key={key} className={cn(cell, COLUMNS[key].num && 'text-right')} title={key === 'where' ? pathOf(folder) : undefined}>
            {text[key]()}
          </div>
        ),
      )}
    </>
  );
}
