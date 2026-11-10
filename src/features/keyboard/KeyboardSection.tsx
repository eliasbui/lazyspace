import { Group, Row } from '@/components/macos/Settings';
import { Segmented } from '@/components/macos/Segmented';
import { useT } from '@/i18n';
import { setSetting, useSettings } from '@/lib/app-state';
import type { KeymapName } from '@/services';

/** Settings: the keys of a Mac, or those of Windows Explorer. */
export function KeyboardSection() {
  const t = useT();
  const keymap = useSettings()?.keymap ?? 'mac';
  return (
    <Group>
      <Row label={t('keyStyle')} hint={t('keyStyleHint')}>
        <Segmented<KeymapName>
          label={t('keyStyle')}
          value={keymap}
          options={[
            { value: 'mac', label: t('keysMac') },
            { value: 'windows', label: t('keysWindows') },
          ]}
          onChange={(value) => void setSetting({ keymap: value })}
        />
      </Row>
    </Group>
  );
}
