import { useState } from 'react';
import { fmtDate, fmtSize } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Row } from '@/services';
import { iconOf, thumbOf } from './places';

/** What an item is, how big, when it changed: the facts under a preview. */
export const factsOf = (row: Row): string[] => [row.type, row.isDir ? null : fmtSize(row.size), fmtDate(row.mtime)].filter((f): f is string => !!f);

/** The picture of an item: its Quick Look thumbnail, or its icon when there is none or it cannot be made. */
export function Picture({ row, points, iconPoints, className, iconClassName }: { row: Row; points: number; iconPoints: number; className?: string; iconClassName?: string }) {
  const thumb = thumbOf(row, points);
  const [failed, setFailed] = useState<string | null>(null);
  if (thumb && failed !== thumb) return <img src={thumb} alt="" draggable={false} onError={() => setFailed(thumb)} className={className} />;
  return <img src={iconOf(row, iconPoints)} alt="" draggable={false} className={cn('object-contain', iconClassName)} />;
}
