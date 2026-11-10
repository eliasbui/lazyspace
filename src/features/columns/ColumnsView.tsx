import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useT } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { panes, usePanesRevision, type PaneHandle } from '@/lib/panes-api';
import { registry, type ViewProps } from '@/lib/registry';
import { say } from '@/lib/ui';
import { nameOf } from '@/lib/uri';
import { cn } from '@/lib/utils';
import { api, type Row, type Uri, type ViewSort } from '@/services';
import { factsOf, GitMark, Picture, TagDots } from './Facts';
import { useListing, useTabRows } from './listing';
import { above, iconOf } from './places';
import { findTyped, howOf, keyHasAction, moveBy, rowMenu, selectRow } from './select';

const ROW_H = 24;

const opens = (row: Row): boolean => row.isDir || !!registry.vfs.browse(row);

function Chevron({ on }: { on: boolean }) {
  return <CaretRightIcon weight="bold" className={cn('size-2.5 shrink-0', on ? 'text-primary-foreground/80' : 'text-fg-3')} />;
}

/**
 * A column of a folder above the tab's, or of the folder selected in it: a listing of its own, shown only, with the way
 * down marked. A click goes there with the row selected; a double click on a file opens it.
 */
const FolderColumn = memo(function FolderColumn({ pane, uri, marked, sort, showHidden, focusTab }: { pane: PaneHandle; uri: Uri; marked: string | null; sort: ViewSort; showHidden: boolean; focusTab: () => void }) {
  const t = useT();
  const { rows, count } = useListing(uri, sort, showHidden);
  const markedRef = useRef<HTMLLIElement>(null);
  useEffect(() => markedRef.current?.scrollIntoView({ block: 'nearest' }), [rows, marked]);
  return (
    <ul aria-label={registry.places.nameOf(uri)} className="w-[230px] shrink-0 overflow-y-auto border-r border-hair px-1.5 py-1">
      {!rows ? <li className="px-2 py-2.5 text-[11px] text-fg-2">{t('loading')}</li> : null}
      {rows?.map((row) => (
        <li
          key={row.name}
          ref={row.name === marked ? markedRef : undefined}
          onClick={() => {
            pane.navigate(uri, { select: [row.name] });
            focusTab();
          }}
          onDoubleClick={() => !opens(row) && api.native.open({ uris: [row.uri] }).catch(say)}
          className={cn('flex h-6 items-center gap-1.5 rounded-md px-2 text-[13px] whitespace-nowrap hover:bg-hover', row.name === marked && 'bg-select-dim hover:bg-select-dim', row.hidden && 'opacity-60')}
        >
          <img src={iconOf(row, 16)} alt="" draggable={false} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          {opens(row) ? <Chevron on={false} /> : null}
        </li>
      ))}
      {rows && count > rows.length ? <li className="px-2 py-2.5 text-[11px] text-fg-2">{t('columnTooBig', rows.length)}</li> : null}
    </ul>
  );
});

