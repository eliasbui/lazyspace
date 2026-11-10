// The toolbar: back and forward with the folder's name, the view, new folder and Trash, the buttons of features, and the
// filter of the focused pane. It follows the focused pane, and the window's title is the names of the panes' folders.
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import {
  CaretDoubleRightIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ColumnsIcon,
  FolderPlusIcon,
  GridFourIcon,
  ImagesSquareIcon,
  ListIcon,
  MagnifyingGlassIcon,
  SquareIcon,
  SquareSplitHorizontalIcon,
  SquareSplitVerticalIcon,
  SquaresFourIcon,
  TrashIcon,
  type Icon,
} from '@phosphor-icons/react';
import { Capsule } from '@/components/macos/Glass';
import { IconButton } from '@/components/macos/Tip';
import { useSidebar } from '@/features/sidebar';
import { useI18n, useT, type WordKey } from '@/i18n';
import { choose, separator } from '@/lib/native-menu';
import { panes, usePanesRevision } from '@/lib/panes-api';
import { registry, useRegistry, type ToolbarItemDef } from '@/lib/registry';
import { say } from '@/lib/ui';
import { authorityOf, schemeOf } from '@/lib/uri';
import { cn } from '@/lib/utils';
import { api, type MenuNode, type Uri, type ViewMode } from '@/services';

interface Tool {
  id: string;
  label: string;
  icon: ReactNode;
  /** The SF Symbol the overflow menu shows beside it. */
  symbol?: string;
  disabled?: boolean;
  pressed?: boolean;
  /** Receives the rectangle of its button, or of the overflow button when it runs from there. */
  run: (rect: DOMRect) => void;
}

// The four views of Finder, in Finder's order; columns and gallery only once a feature draws them.
const VIEWS: Array<[mode: ViewMode, icon: Icon, label: WordKey, action: string, symbol: string]> = [
  ['icons', SquaresFourIcon, 'asIcons', 'viewIcons', 'square.grid.2x2'],
  ['list', ListIcon, 'asList', 'viewList', 'list.bullet'],
  ['columns', ColumnsIcon, 'asColumns', 'viewColumns', 'rectangle.split.3x1'],
  ['gallery', ImagesSquareIcon, 'asGallery', 'viewGallery', 'photo.on.rectangle'],
];

const LAYOUTS: Array<[layout: string, label: WordKey, symbol: string]> = [
  ['single', 'layout.single', 'rectangle'],
  ['h2', 'layout.h2', 'rectangle.split.2x1'],
  ['v2', 'layout.v2', 'rectangle.split.1x2'],
  ['h3', 'layout.h3', 'rectangle.split.3x1'],
  ['l1r2', 'layout.l1r2', 'rectangle.righthalf.inset.filled'],
  ['grid', 'layout.grid', 'rectangle.split.2x2'],
  ['h4', 'layout.h4', 'rectangle.split.3x1'],
  ['g6', 'layout.g6', 'square.grid.3x2'],
];

const layoutIcon = (layout: string): Icon =>
  layout === 'single' ? SquareIcon : layout === 'v2' ? SquareSplitVerticalIcon : layout === 'h2' || layout === 'h3' || layout === 'h4' ? SquareSplitHorizontalIcon : GridFourIcon;

// Too narrow a toolbar folds as NSToolbar does: the title goes first, then the search becomes a button, then the groups of
// buttons go into the overflow menu one by one, the actions before the view. Each width is worked out from nothing, so the
// toolbar unfolds as it widens.
const FOLDS = ['title', 'search', 'actions', 'view', 'right'] as const;
type Fold = (typeof FOLDS)[number];

function fit(bar: HTMLElement): Fold[] {
  for (const fold of FOLDS) bar.removeAttribute(`data-fold-${fold}`);
  const folded: Fold[] = [];
  for (const fold of FOLDS) {
    if (bar.scrollWidth <= bar.clientWidth) break;
    bar.setAttribute(`data-fold-${fold}`, '');
    folded.push(fold);
  }
  return folded;
}

// Search results show their words in the field.
const searchWords = (uri: Uri): string => (schemeOf(uri) === 'search' ? (new URLSearchParams(authorityOf(uri)).get('q') ?? '') : '');

let openSearchNow: (() => void) | null = null;
/** Puts the keyboard in the filter field, opening it over the end of a folded toolbar. */
export function openSearch(): void {
  openSearchNow?.();
}

let searchKeys: ((e: KeyboardEvent) => boolean) | null = null;
/** The search feature takes the keys of the field first while it offers places under it; true when it took the key. */
export function setSearchKeys(keys: ((e: KeyboardEvent) => boolean) | null): void {
  searchKeys = keys;
}

registry.actions.set('find', openSearch);

function ToolButton({ tool }: { tool: Tool }) {
  return (
    <IconButton
      label={tool.label}
      icon={tool.icon}
      isDisabled={tool.disabled}
      aria-pressed={tool.pressed}
      data-tool={tool.id}
      onPress={(e) => tool.run(e.target.getBoundingClientRect())}
      className="h-7 w-8 rounded-full aria-pressed:bg-pressed disabled:opacity-30 [&_svg:not([class*='size-'])]:size-4.5"
    />
  );
}

