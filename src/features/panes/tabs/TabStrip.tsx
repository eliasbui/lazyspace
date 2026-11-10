// The tabs of a pane, as File Explorer has them: tabs of the same width that shrink as more open, each with its folder's
// icon and name (or the name given to it) and its close button. A click shows one and a drag moves it, here or to another
// pane; its button or the middle button closes it; a double click names it, and on the empty bar opens a new one.
import { useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { PlusIcon, XIcon } from '@phosphor-icons/react';
import { cva } from 'class-variance-authority';
import { IconButton } from '@/components/macos/Tip';
import { useT } from '@/i18n';
import { registry } from '@/lib/registry';
import { isLocal, pathOf } from '@/lib/uri';
import { cn } from '@/lib/utils';
import type { TabColor } from '@/services';
import { dragTab } from '../dnd/tabs';
import { useDrag } from '../dnd/state';
import { tabMenu } from '../menu/menus';
import type { Pane } from '../pane';
import { placeIcon } from '../places';
import type { Tab } from '../tab';

const tabStyle = cva(
  'group/tab relative flex h-[28px] min-w-[96px] flex-[0_1_200px] items-center gap-[8px] rounded-field pr-[4px] pl-[10px] text-[12px] whitespace-nowrap transition-colors duration-150 data-[drop]:shadow-[inset_0_0_0_2px_var(--tint)] focus-visible:outline-2 focus-visible:outline-ring',
  {
    variants: {
      active: { true: 'bg-field font-medium text-fg', false: 'text-fg-2 hover:bg-hover hover:text-fg' },
      color: { none: '', red: '', orange: '', yellow: '', green: '', blue: '', purple: '', gray: '' },
      lifted: { true: 'z-10 bg-pane opacity-95 shadow-lg transition-none', false: '' },
    },
    // A tab marked with a colour shows a band of it (along the top when shown, along the side when not) and a tint.
    compoundVariants: [
      { color: 'red', active: true, class: 'bg-mark-red/15 shadow-[inset_0_2px_0_var(--mark-red)]' },
      { color: 'orange', active: true, class: 'bg-mark-orange/15 shadow-[inset_0_2px_0_var(--mark-orange)]' },
      { color: 'yellow', active: true, class: 'bg-mark-yellow/15 shadow-[inset_0_2px_0_var(--mark-yellow)]' },
      { color: 'green', active: true, class: 'bg-mark-green/15 shadow-[inset_0_2px_0_var(--mark-green)]' },
      { color: 'blue', active: true, class: 'bg-mark-blue/15 shadow-[inset_0_2px_0_var(--mark-blue)]' },
      { color: 'purple', active: true, class: 'bg-mark-purple/15 shadow-[inset_0_2px_0_var(--mark-purple)]' },
      { color: 'gray', active: true, class: 'bg-mark-gray/15 shadow-[inset_0_2px_0_var(--mark-gray)]' },
      { color: 'red', active: false, class: 'bg-mark-red/10 shadow-[inset_3px_0_0_var(--mark-red)]' },
      { color: 'orange', active: false, class: 'bg-mark-orange/10 shadow-[inset_3px_0_0_var(--mark-orange)]' },
      { color: 'yellow', active: false, class: 'bg-mark-yellow/10 shadow-[inset_3px_0_0_var(--mark-yellow)]' },
      { color: 'green', active: false, class: 'bg-mark-green/10 shadow-[inset_3px_0_0_var(--mark-green)]' },
      { color: 'blue', active: false, class: 'bg-mark-blue/10 shadow-[inset_3px_0_0_var(--mark-blue)]' },
      { color: 'purple', active: false, class: 'bg-mark-purple/10 shadow-[inset_3px_0_0_var(--mark-purple)]' },
      { color: 'gray', active: false, class: 'bg-mark-gray/10 shadow-[inset_3px_0_0_var(--mark-gray)]' },
    ],
  },
);

const isClose = (target: EventTarget): boolean => target instanceof Element && !!target.closest('[data-close]');

export function TabStrip({ pane, dim }: { pane: Pane; dim: boolean }) {
  const t = useT();
  const lifted = useDrag((s) => (s.lifted?.pane === pane.id ? s.lifted : null));
  const caret = useDrag((s) => (s.caret?.pane === pane.id ? s.caret.x : null));
  const strip = useRef<HTMLDivElement | null>(null);

  // The tab shown stays in sight when there are more tabs than room; only the bar scrolls, never the window.
  useLayoutEffect(() => {
    const bar = strip.current;
    const on = bar?.querySelector<HTMLElement>('[data-active]');
    if (!bar || !on) return;
    if (on.offsetLeft < bar.scrollLeft) bar.scrollLeft = on.offsetLeft;
    else if (on.offsetLeft + on.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = on.offsetLeft + on.offsetWidth - bar.clientWidth;
  });

  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!step || pane.renamingTab != null) return;
    e.preventDefault();
    pane.activate((pane.active + step + pane.tabs.length) % pane.tabs.length);
    requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>('[data-active]')?.focus());
  };

  return (
    <div
      ref={(el) => {
        pane.tabsEl = el;
      }}
      className={cn('relative flex h-[40px] flex-none items-center gap-[4px] px-[6px] pt-[4px] transition-opacity', dim && 'opacity-60')}
      onDoubleClick={(e) => {
        if (e.target instanceof Element && !e.target.closest('[data-tab-index], button')) pane.newTab();
      }}
    >
      <div
        ref={(el) => {
          strip.current = el;
          pane.stripEl = el;
        }}
        role="tablist"
        aria-label={t('paneTabs')}
        className="flex min-w-0 flex-[0_1_auto] items-center gap-[2px] overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
        onKeyDown={keys}
      >
        {pane.tabs.map((tab, i) => (
          <TabItem key={tab.id} pane={pane} tab={tab} i={i} active={i === pane.active} offset={lifted?.index === i ? lifted : null} />
        ))}
      </div>
      <IconButton label={t('newTab')} icon={<PlusIcon weight="bold" />} size="icon-sm" className="size-[28px] text-fg-2" onPress={() => pane.newTab()} />
      {caret != null ? <div className="pointer-events-none absolute top-[10px] bottom-[4px] w-[2px] rounded-full bg-tint" style={{ left: caret }} /> : null}
    </div>
  );
}

