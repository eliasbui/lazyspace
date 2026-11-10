import { Group, Row } from '@/components/macos/Settings';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { openSheet } from '@/lib/registry';
import type { MenuEditProps } from './MenuEditSheet';

/** Settings: the button that opens the menu editor. */
export function MenuEditSection() {
  const t = useT();
  return (
    <Group>
      <Row label={t('contextMenu')} hint={t('contextMenuHint')}>
        <Button onPress={() => openSheet<MenuEditProps>('menuedit', { from: 'settings' })}>{t('editMenu')}</Button>
      </Row>
    </Group>
  );
}
