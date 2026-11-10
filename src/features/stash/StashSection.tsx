import { TrayIcon } from '@phosphor-icons/react';
import { useT } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { panes, usePanesRevision } from '@/lib/panes-api';
import { cn } from '@/lib/utils';
import { STASH, useStash } from './store';

/** The shelf as one more place of the sidebar, right under the favourites: it opens in the focused pane. */
export function StashSection() {
  const t = useT();
  const role = useApp((s) => s.role);
  const count = useStash((s) => s.count);
  usePanesRevision((s) => s.revision);
  if (role !== 'main') return null;
  const here = panes.current()?.uri === STASH;
  return (
    <button
      type="button"
      aria-current={here ? 'page' : undefined}
      onClick={() => panes.open(STASH)}
      className={cn('flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring', here && 'bg-select-dim hover:bg-select-dim')}
    >
      <TrayIcon className="size-4 flex-none text-tint" />
      <span className="min-w-0 flex-1 truncate">{t('stash')}</span>
      {count ? <span className="min-w-4.5 rounded-full bg-field px-1.5 text-center text-[11px] font-semibold text-fg-2">{count}</span> : null}
    </button>
  );
}
