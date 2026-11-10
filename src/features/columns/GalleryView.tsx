import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useT } from '@/i18n';
import { panes, usePanesRevision } from '@/lib/panes-api';
import { registry, type ViewProps } from '@/lib/registry';
import { cn } from '@/lib/utils';
import { useApp } from '@/lib/app-state';
import { factsOf, Picture } from './Facts';
import { useTabRows } from './listing';
import { findTyped, howOf, keyHasAction, moveBy, rowMenu, selectRow } from './select';

const CELL_W = 96;

/**
 * The gallery: the item with the cursor (or the one selected, or the first) large, its name and what it is under it,
 * over a strip of the folder's items that scrolls sideways. The strip selects, opens, drags and has the menu as the list.
 */
export function GalleryView({ pane, tab }: ViewProps) {
  const t = useT();
  usePanesRevision((s) => s.revision);
  const stripRef = useRef<HTMLDivElement>(null);
  const focused = panes.focused()?.id === pane.id;
  const virtual = useVirtualizer({ horizontal: true, count: tab.count, getScrollElement: () => stripRef.current, estimateSize: () => CELL_W, overscan: 6 });
  const items = virtual.getVirtualItems();
  const rowAt = useTabRows(tab, Math.min(items[0]?.index ?? 0, Math.max(0, tab.lead)), Math.max((items[items.length - 1]?.index ?? 0) + 1, tab.lead + 1));
  const scrollTo = (i: number) => virtual.scrollToIndex(i, { align: 'auto' });
  const shown = (tab.lead >= 0 ? rowAt(tab.lead) : null) ?? tab.selectedEntries()[0] ?? rowAt(0);
  const indexAt = (target: EventTarget): number | null => {
    const el = target instanceof Element ? target.closest('[data-index]') : null;
    return el ? Number(el.getAttribute('data-index')) : null;
  };

  useEffect(() => {
    if (tab.lead >= 0) scrollTo(tab.lead);
    // Only a new cursor scrolls; `scrollTo` is a new function each time.
  }, [tab.lead, tab.generation]);
  useEffect(() => {
    const active = document.activeElement;
    if (focused && (!active || active === document.body)) stripRef.current?.focus({ preventScroll: true });
  }, [tab.uri, focused]);

  const message = tab.error ? tab.error.replace(/^LZ-[A-Z]+:/, '') : tab.loading && !tab.generation ? t('loading') : !tab.count ? (tab.filter ? t('noMatch') : t('emptyFolder')) : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-6 pt-4 pb-3" onDoubleClick={() => shown && panes.action('open', pane)}>
        {shown ? (
          <>
            <div className="grid min-h-0 w-full flex-1 place-items-center">
              <Picture key={shown.uri} row={shown} points={1024} iconPoints={256} className="max-h-full max-w-full rounded-lg object-contain shadow-lg" iconClassName="size-48" />
            </div>
            <b className="max-w-full truncate text-[14px] font-semibold">{shown.name}</b>
            <div className="flex gap-3 text-[11px] text-fg-2">
              {factsOf(shown).map((fact) => (
                <span key={fact}>{fact}</span>
              ))}
            </div>
          </>
        ) : message ? (
          <p className="text-[13px] text-fg-2">{message}</p>
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
        onMouseDown={(e) => {
          panes.focus(pane);
          const i = indexAt(e.target);
          if (i == null) {
            if (e.button === 0 && !e.metaKey && !e.shiftKey && !e.ctrlKey) panes.action('deselect', pane);
            return;
          }
          const row = rowAt(i);
          if (!row) return;
          if (e.button === 0 && !(e.ctrlKey && useApp.getState().settings?.keymap !== 'windows')) {
            const how = howOf(e);
            if (how !== 'only' || !tab.isSel(row.name) || tab.selCount() !== 1) selectRow(pane, i, how, rowAt);
            panes.emit('pointerdown', { pane, event: e.nativeEvent, index: i });
          }
        }}
        onDoubleClick={(e) => indexAt(e.target) != null && panes.action('open', pane)}
        onContextMenu={(e) => {
          e.preventDefault();
          rowMenu(pane, e.clientX, e.clientY, indexAt(e.target), rowAt);
        }}
        onKeyDown={(e) => {
          if (e.metaKey || e.ctrlKey || e.altKey) return;
          // The strip runs sideways: every arrow moves by one.
          const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -Infinity, End: Infinity };
          const step = steps[e.key];
          if (step !== undefined) {
            const i = moveBy(pane, step, e.shiftKey, rowAt);
            if (i != null) scrollTo(i);
          } else if (e.key.length === 1 && e.key !== ' ' && !e.nativeEvent.isComposing && !keyHasAction(e)) findTyped(tab, e.key, scrollTo);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="relative h-full" style={{ width: virtual.getTotalSize() }}>
          {items.map((item) => {
            const row = rowAt(item.index);
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
                    <span className={cn('max-w-full truncate rounded-sm px-1 text-[11px] leading-4', sel && (focused ? 'bg-select text-primary-foreground' : 'bg-select-dim'))}>{row.name}</span>
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
