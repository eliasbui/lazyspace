import type { ComponentType } from 'react';
import { CameraIcon, DeviceMobileIcon, DeviceMobileSpeakerIcon, DeviceTabletIcon, type IconProps } from '@phosphor-icons/react';
import { SideHead, SideItem } from '@/components/macos/SideItem';
import { useT } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { cn } from '@/lib/utils';
import type { Phone } from '@/services';
import { status, usePhones } from './store';

const symbolOf = (p: Phone): [ComponentType<IconProps>, string] =>
  p.kind === 'apple' ? (/^ipad/i.test(p.name) ? [DeviceTabletIcon, 'ipad'] : [DeviceMobileIcon, 'iphone']) : p.kind === 'camera' ? [CameraIcon, 'camera'] : [DeviceMobileSpeakerIcon, 'phone.other'];

/** The Devices of the sidebar, under the disks, where Finder lists the devices it sees: one row a device while it is plugged in. */
export function PhonesSection() {
  const t = useT();
  const role = useApp((s) => s.role);
  const list = usePhones((s) => s.list);
  if (role !== 'main' || !list.length) return null;
  return (
    <>
      <SideHead title={t('ph.devices')} />
      {list.map((p) => {
        const [Glyph, ico] = symbolOf(p);
        return (
          <SideItem
            key={p.key}
            uri={p.uri}
            icon={<Glyph />}
            ico={ico}
            label={p.name}
            title={`${p.name}: ${status(p)}`}
            end={p.state === 'reading' ? <span className="mr-2 text-[11px] text-fg-3 tabular-nums">{p.percent}%</span> : null}
            // A device that cannot be read yet (MTP, or not recognised) is fainter; a click still opens it, to say why.
            className={cn(!p.readable && '[&_button]:opacity-55')}
          />
        );
      })}
    </>
  );
}
