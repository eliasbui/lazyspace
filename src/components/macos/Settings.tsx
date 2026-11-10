import type { ReactNode } from 'react';
import { InfoTip } from './Tip';
import { cn } from '@/lib/utils';

/** A titled card of rows, the way Settings and every sheet group their controls. */
export function Group({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-1.5', className)}>
      {title ? <h3 className="px-1 text-[11px] font-semibold tracking-wide text-fg-2 uppercase">{title}</h3> : null}
      <div className="pane flex flex-col divide-y divide-hair rounded-card">{children}</div>
    </section>
  );
}

/** A row: a name at the left edge, at most one control at the right edge; what it would say in words is behind the "i". */
export function Row({ label, hint, infoLabel, children, className }: { label: ReactNode; hint?: string; infoLabel?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-11 items-center gap-3 px-4 py-2', className)}>
      <div className="flex min-w-0 flex-1 items-center gap-1 text-[13px]">
        <span className="truncate">{label}</span>
        {hint ? <InfoTip text={hint} label={infoLabel ?? ''} /> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
