import { useT } from '@/i18n';
import { useSettings } from '@/lib/app-state';
import { cn } from '@/lib/utils';
import { useDrag, type ZoneSide } from './dnd/state';
import { usePane } from './hooks';
import { manager } from './manager';
import type { Pane } from './pane';
import { PathBar } from './pathbar/PathBar';
import { StatusBar } from './StatusBar';
import { TabStrip } from './tabs/TabStrip';
import { PaneBody } from './views/PaneBody';

/** One pane: its tabs, its path bar, its rows and its status. With more than one pane, the focused one has a ring. */
export function PaneView({ pane, flex, className }: { pane: Pane; flex: string; className?: string }) {
  usePane(pane);
  const t = useT();
  const settings = useSettings();
  const zone = useDrag((s) => (s.zone?.pane === pane.id ? s.zone.side : null));
  const multi = manager.all().length > 1;
  const focused = manager.focused() === pane;
  if (!pane.tab) return null;
  const showTabs = pane.tabs.length > 1 || settings?.always_tabs !== false;
  return (
    <section
      ref={(el) => {
        pane.el = el;
      }}
      data-pane-id={pane.id}
      aria-label={t('paneN', pane.index + 1)}
      className={cn('pane relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card', multi && focused && 'outline-2 -outline-offset-2 outline-tint/45', className)}
      style={{ flex }}
      onMouseDownCapture={() => manager.focus(pane)}
    >
      {showTabs ? <TabStrip pane={pane} dim={multi && !focused} /> : null}
      <PathBar pane={pane} multi={multi} focused={focused} />
      <PaneBody pane={pane} focused={focused} dim={multi && !focused} />
      <StatusBar pane={pane} />
      {zone ? <SplitZone side={zone} /> : null}
    </section>
  );
}

const ZONES: Record<ZoneSide, string> = {
  left: 'inset-y-0 left-0 right-1/2',
  right: 'inset-y-0 right-0 left-1/2',
  top: 'inset-x-0 top-0 bottom-1/2',
  bottom: 'inset-x-0 bottom-0 top-1/2',
  center: 'inset-0',
};

/** Where a dragged tab would go when let go: the half that becomes a new pane, or the whole pane that takes it. */
function SplitZone({ side }: { side: ZoneSide }) {
  return <div className={cn('pointer-events-none absolute z-20 m-[6px] rounded-[10px] bg-tint/15 ring-2 ring-tint ring-inset transition-all duration-150', ZONES[side])} />;
}
