// The body of a pane: the list or the icons of its tab (or the view a feature registered for columns and the gallery),
// the words for an empty, loading or failed folder, and the layers features lay over the rows.
import { useLayoutEffect, useState } from 'react';
import { useT } from '@/i18n';
import { useSettings } from '@/lib/app-state';
import { useRegistry } from '@/lib/registry';
import { cn } from '@/lib/utils';
import { gridOf, metrics, shownColumns } from '../columns';
import { useWindowActive } from '../hooks';
import { manager } from '../manager';
import type { Pane } from '../pane';
import { IconCells } from './IconCells';
import { ListHeader } from './ListHeader';
import { ListRows } from './ListRows';

function useWidth(el: HTMLElement | null): { width: number; gutter: number } {
  const [size, setSize] = useState({ width: 0, gutter: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setSize((s) => (s.width === el.clientWidth && s.gutter === el.offsetWidth - el.clientWidth ? s : { width: el.clientWidth, gutter: el.offsetWidth - el.clientWidth }));
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [el]);
  return size;
}

export function PaneBody({ pane, focused, dim }: { pane: Pane; focused: boolean; dim: boolean }) {
  const t = useT();
  const tab = pane.tab;
  const settings = useSettings();
  const active = useWindowActive();
  const Registered = useRegistry((s) => (tab.mode === 'columns' || tab.mode === 'gallery' ? s.views[tab.mode] : undefined));
  const overlays = useRegistry((s) => s.overlays);
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const { width, gutter } = useWidth(listEl);
  const size = metrics(settings);
  // Columns and the gallery are drawn by their feature; without it the tab is shown as a list.
  const mode = tab.mode === 'icons' ? 'icons' : 'list';
  const columns = shownColumns('list', width, pane.wantedColumns(), pane.cols);
  const template = gridOf(columns, pane.cols);

  // A tab shown again shows where it was scrolled.
  useLayoutEffect(() => {
    if (listEl) listEl.scrollTop = tab.scrollTop;
  }, [listEl, tab, mode]);

  const showMessage = !!tab.error || (!tab.loading && tab.count === 0) || (tab.loading && !tab.generation);
  const message = tab.error ? tab.error.replace(/^LZ-[A-Z]+:/, '') : tab.loading ? t('loading') : tab.filter ? t('noMatch') : t('emptyFolder');
  const strong = focused && active;
  const lead = tab.lead >= 0 && pane.itemEls.has(tab.lead) ? `${tab.id}-${tab.lead}` : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {Registered ? (
        <Registered pane={pane} tab={tab} />
      ) : (
        <>
          {mode === 'list' ? <ListHeader pane={pane} columns={columns} template={template} gutter={gutter} dim={dim} /> : null}
          <div
            ref={(el) => {
              pane.listEl = el;
              setListEl(el);
            }}
            tabIndex={0}
            role="listbox"
            aria-multiselectable
            aria-label={t('paneItems')}
            aria-activedescendant={lead}
            className={cn('relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-[8px] outline-none data-[drop]:rounded-[8px] data-[drop]:shadow-[inset_0_0_0_2px_var(--tint)]', mode === 'icons' && 'pb-[8px]')}
            onScroll={(e) => {
              tab.scrollTop = e.currentTarget.scrollTop;
            }}
            onMouseDown={(e) => pane.pointer(e.nativeEvent)}
            onDoubleClick={(e) => {
              const i = pane.indexAt(e.target);
              if (i == null) return;
              // Command and a double click open a folder in a new tab, as in Finder.
              const into = e.metaKey ? pane.browsable(tab.rowAt(i)) : null;
              if (into) {
                pane.selectOnly(i);
                pane.newTab(into);
              } else manager.action('open', pane);
            }}
            onAuxClick={(e) => {
              // The middle button opens a folder in a tab behind this one, as in File Explorer and a browser.
              const i = e.button === 1 ? pane.indexAt(e.target) : null;
              const into = i == null ? null : pane.browsable(tab.rowAt(i));
              if (into) pane.newTab(into, null, { background: true, at: pane.active + 1 });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              // With the Windows keys, Control and a click turns an item over instead.
              if (e.button === 0 && e.ctrlKey && settings?.keymap === 'windows') return;
              pane.contextMenu(e.clientX, e.clientY, pane.indexAt(e.target));
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget || e.nativeEvent.isComposing) return;
              if (pane.keydown(e.nativeEvent)) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            {mode === 'list' ? (
              <ListRows key={`${tab.id}:${size.rowH}`} pane={pane} tab={tab} columns={columns} template={template} rowH={size.rowH} strong={strong} />
            ) : (
              <IconCells key={`${tab.id}:${size.icon}`} pane={pane} tab={tab} width={width} size={size} strong={strong} />
            )}
          </div>
        </>
      )}
      {showMessage ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[8px] p-[24px] text-center text-[13px] text-fg-2">
          <p className="max-w-[420px] text-pretty">{message}</p>
        </div>
      ) : null}
      {overlays.length ? (
        <div className="pointer-events-none absolute inset-0 *:pointer-events-auto">
          {overlays.map(({ id, Component }) => (
            <Component key={id} pane={pane} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
