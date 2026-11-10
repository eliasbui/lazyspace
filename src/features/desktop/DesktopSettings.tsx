// Settings > Desktop: the switch that turns the LazySpace desktop on, and the one that hides Finder's own icons.
import { Group, Row } from '@/components/macos/Settings';
import { Switch } from '@/components/ui/switch';
import { t, useT } from '@/i18n';
import { useApp, useSettings } from '@/lib/app-state';
import { confirm, say } from '@/lib/ui';
import { api } from '@/services';

async function change(kind: 'on' | 'hide', value: boolean): Promise<void> {
  const desk = useApp.getState().settings?.desktop ?? { on: false, hide_finder_icons: false };
  const on = kind === 'on' ? value : desk.on;
  const hide = kind === 'hide' ? value : desk.hide_finder_icons;
  // Finder restarts when its icons go or come back, which is asked first.
  const finderChanges = (on && hide) !== (desk.on && desk.hide_finder_icons);
  if (finderChanges && !(await confirm(t('hideFinderIconsAsk'), t('hideFinderIconsText'), t('restartFinder')))) return;
  api.desktop.enable({ on, hideFinderIcons: hide }).catch(say);
}

export function DesktopSettings() {
  const t = useT();
  const desk = useSettings()?.desktop;
  return (
    <Group>
      <Row label={t('desktopOn')} hint={t('desktopOnHint')} infoLabel={t('moreAbout', t('desktopOn'))}>
        <Switch aria-label={t('desktopOn')} isSelected={!!desk?.on} onChange={(on) => void change('on', on)} />
      </Row>
      <Row label={t('hideFinderIcons')} hint={t('hideFinderIconsHint')} infoLabel={t('moreAbout', t('hideFinderIcons'))}>
        <Switch aria-label={t('hideFinderIcons')} isSelected={!!desk?.hide_finder_icons} isDisabled={!desk?.on} onChange={(on) => void change('hide', on)} />
      </Row>
    </Group>
  );
}
