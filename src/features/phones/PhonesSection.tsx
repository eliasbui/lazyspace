import type { ComponentType } from 'react';
import { CameraIcon, DeviceMobileIcon, DeviceMobileSpeakerIcon, DeviceTabletIcon, type IconProps } from '@phosphor-icons/react';
import { Tip } from '@/components/macos/Tip';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { panes, usePanesRevision } from '@/lib/panes-api';
import { samePlace } from '@/lib/uri';
import { cn } from '@/lib/utils';
import type { Phone } from '@/services';
import { status, usePhones } from './store';

const symbolOf = (p: Phone): ComponentType<IconProps> => (p.kind === 'apple' ? (/^ipad/i.test(p.name) ? DeviceTabletIcon : DeviceMobileIcon) : p.kind === 'camera' ? CameraIcon : DeviceMobileSpeakerIcon);

/** The Devices of the sidebar, under the disks, where Finder lists the devices it sees: one row a device while it is plugged in. */
export function PhonesSection() {
  const t = useT();
  const role = useApp((s) => s.role);
  const list = usePhones((s) => s.list);
  usePanesRevision((s) => s.revision);
  if (role !== 'main' || !list.length) return null;
  const here = panes.current()?.uri;
  return (
    <section className="flex flex-col gap-px" aria-label={t('ph.devices')}>
      <h3 className="px-2 pt-2 pb-1 text-[11px] font-semibold text-fg-3">{t('ph.devices')}</h3>
      {list.map((p) => {
        const Glyph = symbolOf(p);
        const on = samePlace(p.uri, here);
        return (
          <Tip key={p.key} text={`${p.name}: ${status(p)}`}>
            <Button variant="ghost" aria-current={on ? 'page' : undefined} onPress={() => panes.open(p.uri)} className={cn('h-7 w-full justify-start gap-2 rounded-field px-2 font-normal', on && 'bg-select-dim')}>
              <Glyph className={cn('size-4 text-tint', !p.readable && 'opacity-55')} />
              <span className={cn('min-w-0 flex-1 truncate text-left', !p.readable && 'opacity-55')}>{p.name}</span>
              {p.state === 'reading' ? <span className="text-[11px] text-fg-3 tabular-nums">{p.percent}%</span> : null}
            </Button>
          </Tip>
        );
      })}
    </section>
  );
}
