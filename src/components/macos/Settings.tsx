import { createContext, useContext, type ReactNode } from 'react';
import { InfoTip } from './Tip';
import { fold } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The words typed in the search of Settings, folded (`fold`). A row that does not hold them leaves itself out, and a group
 * left without rows hides. Empty everywhere but there.
 */
export const SettingsQuery = createContext('');

/** A titled card of rows, the way Settings and every sheet group their controls. */
export function Group({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  const query = useContext(SettingsQuery);
  return (
    <section className={cn('flex flex-col gap-1.5', query && 'not-has-data-[slot=settings-row]:hidden', className)}>
      {title ? <h3 className="px-1 text-[11px] font-semibold tracking-wide text-fg-2 uppercase">{title}</h3> : null}
      <div className="pane flex flex-col divide-y divide-hair rounded-card">{children}</div>
    </section>
  );
}

/**
 * A row: a name at the left edge, at most one control at the right edge; what it would say in words is behind the "i".
 * `keywords` are words the search finds it by when its label is not plain text.
 */
export function Row({ label, hint, infoLabel, keywords, children, className }: { label: ReactNode; hint?: string; infoLabel?: string; keywords?: string; children?: ReactNode; className?: string }) {
  const query = useContext(SettingsQuery);
  if (query && !fold(`${typeof label === 'string' ? label : ''} ${keywords ?? ''} ${hint ?? ''}`).includes(query)) return null;
  return (
    <div data-slot="settings-row" className={cn('flex min-h-11 items-center gap-3 px-4 py-2', className)}>
      <div className="flex min-w-0 flex-1 items-center gap-1 text-[13px]">
        <span className="truncate">{label}</span>
        {hint ? <InfoTip text={hint} label={infoLabel ?? (typeof label === 'string' ? label : (keywords ?? ''))} /> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