/** The preview of one file, as the last column of Finder's shows it. */
function PreviewColumn({ row }: { row: Row }) {
  return (
    <div className="flex w-[280px] shrink-0 flex-col items-center gap-2 overflow-y-auto px-4 py-6 text-center">
      <Picture row={row} points={256} iconPoints={128} className="max-h-[220px] max-w-full rounded-md shadow-md" iconClassName="size-32" />
      <b className="text-[13px] font-semibold break-words">{row.name}</b>
      <div className="flex flex-col gap-0.5 text-[11px] text-fg-2">
        {factsOf(row).map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
      </div>
    </div>
  );
}

/** The tab's own folder as a column: its rows, its selection, its keys and its menu are the tab's, as in the list. */
function TabColumn({ pane, columnRef }: { pane: PaneHandle; columnRef: RefObject<HTMLDivElement | null> }) {
  const tab = pane.tab;
  const focused = panes.focused()?.id === pane.id;
  const virtual = useVirtualizer({ count: tab.count, getScrollElement: () => columnRef.current, estimateSize: () => ROW_H, overscan: 12 });
  const items = virtual.getVirtualItems();
  const rowAt = useTabRows(tab, items[0]?.index ?? 0, (items[items.length - 1]?.index ?? 0) + 1);
  const scrollTo = (i: number) => virtual.scrollToIndex(i, { align: 'auto' });
  const indexAt = (target: EventTarget): number | null => {
    const el = target instanceof Element ? target.closest('[data-index]') : null;
    return el ? Number(el.getAttribute('data-index')) : null;
  };
  // A new place shows from its top.
  useLayoutEffect(() => {
    if (columnRef.current) columnRef.current.scrollTop = 0;
  }, [tab.uri, columnRef]);
  useEffect(() => {
    if (tab.lead >= 0) scrollTo(tab.lead);
    // Only a new cursor scrolls; `scrollTo` is a new function each time.
  }, [tab.lead, tab.generation]);

  return (
    <div
      ref={columnRef}
      role="listbox"
      aria-multiselectable
      aria-label={registry.places.nameOf(tab.uri)}
      aria-activedescendant={tab.lead >= 0 ? `${tab.id}-col-${tab.lead}` : undefined}
      tabIndex={0}
      data-tab-column
      className="relative w-[260px] shrink-0 overflow-y-auto border-r border-hair px-1.5 py-1 outline-none"
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
        const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
        if (!plain) return;
        const steps: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity, PageDown: 20, PageUp: -20 };
        const step = steps[e.key];
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') panes.action(e.key === 'ArrowLeft' ? 'columnOut' : 'columnIn', pane);
        else if (step !== undefined) {
          const i = moveBy(pane, step, e.shiftKey, rowAt);
          if (i != null) scrollTo(i);
        } else if (e.key.length === 1 && e.key !== ' ' && !e.nativeEvent.isComposing && !keyHasAction(e)) findTyped(tab, e.key, scrollTo);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="relative" style={{ height: virtual.getTotalSize() }}>
        {items.map((item) => {
          const row = rowAt(item.index);
          const sel = !!row && tab.isSel(row.name);
          const lit = sel && focused;
          return (
            <div
              key={item.key}
              id={`${tab.id}-col-${item.index}`}
              role="option"
              aria-selected={sel}
              data-index={item.index}
              className={cn(
                'absolute inset-x-0 flex h-6 items-center gap-1.5 rounded-md px-2 text-[13px] whitespace-nowrap',
                lit ? 'bg-select text-primary-foreground' : sel && 'bg-select-dim',
                row?.hidden && 'opacity-60',
                !!row && panes.cut.has(row.uri) && 'opacity-50',
              )}
              style={{ top: item.start }}
            >
              {row ? (
                <>
                  <img src={iconOf(row, 16)} alt="" draggable={false} className="size-4 shrink-0" />
                  <span className="min-w-0 truncate">{row.name}</span>
                  <TagDots row={row} />
                  <span className="flex-1" />
                  <GitMark mark={tab.marks?.[row.name]} lit={lit} />
                  {opens(row) ? <Chevron on={lit} /> : null}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The column view, as Finder has it: the tab's folder is one column after the folders above it, each with the way down
 * marked; one folder selected opens in the column after it, and one file shows a preview there. The strip scrolls
 * sideways and keeps its right end in sight.
 */
export function ColumnsView({ pane, tab }: ViewProps) {
  usePanesRevision((s) => s.revision);
  const home = useApp((s) => s.places?.home ?? null);
  const showHidden = useApp((s) => !!s.settings?.show_hidden);
  const stripRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  // One sort object while the sort stays, so the columns of other folders are not drawn again for nothing.
  const now = pane.sortOf(tab);
  const sortKey = `${now.by}|${now.desc}|${now.foldersFirst}`;
  const sort = useMemo<ViewSort>(() => now, [sortKey]);

  const folders = above(tab.uri, home);
  const marked = [...folders.slice(1), tab.uri].map((u) => nameOf(u));
  const one = tab.selCount() === 1 ? (tab.selectedEntries()[0] ?? null) : null;
  const into = one ? pane.browsable(one) : null;
  const focusTab = useCallback(() => requestAnimationFrame(() => columnRef.current?.focus({ preventScroll: true })), []);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (strip) strip.scrollLeft = strip.scrollWidth;
  }, [tab.uri, into, one?.uri]);
  // The keyboard goes to the tab's column when the view comes, unless something else of the window has it.
  useEffect(() => {
    const active = document.activeElement;
    if (panes.focused()?.id === pane.id && (!active || active === document.body || stripRef.current?.contains(active))) columnRef.current?.focus({ preventScroll: true });
  }, [tab.uri, pane.id]);

  return (
    <div ref={stripRef} className="flex min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
      {folders.map((uri, i) => (
        <FolderColumn key={uri} pane={pane} uri={uri} marked={marked[i] ?? null} sort={sort} showHidden={showHidden} focusTab={focusTab} />
      ))}
      <TabColumn pane={pane} columnRef={columnRef} />
      {into ? <FolderColumn key={`into:${into}`} pane={pane} uri={into} marked={null} sort={sort} showHidden={showHidden} focusTab={focusTab} /> : one ? <PreviewColumn row={one} /> : null}
    </div>
  );
}
