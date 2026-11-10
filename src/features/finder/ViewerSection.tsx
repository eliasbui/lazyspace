import { useEffect, useState } from 'react';
import { Group, Row } from '@/components/macos/Settings';
import { Switch } from '@/components/ui/switch';
import { useT } from '@/i18n';
import { say } from '@/lib/ui';
import { api, type ViewerState } from '@/services';

/**
 * Settings: LazySpace as the Mac's file viewer and its app for folders. The switch shows what macOS says, not what was
 * last asked for; macOS's settings can change outside the app, so they are read again whenever the window comes forward.
 */
export function ViewerSection() {
  const t = useT();
  const [state, setState] = useState<ViewerState | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => api.viewer.state().then(setState, () => setBusy(false));
  useEffect(() => {
    void refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  const some = !!state && (state.fileViewer || state.folders);
  const both = !!state && state.fileViewer && state.folders;
  const unavailable = !!state && !state.available && !some;
  const why = unavailable ? t('viewerUnavailable') : some && !both ? t('viewerPartly') : null;
  return (
    <Group>
      <Row label={t('viewerOn')} hint={t('viewerOnHint')}>
        <Switch
          aria-label={t('viewerOn')}
          isSelected={some}
          isDisabled={!state || busy || unavailable}
          onChange={(on) => {
            setBusy(true);
            api.viewer
              .enable({ on })
              .then(setState, (error: unknown) => {
                say(error);
                void refresh();
              })
              .finally(() => setBusy(false));
          }}
        />
      </Row>
      {why ? <p className="px-4 py-2.5 text-[12px] leading-snug text-fg-2">{why}</p> : null}
    </Group>
  );
}
