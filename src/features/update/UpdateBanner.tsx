// A new version, its download and the restart it waits for, as a small banner at the foot of the window. While Settings is
// open the banner keeps out of the way, as the same row is in front of the user there.
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { SETTINGS_SHEET } from '@/features/keys';
import { useT } from '@/i18n';
import { useSheets } from '@/lib/registry';
import { cn } from '@/lib/utils';
import { connectUpdate, updateAct, updateBusy, updateLabel, updateSaid, useUpdate } from './store';

export function UpdateBanner() {
  const t = useT();
  const u = useUpdate();
  const settingsOpen = useSheets((s) => s.open?.id === SETTINGS_SHEET);
  useEffect(() => connectUpdate(), []);
  const show = (u.state === 'available' || u.state === 'downloading' || u.state === 'ready') && !u.later && !settingsOpen;
  const next = u.state === 'available' || u.state === 'ready';
  return (
    <div
      role="status"
      data-chrome=""
      inert={!show}
      className={cn(
        'fixed bottom-4 left-1/2 z-60 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2 rounded-full py-2 pr-2 pl-4 text-[13px] glass-pop transition-[translate,opacity] duration-(--motion-slow) ease-spring',
        show ? 'translate-y-0' : 'translate-y-[160%] opacity-0',
      )}
    >
      <span className="mr-1 min-w-0 truncate">{updateSaid(u)}</span>
      <Button className="shrink-0" onPress={() => useUpdate.setState({ later: true })}>
        {t('later')}
      </Button>
      <Button className="shrink-0" variant={next ? 'default' : 'outline'} isDisabled={updateBusy(u)} onPress={updateAct}>
        {t(updateLabel(u))}
      </Button>
    </div>
  );
}
