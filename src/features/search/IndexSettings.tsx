import { useEffect, useState } from 'react';
import { Group, Row } from '@/components/macos/Settings';
import { Button } from '@/components/ui/button';
import { useI18n, useT } from '@/i18n';
import { say } from '@/lib/ui';
import { api, type Methods } from '@/services';

type IndexState = Methods['index.state']['result'];

/** Settings: how big the quick index is, and a button to walk the disk again; while it is built, it is asked again. */
export function IndexSettings() {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const [state, setState] = useState<IndexState | null>(null);
  const [asks, setAsks] = useState(0);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () =>
      api.index.state().then(
        (s) => {
          if (!live) return;
          setState(s);
          if (s.building) timer = setTimeout(ask, 1000);
        },
        () => undefined,
      );
    void ask();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [asks]);

  const count = state ? state.count.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US') : '';
  const note = !state
    ? ''
    : state.building && !state.ready
      ? t('indexBuilding')
      : state.ready
        ? t('indexCount', count) + (state.building ? ` (${t('indexBuilding')})` : '')
        : t('indexNotReady');

  return (
    <Group>
      <Row label={t('quickIndex')} hint={t('quickIndexHint')} infoLabel={t('quickIndex')}>
        <span role="status" className="text-[12px] text-fg-2 tabular-nums">
          {note}
        </span>
        <Button onPress={() => api.index.rebuild().then(() => setTimeout(() => setAsks((n) => n + 1), 100), say)}>{t('reindex')}</Button>
      </Row>
    </Group>
  );
}