/** A capsule of buttons; a feature's buttons come after the group's own, a hairline between. */
function ToolGroup({ tools, extra = [], className, onContextMenu }: { tools: Tool[]; extra?: Tool[]; className?: string; onContextMenu?: (e: MouseEvent<HTMLDivElement>) => void }) {
  if (!tools.length && !extra.length) return null;
  return (
    <Capsule data-nodrag="" onContextMenu={onContextMenu} className={cn('shrink-0', className)}>
      {tools.map((tool) => (
        <ToolButton key={tool.id} tool={tool} />
      ))}
      {tools.length && extra.length ? <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-hair-2" /> : null}
      {extra.map((tool) => (
        <ToolButton key={tool.id} tool={tool} />
      ))}
    </Capsule>
  );
}

export function Toolbar() {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  usePanesRevision((s) => s.revision);
  const items = useRegistry((s) => s.toolbar);
  const views = useRegistry((s) => s.views);
  const collapsed = useSidebar((s) => s.collapsed);
  const bar = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef(0);
  const [folds, setFolds] = useState<Fold[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  const pane = panes.focused();
  const tab = pane?.tab ?? null;
  const title = tab?.uri ? registry.places.nameOf(tab.uri) : t('appName');
  const layout = pane ? panes.state().layout : 'single';
  const shown = tab ? tab.filter || searchWords(tab.uri) : '';
  const [text, setText] = useState(shown);

  const featureTools = (side: ToolbarItemDef['side']): Tool[] =>
    items
      .filter((item) => item.side === side && (!item.when || item.when()))
      .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
      .map((item) => ({ id: item.id, label: t(item.label), icon: item.icon, run: item.run }));

  const layoutMenu = async (rect: DOMRect) => {
    const id = await choose(
      LAYOUTS.map(([l, label, symbol]) => ({ id: l, label: t(label), icon: symbol, checked: l === layout })),
      rect.left,
      rect.bottom + 6,
    );
    if (id) panes.setLayout(id);
  };

  const nav: Tool[] = [
    { id: 'back', label: t('back'), icon: <CaretLeftIcon />, symbol: 'chevron.left', disabled: !tab || tab.back?.length === 0, run: () => panes.action('back') },
    { id: 'forward', label: t('forward'), icon: <CaretRightIcon />, symbol: 'chevron.right', disabled: !tab || tab.forward?.length === 0, run: () => panes.action('forward') },
  ];
  const LayoutIcon = layoutIcon(layout);
  const viewTools: Tool[] = VIEWS.filter(([mode]) => mode === 'icons' || mode === 'list' || !!views[mode]).map(([mode, ModeIcon, label, action, symbol]) => ({
    id: mode,
    label: t(label),
    icon: <ModeIcon />,
    symbol,
    disabled: !tab,
    pressed: tab?.mode === mode,
    run: () => panes.action(action),
  }));
  const layoutTools: Tool[] = [
    { id: 'layout', label: t('layout'), icon: <LayoutIcon />, symbol: LAYOUTS.find(([l]) => l === layout)?.[2] ?? 'rectangle.split.2x2', disabled: !pane, run: (rect) => void layoutMenu(rect) },
    ...featureTools('layout'),
  ];
  const actionTools: Tool[] = [
    { id: 'newFolder', label: t('newFolder'), icon: <FolderPlusIcon />, symbol: 'folder.badge.plus', disabled: !tab?.capabilities.write, run: () => panes.action('newFolder') },
    { id: 'trash', label: t('moveToTrash'), icon: <TrashIcon />, symbol: 'trash', disabled: !tab?.selCount(), run: () => panes.action('trash') },
  ];
  const leftTools = featureTools('left');
  const rightTools = featureTools('right');
  const groups: Record<'actions' | 'view' | 'right', Tool[]> = { actions: [...actionTools, ...leftTools], view: [...viewTools, ...layoutTools], right: rightTools };

  // The folded buttons as a native menu, a line between groups; the one chosen runs as if pressed, its own menu (if it has
  // one) opening under the overflow button.
  const more = async (rect: DOMRect) => {
    const tools: Tool[] = [];
    const nodes: MenuNode[] = [];
    for (const fold of ['actions', 'view', 'right'] as const) {
      if (!folds.includes(fold) || !groups[fold].length) continue;
      if (nodes.length) nodes.push(separator);
      for (const tool of groups[fold]) {
        nodes.push({ id: String(tools.length), label: tool.label, icon: tool.symbol, enabled: !tool.disabled, checked: !!tool.pressed });
        tools.push(tool);
      }
    }
    const id = await choose(nodes, rect.left, rect.bottom + 6);
    if (id != null) tools[Number(id)]?.run(rect);
  };

  // Right-clicked, Back and Forward list where they go, as Finder's do.
  const history = (e: MouseEvent<HTMLDivElement>) => {
    const button = e.target instanceof Element ? e.target.closest('[data-tool]') : null;
    const way = button?.getAttribute('data-tool');
    if (!button || !pane || (way !== 'back' && way !== 'forward')) return;
    e.preventDefault();
    const r = button.getBoundingClientRect();
    panes.stackMenu?.(pane, way, r.left, r.bottom + 6);
  };

  const toolKey = [title, lang, ...Object.values(groups).flatMap((g) => g.map((tool) => tool.id))].join('|');
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const run = () => {
      const next = fit(el);
      setFolds((prev) => (prev.join() === next.join() ? prev : next));
    };
    run();
    const observer = new ResizeObserver(run);
    observer.observe(el);
    return () => observer.disconnect();
  }, [toolKey]);

  const folded = folds.includes('search');
  useEffect(() => {
    if (!folded) setSearchOpen(false);
  }, [folded]);

  // The field shows the filter of the focused pane, unless it is being typed in.
  useEffect(() => {
    if (document.activeElement !== input.current) setText(shown);
  }, [shown, tab?.id]);

  useEffect(() => {
    document.title = panes.all().map((p) => (p.tab.uri ? registry.places.nameOf(p.tab.uri) : '')).filter(Boolean).join(' | ') || t('appName');
  });

  useEffect(() => {
    openSearchNow = () => {
      if (bar.current?.hasAttribute('data-fold-search')) flushSync(() => setSearchOpen(true));
      input.current?.focus();
      input.current?.select();
    };
    return () => {
      openSearchNow = null;
    };
  }, []);

  // The filter narrows the focused pane to the items whose name holds what is typed.
  const filter = (value: string) => {
    setText(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const target = panes.focused();
      const view = target?.tab;
      // Search results are searched again with Enter (the search feature): filtered as typed, they would lose the matches
      // found without their accents.
      if (!target || !view?.generation || schemeOf(view.uri) === 'search') return;
      if (target.setFilter) target.setFilter(value);
      else api.view.filter({ view: view.id, text: value }).then(() => target.refresh(), say);
    }, 120);
  };

  return (
    <header
      ref={bar}
      data-drag=""
      data-chrome=""
      aria-label={t('toolbarLabel')}
      data-fold-title={folds.includes('title') ? '' : undefined}
      data-fold-search={folded ? '' : undefined}
      data-fold-actions={folds.includes('actions') ? '' : undefined}
      data-fold-view={folds.includes('view') ? '' : undefined}
      data-fold-right={folds.includes('right') ? '' : undefined}
      className={cn('group/bar relative flex h-13 shrink-0 items-center gap-2 pr-0.5 transition-[padding] duration-(--motion-slow) ease-spring', collapsed ? 'pl-19' : 'pl-1')}
    >
      <ToolGroup tools={nav} onContextMenu={history} />
      <div className="max-w-70 min-w-15 truncate px-0.5 text-[15px] font-bold tracking-[-0.2px] group-data-fold-title/bar:hidden">{title}</div>
      <ToolGroup tools={viewTools} extra={layoutTools} className="group-data-fold-view/bar:hidden" />
      <ToolGroup tools={actionTools} extra={leftTools} className="group-data-fold-actions/bar:hidden" />
      <Capsule data-nodrag="" className="hidden shrink-0 group-data-fold-actions/bar:flex">
        <ToolButton tool={{ id: 'more', label: t('moreTools'), icon: <CaretDoubleRightIcon />, run: (rect) => void more(rect) }} />
      </Capsule>
      <div className="h-full min-w-2 flex-1" />
      <ToolGroup tools={rightTools} className="group-data-fold-right/bar:hidden" />
      <Capsule
        data-nodrag=""
        onMouseDown={(e) => {
          if (!folded || searchOpen) return;
          e.preventDefault();
          openSearch();
        }}
        className={cn(
          'w-50 shrink-0 gap-1.5 overflow-hidden px-2.75 focus-within:ring-2 focus-within:ring-ring',
          searchOpen ? 'absolute! right-0.5 z-10 w-[min(240px,calc(100%-24px))]' : 'group-data-fold-search/bar:w-9 group-data-fold-search/bar:justify-center group-data-fold-search/bar:px-0',
        )}
      >
        {folded && !searchOpen ? (
          <button type="button" aria-label={t('searchHere')} title={t('searchHere')} onClick={openSearch} className="grid size-9 place-items-center rounded-full text-fg-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <MagnifyingGlassIcon className="size-3.5" />
          </button>
        ) : (
          <MagnifyingGlassIcon aria-hidden className="size-3.5 shrink-0 text-fg-2" />
        )}
        <input
          ref={input}
          type="search"
          value={text}
          placeholder={t('searchHere')}
          aria-label={t('searchHere')}
          spellCheck={false}
          onChange={(e) => filter(e.target.value)}
          onBlur={() => {
            if (!input.current?.value) setSearchOpen(false);
          }}
          onKeyDown={(e) => {
            if (searchKeys?.(e.nativeEvent)) return;
            if (e.key === 'Escape') {
              filter('');
              setSearchOpen(false);
              panes.focused()?.focusList();
            } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
              e.preventDefault();
              panes.focused()?.focusList();
            }
          }}
          className={cn('h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-2', folded && !searchOpen && 'hidden')}
        />
      </Capsule>
    </header>
  );
}
