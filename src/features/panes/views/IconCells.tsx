// The icons view: a grid of tiles, as many to a line as fit, centred; only the lines on screen are drawn, and pictures
// and documents show a thumbnail Quick Look makes of them.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import type { metrics } from '../columns';
import { manager } from '../manager';
import type { Pane } from '../pane';
import type { Tab } from '../tab';
import { Picture, RenameField, TagDots } from './bits';
import { Marquee } from './Marquee';

type Size = ReturnType<typeof metrics>;

export function IconCells({ pane, tab, width, size, strong }: { pane: Pane; tab: Tab; width: number; size: Size; strong: boolean }) {
  const { cellW, cellH } = size;
  const room = Math.max(0, width - 16);
  const per = Math.max(1, Math.floor(room / cellW));
  const lines = Math.ceil(tab.count / per);
  const offset = Math.max(0, (room - per * cellW) / 2);
  pane.per = per;
  pane.rowH = cellH;
  const virtual = useVirtualizer({ count: lines, getScrollElement: () => pane.listEl, estimateSize: () => cellH, overscan: 3 });
  const items = virtual.getVirtualItems();
  const first = (items[0]?.index ?? 0) * per;
  const last = Math.min(tab.count, ((items[items.length - 1]?.index ?? -1) + 1) * per);
  useEffect(() => {
    if (last > first) pane.ensure(first, last);
  });
  return (
    <div
      ref={(el) => {
        pane.sizerEl = el;
      }}
      className="relative w-full"
      style={{ height: lines * cellH + 8 }}
    >
      {items.flatMap((item) =>
        Array.from({ length: per }, (_, c) => {
          const i = item.index * per + c;
          if (i >= tab.count) return null;
          return <IconCell key={`${tab.generation}:${i}`} pane={pane} tab={tab} index={i} left={c * cellW + offset} top={item.index * cellH + 6} size={size} strong={strong} />;
        }),
      )}
      {pane.marquee ? <Marquee box={pane.marquee} /> : null}
    </div>
  );
}

function IconCell({ pane, tab, index, left, top, size, strong }: { pane: Pane; tab: Tab; index: number; left: number; top: number; size: Size; strong: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const e = tab.rows.get(index);
  const sel = !!e && tab.isSel(e.name);
  const name = e?.name;
  const { icon } = size;
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
      className={cn('group/cell absolute flex flex-col items-center gap-[4px] rounded-[10px] pt-[8px] transition-opacity duration-200', e && manager.cut.has(e.uri) && 'opacity-45')}
      style={{ left, top, width: icon + 40, height: icon + 40 }}
    >
      <div
        className={cn('grid flex-none place-items-center rounded-[6px] group-data-[drop]/cell:shadow-[0_0_0_2px_var(--tint)]', sel && 'bg-select-dim', !e && 'animate-pulse bg-field')}
        style={{ width: icon, height: icon }}
      >
        {e ? <Picture entry={e} points={icon} thumbClass="rounded-[4px] shadow-[0_1px_3px_var(--glass-shadow)]" /> : null}
      </div>
      {e && pane.renaming?.index === index ? (
        <RenameField pane={pane} entry={e} className="relative z-10 w-[150%] text-center text-[12px]" />
      ) : e ? (
        <div
          data-hit
          className={cn('line-clamp-2 shrink-0 rounded-[4px] px-[5px] py-px text-center text-[12px] leading-[1.25] break-words', sel && (strong ? 'bg-select text-primary-foreground' : 'bg-select-dim'))}
          style={{ maxWidth: icon + 32 }}
        >
          <TagDots entry={e} className="mr-[4px]" />
          {e.name}
        </div>
      ) : null}
    </div>
  );
}
