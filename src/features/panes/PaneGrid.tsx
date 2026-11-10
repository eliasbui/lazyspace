import { Fragment, useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { bumpPanes, panes, usePanesRevision } from '@/lib/panes-api';
import { cn } from '@/lib/utils';
import { api } from '@/services';
import { useDrag } from './dnd/state';
import { isLeaf, type Node, type Split } from './layout';
import { manager } from './manager';
import type { Pane } from './pane';
import { PaneView } from './PaneView';

/** The panes of the window, laid out as a tree of splits; the line between two of them is dragged to share the room. */
export function PaneGrid() {
  usePanesRevision((s) => s.revision);
  useStart();
  const tree = manager.tree;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {tree ? <LayoutNode node={tree} flex="1 1 0px" /> : null}
      <DragGhost />
    </div>
  );
}

/** The window starts once the app has said hello: the panes come back as they were (layout.json) or open at home. */
function useStart(): void {
  const hello = useApp((s) => s.hello);
  useEffect(() => {
    if (!hello || manager.all().length) return;
    panes.start(hello.layout, hello.uri);
    // The window, made hidden, shows now that the panes are in. Not from a frame: a hidden window may draw none.
    setTimeout(() => void api.app.drawn().catch(() => undefined), 0);
  }, [hello]);
}

function LayoutNode({ node, flex, className }: { node: Node<Pane>; flex: string; className?: string }) {
  if (isLeaf(node)) return <PaneView pane={node.pane} flex={flex} className={className} />;
  const row = node.dir === 'row';
  return (
    <div className={cn('flex min-h-0 min-w-0', row ? 'flex-row' : 'flex-col', className)} style={{ flex }}>
      {node.kids.map((kid, i) => (
        <Fragment key={isLeaf(kid) ? kid.pane.id : `s${kid.id}`}>
          {i > 0 ? <Splitter node={node} i={i} /> : null}
          <LayoutNode node={kid} flex={`${node.sizes[i] ?? 0} 1 0px`} className={row ? 'min-w-[160px]' : 'min-h-[120px]'} />
        </Fragment>
      ))}
    </div>
  );
}

/**
 * The gap before child `i` of a split: dragged, the two children beside it share their room as the pointer says, each
 * kept as wide (or tall) as a pane can be used; double-clicked, the split shares its room evenly. The arrows move it too.
 */
function Splitter({ node, i }: { node: Split<Pane>; i: number }) {
  const t = useT();
  const row = node.dir === 'row';
  const [active, setActive] = useState(false);
  const share = () => (node.sizes[i - 1] ?? 0) + (node.sizes[i] ?? 0);
  const down = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const kids = [...(e.currentTarget.parentElement?.children ?? [])].filter((c) => !c.hasAttribute('data-splitter'));
    const [a, b] = [kids[i - 1], kids[i]];
    if (!a || !b) return;
    const size = (k: Element) => (row ? k.getBoundingClientRect().width : k.getBoundingClientRect().height);
    const [startA, startB] = [size(a), size(b)];
    const both = share();
    const least = row ? 160 : 120;
    const from = row ? e.clientX : e.clientY;
    setActive(true);
    const move = (m: globalThis.MouseEvent) => {
      const total = startA + startB;
      const sizeA = Math.min(Math.max(least, startA + (row ? m.clientX : m.clientY) - from), Math.max(least, total - least));
      node.sizes[i - 1] = (both * sizeA) / total;
      node.sizes[i] = both - (node.sizes[i - 1] ?? 0);
      bumpPanes();
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      setActive(false);
      manager.resized(true);
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  };
  const even = () => {
    node.sizes = node.kids.map(() => 1 / node.kids.length);
    manager.resized(false);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const both = share();
    const a = Math.min(both * 0.9, Math.max(both * 0.1, (node.sizes[i - 1] ?? 0) + step * 0.02));
    node.sizes[i - 1] = a;
    node.sizes[i] = both - a;
    manager.resized(true);
  };
  return (
    <div
      data-splitter
      role="separator"
      tabIndex={0}
      aria-orientation={row ? 'vertical' : 'horizontal'}
      aria-label={t('resizePanes')}
      className={cn('group relative flex-none outline-none', row ? 'w-[8px] cursor-col-resize' : 'h-[8px] cursor-row-resize')}
      onMouseDown={down}
      onDoubleClick={even}
      onKeyDown={key}
    >
      <div
        className={cn(
          'absolute rounded-full bg-tint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
          row ? 'inset-y-[12px] left-[3px] w-[2px]' : 'inset-x-[12px] top-[3px] h-[2px]',
          active && 'opacity-100',
        )}
      />
      {active ? <div className={cn('fixed inset-0 z-50', row ? 'cursor-col-resize' : 'cursor-row-resize')} /> : null}
    </div>
  );
}

/** The name of what is dragged within the window, by the pointer. */
function DragGhost() {
  const ghost = useDrag((s) => s.ghost);
  if (!ghost) return null;
  return createPortal(
    <div
      className="pointer-events-none fixed z-50 max-w-[240px] animate-pop-in truncate rounded-[6px] bg-tint px-[8px] py-[3px] text-[12px] whitespace-nowrap text-primary-foreground opacity-90 shadow-md"
      style={{ left: ghost.x, top: ghost.y }}
    >
      {ghost.text}
    </div>,
    document.body,
  );
}
