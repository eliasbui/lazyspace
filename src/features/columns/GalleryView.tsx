import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { panes, usePanesRevision } from '@/lib/panes-api';
import { registry, type ViewProps } from '@/lib/registry';
import { cn } from '@/lib/utils';
import { factsOf, Picture, TagDots } from './Facts';
import { indexAt, menu, press, rowKey } from './select';

const CELL_W = 96;
// The strip runs sideways: every arrow moves by one.
const STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -Infinity, End: Infinity };

/**
 * The gallery: the item with the cursor (or the one selected, or the first) large, its name and what it is under it,
 * over a strip of the folder's items that scrolls sideways. The strip selects, opens, drags and has the menu as the list.
 */
export function GalleryView({ pane, tab }: ViewProps) {
  usePanesRevision((s) => s.revision);
  const stripRef = useRef<HTMLDivElement>(null);
  const focused = panes.focused()?.id === pane.id;
  const virtual = useVirtualizer({ horizontal: true, count: tab.count, getScrollElement: () => stripRef.current, estimateSize: () => CELL_W, overscan: 6 });
  const items = virtual.getVirtualItems();
  const first = items[0]?.index ?? 0;
  const last = items[items.length - 1]?.index ?? -1;
  const shown = (tab.lead >= 0 ? tab.rowAt(tab.lead) : null) ?? tab.selectedEntries()[0] ?? tab.rowAt(0);

  // After every drawing: the items on screen that are not loaded are asked for, as the list does.
  useEffect(() => {
    if (last >= 0) pane.ensure?.(first, last + 1);
  });
  useEffect(() => {
    if (tab.lead >= 0) virtual.scrollToIndex(tab.lead, { align: 'auto' });
  }, [tab.lead, tab.generation, virtual]);
  // The keyboard goes to the strip when the view comes, unless something else of the window has it.
  useEffect(() => {
    const active = document.activeElement;
    if (focused && (!active || active === document.body)) stripRef.current?.focus({ preventScroll: true });
  }, [tab.uri, focused]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-6 pt-4 pb-3" onDoubleClick={() => shown && panes.action('open', pane)}>
        {shown ? (
          <>
            {/* The picture is laid in the room left, centred, never bigger than it. */}
            <div className="relative min-h-0 w-full flex-1">
              <Picture
                key={shown.uri}
                row={shown}
                points={1024}
                iconPoints={256}
                className="absolute inset-0 m-auto max-h-full max-w-full rounded-lg object-contain shadow-lg"
                iconClassName="absolute inset-0 m-auto size-48 max-h-full max-w-full"
              />
            </div>
            <b className="max-w-full truncate text-[14px] font-semibold">{shown.name}</b>
            <div className="flex gap-3 text-[11px] text-fg-2">
              {factsOf(shown).map((fact) => (
                <span key={fact}>{fact}</span>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <div
        ref={stripRef}
        role="listbox"
        aria-multiselectable
        aria-orientation="horizontal"
        aria-label={registry.places.nameOf(tab.uri)}
        aria-activedescendant={tab.lead >= 0 ? `${tab.id}-strip-${tab.lead}` : undefined}
        tabIndex={0}
        className="relative h-[116px] shrink-0 overflow-x-auto overflow-y-hidden border-t border-hair outline-none"
        onMouseDown={(e) => press(pane, e)}
        onDoubleClick={(e) => indexAt(e.target) != null && panes.action('open', pane)}
        onContextMenu={(e) => menu(pane, e)}
        onKeyDown={(e) => {
          if (!rowKey(pane, e, STEPS)) return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="relative h-full" style={{ width: virtual.getTotalSize() }}>
          {items.map((item) => {
            const row = tab.rowAt(item.index);
            const sel = !!row && tab.isSel(row.name);
            return (
              <div
                key={item.key}
                id={`${tab.id}-strip-${item.index}`}
                role="option"
                aria-selected={sel}
                aria-label={row?.name}
                data-index={item.index}
                className={cn('absolute top-0 flex h-full w-[96px] flex-col items-center gap-1 px-1 pt-2.5', !!row && panes.cut.has(row.uri) && 'opacity-50')}
                style={{ left: item.start }}
              >
                {row ? (
                  <>
                    <div className={cn('grid size-16 place-items-center rounded-tile', sel && 'bg-select-dim')}>
                      <Picture row={row} points={64} iconPoints={56} className="max-h-14 max-w-14 rounded-sm object-contain shadow-sm" iconClassName="size-14" />
                    </div>
                    <span className={cn('flex max-w-full items-center gap-1 rounded-sm px-1 text-[11px] leading-4', sel && (focused ? 'bg-select text-primary-foreground' : 'bg-select-dim'))}>
                      <TagDots row={row} />
                      <span className="truncate">{row.name}</span>
                    </span>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