function TabItem({ pane, tab, i, active, offset }: { pane: Pane; tab: Tab; i: number; active: boolean; offset: { dx: number; dy: number } | null }) {
  const t = useT();
  const where = tab.uri ? (isLocal(tab.uri) ? pathOf(tab.uri) : registry.places.nameOf(tab.uri)) : '';
  const name = tab.title || (tab.uri ? registry.places.nameOf(tab.uri) : t('newTab'));
  const color: TabColor | 'none' = tab.color ?? 'none';
  const down = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isClose(e.target) || pane.renamingTab === i) return;
    pane.activate(i);
    dragTab(pane, e.nativeEvent, i);
  };
  return (
    <div
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      data-tab-index={i}
      data-active={active || undefined}
      title={tab.title && where ? `${tab.title}\n${where}` : where}
      className={tabStyle({ active, color, lifted: !!offset })}
      style={offset ? { transform: `translate(${offset.dx}px, ${offset.dy}px)` } : undefined}
      onMouseDown={down}
      onMouseUp={(e) => {
        if (e.button === 0 && !isClose(e.target) && pane.renamingTab !== i) pane.focusList();
      }}
      onAuxClick={(e) => {
        if (e.button === 1) pane.closeTab(i);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!isClose(e.target)) pane.renameTab(i);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        void tabMenu(pane, i, e.clientX, e.clientY);
      }}
    >
      <img src={placeIcon(tab.uri, 16)} alt="" draggable={false} className="size-[16px] flex-none" />
      {pane.renamingTab === i ? (
        <TabField pane={pane} value={tab.title || (tab.uri ? registry.places.nameOf(tab.uri) : '')} />
      ) : (
        <span className={cn('min-w-0 flex-1 truncate', tab.title && 'italic')}>{name}</span>
      )}
      <button
        type="button"
        data-close
        aria-label={t('closeTab')}
        title={t('closeTab')}
        tabIndex={-1}
        className="grid size-[20px] flex-none place-items-center rounded-[5px] text-fg-2 opacity-0 transition-opacity group-hover/tab:opacity-100 group-data-[active]/tab:opacity-100 hover:bg-pressed hover:text-fg"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          pane.closeTab(i);
        }}
      >
        <XIcon weight="bold" className="size-[9px]" />
      </button>
    </div>
  );
}

/** The tab's name as a field: Return keeps it, Escape leaves it, an empty one gives the tab its folder's name back. */
function TabField({ pane, value }: { pane: Pane; value: string }) {
  const t = useT();
  return (
    <input
      autoFocus
      defaultValue={value}
      spellCheck={false}
      aria-label={t('renameTab')}
      className="h-[22px] min-w-0 flex-1 rounded-[5px] bg-pane px-[5px] text-fg outline-none ring-1 ring-tint"
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') pane.finishRenameTab(e.currentTarget.value);
        else if (e.key === 'Escape') pane.finishRenameTab(null);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => pane.finishRenameTab(e.currentTarget.value)}
    />
  );
}
