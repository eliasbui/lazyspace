import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { SheetFrame } from '@/components/macos/SheetFrame';
import { InfoTip } from '@/components/macos/Tip';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useI18n, useT } from '@/i18n';
import { fmtSize } from '@/lib/format';
import type { SheetProps } from '@/lib/registry';
import { cn } from '@/lib/utils';
import type { DiskNode } from '@/services';
import { FILL, INK, KIND_WORD, KINDS, kindOf, shade, type Kind } from './kinds';
import { squarify, type Rect } from './squarify';
import { defaultFolder, drill, measure, reveal, up, useDisk } from './store';

const sized = (node: DiskNode | undefined): DiskNode[] => (node?.children ?? []).filter((c) => c.size > 0);

interface Hover {
  node: DiskNode;
  of: DiskNode;
}

/** The map of what a folder holds: a rectangle per item, as large as its bytes, a folder's own items drawn inside it. */
export function DiskSheet({ close }: SheetProps<undefined>) {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const shown = useDisk((s) => s.shown);
  const busy = useDisk((s) => s.busy);
  const node = shown[shown.length - 1];
  const area = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  // A press that went inside a folder, for the second press of a double click, which shows that folder.
  const pressed = useRef<DiskNode | null>(null);
  const focusFirst = useRef(false);

  // Opened with nothing asked (a sheet opened by its id), it measures the focused pane's folder.
  useEffect(() => {
    const uri = useDisk.getState().asked ? null : defaultFolder();
    if (uri) measure(uri);
  }, []);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const fit = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const children = useMemo(() => sized(node), [node]);
  const rects = useMemo(() => squarify(children.map((c) => c.size), 0, 0, box.w, box.h), [children, box]);
  const present = useMemo(() => {
    const kinds = new Set<Kind>();
    for (const c of children) {
      kinds.add(kindOf(c));
      for (const k of sized(c)) kinds.add(kindOf(k));
    }
    return KINDS.filter((k) => kinds.has(k));
  }, [children]);

  useEffect(() => {
    setHover(null);
    if (!focusFirst.current) return;
    focusFirst.current = false;
    area.current?.querySelector('button')?.focus();
  }, [node]);

  // `clicks` is the click count of the press: 0 from the keyboard, where Enter opens a folder and shows a file.
  const press = useCallback((item: DiskNode, clicks: number) => {
    if (clicks >= 2) return reveal(pressed.current ?? item);
    pressed.current = item;
    if (item.dir) {
      focusFirst.current = clicks === 0;
      drill(item);
    } else if (clicks === 0) reveal(item);
  }, []);
  const hoverIn = useCallback((item: DiskNode, of: DiskNode) => setHover({ node: item, of }), []);

  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Backspace' || (e.metaKey && e.key === 'ArrowUp')) {
      e.preventDefault();
      focusFirst.current = true;
      up();
    }
  };

  const percent = (part: number, whole: number) => new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', { style: 'percent', maximumFractionDigits: 1 }).format(whole ? part / whole : 0);

  return (
    <SheetFrame
      open
      onClose={close}
      size="xl"
      title={
        <span className="flex items-baseline gap-2">
          <span className="truncate">{node ? t('diskTitle', node.name) : t('measuring')}</span>
          {node ? <span className="shrink-0 font-normal text-fg-2 tabular-nums">{fmtSize(node.size)}</span> : null}
          {node && busy > 0 ? <Spinner aria-label={t('measuring')} className="size-3.5 shrink-0 self-center text-fg-3" /> : null}
        </span>
      }
      footer={
        <>
          {shown.length > 1 ? (
            <Button className="mr-auto" onPress={up}>
              <ArrowLeftIcon />
              {t('diskUp')}
            </Button>
          ) : null}
          <Button variant="default" onPress={close}>
            {t('done')}
          </Button>
        </>
      }
    >
      <div
        ref={area}
        role="group"
        aria-label={node ? t('diskTitle', node.name) : t('measuring')}
        onKeyDown={keys}
        onPointerLeave={() => setHover(null)}
        className="relative h-[min(52vh,420px)] min-h-60 overflow-hidden rounded-card bg-field"
      >
        {node ? (
          children.map((c, i) => {
            const r = rects[i];
            return r ? <Cell key={c.path ?? `${c.name}:${i}`} node={c} parent={node} rect={r} index={i} onPress={press} onHover={hoverIn} /> : null;
          })
        ) : busy > 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-fg-2">
            <Spinner aria-label={t('measuring')} className="size-5" />
            <span>{t('measuring')}</span>
          </div>
        ) : null}
      </div>
      <div className="flex min-h-9 items-center gap-4 pt-2 pb-1">
        <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-2">
          {present.map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className={cn('size-2.5 rounded-[3px]', FILL[k])} />
              {t(KIND_WORD[k])}
            </li>
          ))}
        </ul>
        <div className="flex min-w-0 shrink items-center justify-end gap-2 text-[12px]" aria-live="polite">
          {hover ? (
            <>
              <span className={cn('size-2.5 shrink-0 rounded-[3px]', FILL[kindOf(hover.node)])} />
              <span className="truncate font-medium">{hover.node.name}</span>
              <span className="shrink-0 text-fg-2 tabular-nums">{fmtSize(hover.node.size)}</span>
              <span className="shrink-0 text-fg-3 tabular-nums">{t('diskShare', percent(hover.node.size, hover.of.size), hover.of.name)}</span>
            </>
          ) : (
            <InfoTip text={t('diskHint')} label={t('diskHint')} />
          )}
        </div>
      </div>
    </SheetFrame>
  );
}

