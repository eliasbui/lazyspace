// A crumb for each folder from the top, each followed by the button of its menu of folders; the crumbs that do not fit
// give way from the top to a button that lists them.
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { CaretDoubleLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { iconUrl, pixelRatio } from '@/services';
import { aboveMenu, foldersMenu } from '../menu/menus';
import type { Pane } from '../pane';
import { crumbsOf } from '../places';

const sep = 'grid h-[24px] flex-none place-items-center rounded-[6px] text-fg-3 transition-colors hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg';

export function Crumbs({ pane, tinted }: { pane: Pane; tinted: boolean }) {
  const t = useT();
  const items = crumbsOf(pane.tab.uri || 'file:///');
  const shape = items.map(([uri, name]) => `${uri} ${name}`).join('|');
  const box = useRef<HTMLElement | null>(null);
  const gone = useRef(0);
  const [open, setOpen] = useState<number | null>(null);

  // Hides crumbs from the top, never the last, until the rest fit.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const kids = [...el.children].filter((k): k is HTMLElement => k instanceof HTMLElement);
      const more = kids.find((k) => k.hasAttribute('data-more'));
      for (const k of kids) k.hidden = k === more;
      const crumbs = kids.filter((k) => k.hasAttribute('data-crumb'));
      let n = 0;
      while (el.scrollWidth > el.clientWidth + 1 && n < crumbs.length - 1) {
        const crumb = crumbs[n];
        if (crumb) crumb.hidden = true;
        if (crumb?.nextElementSibling instanceof HTMLElement) crumb.nextElementSibling.hidden = true;
        if (more) more.hidden = false;
        n++;
      }
      gone.current = n;
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [shape, tinted]);

  return (
    <nav
      ref={(el) => {
        box.current = el;
      }}
      aria-label={t('pathBar')}
      className="flex h-full min-w-0 flex-1 items-center overflow-hidden"
    >
      <button
        type="button"
        data-more
        aria-label={t('hiddenCrumbs')}
        title={t('hiddenCrumbs')}
        className={cn(sep, 'w-[22px]')}
        onClick={(e) => void aboveMenu(pane, items.slice(0, gone.current), e.currentTarget)}
      >
        <CaretDoubleLeftIcon weight="bold" className="size-[11px]" />
      </button>
      {items.map(([uri, name, iconKey], i) => {
        const here = i === items.length - 1;
        return (
          <Fragment key={`${i}:${uri}`}>
            <button
              type="button"
              data-crumb
              aria-current={here ? 'location' : undefined}
              className={cn(
                'flex h-[24px] max-w-[240px] flex-none items-center gap-[6px] rounded-[6px] px-[6px] text-[12px] whitespace-nowrap transition-colors hover:bg-hover hover:text-fg',
                here ? cn('font-medium', tinted ? 'text-tint' : 'text-fg') : 'text-fg-2',
              )}
              onClick={() => {
                pane.navigate(uri, { select: pane.childOf(uri) });
                pane.focusList();
              }}
              onAuxClick={(e) => {
                if (e.button === 1) pane.newTab(uri, null, { background: true, at: pane.active + 1 });
              }}
            >
              {iconKey ? <img src={iconUrl(iconKey, 16 * pixelRatio())} alt="" draggable={false} className="size-[16px] flex-none" /> : null}
              <span className="truncate">{name}</span>
            </button>
            <button
              type="button"
              aria-label={t('foldersIn', name)}
              aria-haspopup="menu"
              aria-expanded={open === i}
              className={cn(sep, 'w-[18px]')}
              onClick={(e) => {
                setOpen(i);
                void foldersMenu(pane, items, i, e.currentTarget).finally(() => setOpen(null));
              }}
            >
              <CaretRightIcon weight="bold" className="size-[9px]" />
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}
