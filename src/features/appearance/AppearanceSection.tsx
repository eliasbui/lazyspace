import { useEffect, useState } from 'react';
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { Group, Row } from '@/components/macos/Settings';
import { Segmented } from '@/components/macos/Segmented';
import { Tip } from '@/components/macos/Tip';
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@/components/ui/native-select';
import { useT, type WordKey } from '@/i18n';
import { setSetting, useSettings } from '@/lib/app-state';
import { cn } from '@/lib/utils';
import { api, type AccentName, type Settings } from '@/services';
import { ACCENTS, DESIGNS, ICON_SIZES } from './look';

// The families installed on the Mac, asked for once, the first time Settings shows them.
let families: Promise<string[]> | null = null;
function installedFonts(): Promise<string[]> {
  families ??= api.native.fonts().catch(() => {
    families = null;
    return [];
  });
  return families;
}

/** Settings: the accent colour, the font of the window, the sidebar's icons, and the sizes of icons and of list text. */
export function AppearanceSection() {
  const t = useT();
  const settings = useSettings();
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void installedFonts().then((list) => live && setFonts(list));
    return () => {
      live = false;
    };
  }, []);
  if (!settings) return null;
  const font = settings.font;
  // The font chosen stays in the list before the families are in, or when it was removed from the Mac.
  const mac = font && !DESIGNS.some(([value]) => value === font) && !fonts.includes(font) ? [font, ...fonts] : fonts;

  return (
    <Group>
      <Row label={t('accentColor')} hint={t('accentHint')}>
        <ToggleButtonGroup
          aria-label={t('accentColor')}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[settings.accent]}
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (typeof next === 'string') void setSetting({ accent: next as AccentName });
          }}
          className="flex items-center gap-2"
        >
          {ACCENTS.map((name) => (
            <Tip key={name} text={t(`accent.${name}`)}>
              <ToggleButton
                id={name}
                aria-label={t(`accent.${name}`)}
                data-accent={name === 'system' ? undefined : name}
                className={cn(
                  'size-[18px] rounded-full shadow-[inset_0_0_0_0.5px_var(--hair-2)] outline-none ring-offset-2 ring-offset-pane transition-shadow data-focus-visible:ring-2 data-focus-visible:ring-ring data-selected:ring-2 data-selected:ring-tint',
                  name === 'system' ? 'swatch-system' : 'bg-tint',
                )}
              />
            </Tip>
          ))}
        </ToggleButtonGroup>
      </Row>
      <Row label={t('font')} hint={t('fontHint')}>
        <NativeSelect size="sm" aria-label={t('font')} className="w-52" value={font} onChange={(e) => void setSetting({ font: e.target.value })}>
          <NativeSelectOptGroup label={t('fontsApple')}>
            {DESIGNS.map(([value, word]) => (
              <NativeSelectOption key={value} value={value}>
                {t(word)}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
          {mac.length ? (
            <NativeSelectOptGroup label={t('fontsMac')}>
              {mac.map((family) => (
                <NativeSelectOption key={family} value={family}>
                  {family}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          ) : null}
        </NativeSelect>
      </Row>
      <Row label={t('sidebarIcons')} hint={t('sidebarIconsHint')}>
        <Segmented<Settings['sidebar_icons']>
          label={t('sidebarIcons')}
          value={settings.sidebar_icons}
          options={[
            { value: 'mono', label: t('iconsMono') },
            { value: 'color', label: t('iconsColor') },
          ]}
          onChange={(value) => void setSetting({ sidebar_icons: value })}
        />
      </Row>
      <Row label={t('iconSize')} hint={t('iconSizeHint')}>
        <Segmented
          label={t('iconSize')}
          value={String(settings.icon_size)}
          options={ICON_SIZES.map(([size, word]: [number, WordKey]) => ({ value: String(size), label: t(word) }))}
          onChange={(value) => {
            const size = ICON_SIZES.find(([s]) => String(s) === value)?.[0];
            if (size) void setSetting({ icon_size: size });
          }}
        />
      </Row>
      <Row label={t('textSize')} hint={t('textSizeHint')}>
        <Segmented<Settings['text_size']>
          label={t('textSize')}
          value={settings.text_size}
          options={[
            { value: 'small', label: t('sizeSmall') },
            { value: 'medium', label: t('sizeMedium') },
            { value: 'large', label: t('sizeLarge') },
          ]}
          onChange={(value) => void setSetting({ text_size: value })}
        />
      </Row>
    </Group>
  );
}
