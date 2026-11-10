import { useState } from 'react';
import { fmtDate, fmtSize } from '@/lib/format';
import { TAG_DOT } from '@/lib/tags';
import { cn } from '@/lib/utils';
import type { Row } from '@/services';
import { iconOf, thumbOf } from './places';

/** What an item is, how big, when it changed: the facts under a preview. */
export const factsOf = (row: Row): string[] => [row.type, row.isDir ? null : fmtSize(row.size), fmtDate(row.mtime)].filter((f): f is string => !!f);

/** Finder's tags of an item as dots of their colours, after its name, three at most. */
export function TagDots({ row }: { row: Row }) {
  if (!row.tags?.length) return null;
  return (
    <span className="inline-flex shrink-0 items-center">
      {row.tags.slice(0, 3).map(([name, colour], i) => (
        <span key={name} title={name} className={cn('size-[9px] rounded-full ring-1 ring-pane', TAG_DOT[Number(colour)] ?? TAG_DOT[0], i > 0 && '-ml-[3px]')} />
      ))}
    </span>
  );
}

const MARK: Record<string, string> = {
  M: 'bg-warn/15 text-warn',
  A: 'bg-good/15 text-good',
  '?': 'bg-good/15 text-good',
  D: 'bg-bad/15 text-bad',
  R: 'bg-tint-soft text-tint',
  U: 'bg-bad text-primary-foreground',
};

/** The letter git gives an item, as the editors write it: a new file U, a conflict C. */
export function GitMark({ mark, lit }: { mark: string | undefined; lit: boolean }) {
  if (!mark) return null;
  const letter = mark === '?' ? 'U' : mark === 'U' ? 'C' : mark;
  return <em className={cn('shrink-0 rounded-sm px-1 font-mono text-[10px] leading-4 font-semibold not-italic', lit ? 'bg-primary-foreground/20 text-primary-foreground' : (MARK[mark] ?? 'text-fg-2'))}>{letter}</em>;
}

/** The picture of an item: its Quick Look thumbnail, or its icon when there is none or it cannot be made. */
export function Picture({ row, points, iconPoints, className, iconClassName }: { row: Row; points: number; iconPoints: number; className?: string; iconClassName?: string }) {
  const thumb = thumbOf(row, points);
  const [failed, setFailed] = useState<string | null>(null);
  if (thumb && failed !== thumb) return <img src={thumb} alt="" draggable={false} onError={() => setFailed(thumb)} className={className} />;
  return <img src={iconOf(row, iconPoints)} alt="" draggable={false} className={cn('object-contain', iconClassName)} />;
}