interface CellProps {
  node: DiskNode;
  /** The folder the map shows. */
  parent: DiskNode;
  rect: Rect;
  index: number;
  onPress: (node: DiskNode, clicks: number) => void;
  onHover: (node: DiskNode, of: DiskNode) => void;
}

const Cell = memo(function Cell({ node, parent, rect, index, onPress, onHover }: CellProps) {
  // A gap of 2 points between neighbours: each cell gives up one on every side.
  const w = rect.w - 2;
  const h = rect.h - 2;
  const kind = kindOf(node);
  const inner = useMemo(() => {
    if (!node.dir || w <= 90 || h <= 54) return [];
    const items = sized(node);
    return squarify(items.map((k) => k.size), 3, 20, w - 6, h - 23).map((r, j) => ({ r, item: items[j] }));
  }, [node, w, h]);
  const label = w > 46 && h > 18;

  return (
    <button
      type="button"
      aria-label={`${node.name}, ${fmtSize(node.size)}`}
      onClick={(e) => onPress(node, e.detail)}
      onKeyDown={(e) => {
        if (e.metaKey && e.key === 'Enter') {
          e.preventDefault();
          onPress(node, 2);
        }
      }}
      onPointerEnter={() => onHover(node, parent)}
      className={cn('absolute overflow-hidden rounded-[6px] text-left transition-[filter] duration-150 hover:brightness-110 focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--fg)', FILL[kind], INK[kind], shade(kind, index))}
      style={{ left: rect.x + 1, top: rect.y + 1, width: Math.max(0, w), height: Math.max(0, h) }}
    >
      {inner.map(({ r, item }, j) =>
        item ? (
          <span
            key={item.path ?? `${item.name}:${j}`}
            onPointerEnter={(e) => {
              e.stopPropagation();
              onHover(item, node);
            }}
            onPointerLeave={() => onHover(node, parent)}
            className={cn('absolute overflow-hidden rounded-[3px]', FILL[kindOf(item)], INK[kindOf(item)], shade(kindOf(item), j))}
            style={{ left: r.x + 0.5, top: r.y + 0.5, width: Math.max(0, r.w - 1), height: Math.max(0, r.h - 1) }}
          >
            {r.w > 64 && r.h > 18 ? (
              <span className="block truncate px-1.5 pt-0.5 text-[10px] leading-4 font-medium">
                {item.name}
                {r.h > 34 ? <span className="block font-normal opacity-80 tabular-nums">{fmtSize(item.size)}</span> : null}
              </span>
            ) : null}
          </span>
        ) : null,
      )}
      {label ? (
        <span className="pointer-events-none absolute inset-x-0 top-0 flex min-w-0 items-baseline gap-1.5 px-1.5 pt-0.5 text-[11px] leading-4">
          <span className="truncate font-semibold">{node.name}</span>
          {inner.length ? <span className="shrink-0 opacity-80 tabular-nums">{fmtSize(node.size)}</span> : null}
        </span>
      ) : null}
      {label && h > 34 && !inner.length ? <span className="pointer-events-none absolute top-4.5 left-1.5 text-[11px] leading-4 opacity-80 tabular-nums">{fmtSize(node.size)}</span> : null}
    </button>
  );
});
