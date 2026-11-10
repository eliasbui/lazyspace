import { TrayIcon } from '@phosphor-icons/react';
import { SideItem } from '@/components/macos/SideItem';
import { useT } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { STASH, useStash } from './store';

/**
 * The shelf as one more place of the sidebar, right under the favourites: it opens in the focused pane, and files dropped
 * on it go on the shelf (`data-drop-uri`, taken by the drop handler of register.tsx).
 */
export function StashSection() {
  const t = useT();
  const role = useApp((s) => s.role);
  const count = useStash((s) => s.count);
  if (role !== 'main') return null;
  return (
    <SideItem
      uri={STASH}
      label={t('stash')}
      icon={<TrayIcon />}
      ico="tray"
      end={count ? <span className="mr-2 min-w-4.5 rounded-full bg-field px-1.5 text-center text-[11px] font-semibold text-fg-2">{count}</span> : null}
    />
  );
}
