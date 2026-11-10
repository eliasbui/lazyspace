import { useT } from '@/i18n';
import { Spinner } from '@/components/ui/spinner';
import { fmtSize } from '@/lib/format';
import type { Pane } from './pane';

/** How many items, how many are selected and what they weigh, and the room left on the disk. */
export function StatusBar({ pane }: { pane: Pane }) {
  const t = useT();
  const tab = pane.tab;
  const n = tab.selCount();
  const parts = [n ? t('selectedOf', n, tab.count) : t('items', tab.count)];
  // What the selected files weigh, as File Explorer says it; a folder counts once its size is worked out. Only the names
  // picked one by one are added up, so drawing never walks a huge folder.
  if (!tab.all && tab.sel.size && tab.sel.size <= 5000) {
    let bytes = 0;
    for (const name of tab.sel) {
      const e = tab.entry(name);
      if (e) bytes += (e.isDir || e.kind === 'app' || e.kind === 'package' ? e.dirSize : e.size) ?? 0;
    }
    if (bytes) parts.push(fmtSize(bytes));
  }
  if (tab.free != null) parts.push(t('available', fmtSize(tab.free)));
  const starting = tab.loading && !tab.generation;
  return (
    <div role="status" className="flex h-[26px] flex-none items-center justify-center gap-[6px] px-[12px] text-[11px] text-fg-2 tabular-nums shadow-[inset_0_1px_0_var(--hair)]">
      {tab.loading ? <Spinner aria-label={t('loading')} className="size-[12px]" /> : null}
      <span className="truncate">{starting ? '' : parts.join(', ')}</span>
    </div>
  );
}
