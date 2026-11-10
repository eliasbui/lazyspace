import { useEffect, useState, type ReactNode } from 'react';
import { Pill } from '@/components/macos/Glass';
import { SheetFrame } from '@/components/macos/SheetFrame';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { panes, usePanesRevision } from '@/lib/panes-api';
import type { SheetProps } from '@/lib/registry';
import { say } from '@/lib/ui';
import { isLocal } from '@/lib/uri';
import { api, iconUrl, pixelRatio, type AppInfo } from '@/services';
import { loadTools, openIn, useTools, type ToolKind } from './store';

/** One app to open with: its icon, its name, and whether it is the default. */
function Choice({ path, name, isDefault, onPress }: { path: string; name: string; isDefault: boolean; onPress: () => void }) {
  const t = useT();
  return (
    <li>
      <Button variant="ghost" className="h-8 w-full justify-start gap-2 rounded-field px-2 font-normal" onPress={onPress}>
        <img src={iconUrl(`path:${path}`, 20 * pixelRatio())} alt="" draggable={false} className="size-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{name}</span>
        {isDefault ? <Pill tone="tint">{t('defaultTool')}</Pill> : null}
      </Button>
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="truncate px-2 text-[11px] font-semibold text-fg-2">{title}</h3>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

/**
 * Open With: the apps of this Mac for the one file selected, the system's default marked, then the terminals and the
 * editors for the pane's folder (an editor takes the item selected); the one used last of each kind is its default.
 */
export function OpenWithSheet({ close }: SheetProps<unknown>) {
  const t = useT();
  usePanesRevision((s) => s.revision);
  const tools = useTools((s) => s.list);
  const pane = panes.focused();
  const one = pane?.tab.selCount() === 1 ? (pane.tab.selectedEntries()[0] ?? null) : null;
  const file = one && !one.isDir && isLocal(one.uri) ? one : null;
  const [apps, setApps] = useState<{ uri: string; list: AppInfo[] } | null>(null);

  useEffect(() => void loadTools(), []);
  useEffect(() => {
    if (!file) return;
    let live = true;
    api.native.appsFor({ uri: file.uri }).then(
      (list) => live && setApps({ uri: file.uri, list }),
      () => live && setApps({ uri: file.uri, list: [] }),
    );
    return () => {
      live = false;
    };
  }, [file?.uri]);

  const local = !!pane && isLocal(pane.tab.uri);
  const kinds: Array<[ToolKind, string]> = [
    ['terminal', t('openTerminal')],
    ['editor', t('openEditor')],
  ];
  const appList = file && apps?.uri === file.uri ? apps.list : [];

  return (
    <SheetFrame
      open
      onClose={close}
      title={t('m.openWith')}
      footer={<Button onPress={close}>{t('cancel')}</Button>}
    >
      {pane && (local || appList.length) ? (
        <div className="flex flex-col gap-4 pb-2">
          {file && appList.length ? (
            <Section title={file.name}>
              {appList.map((app) => (
                <Choice
                  key={app.path}
                  path={app.path}
                  name={app.name}
                  isDefault={app.default}
                  onPress={() => {
                    api.native.openWith({ uris: [file.uri], app: app.path }).catch(say);
                    close();
                  }}
                />
              ))}
            </Section>
          ) : null}
          {local
            ? kinds.map(([kind, title]) => {
                const own = tools.filter((tool) => tool.kind === kind);
                return own.length ? (
                  <Section key={kind} title={title}>
                    {own.map((tool) => (
                      <Choice
                        key={tool.id}
                        path={tool.path}
                        name={tool.name}
                        isDefault={tool.default}
                        onPress={() => {
                          openIn(pane, kind, tool.id);
                          close();
                        }}
                      />
                    ))}
                  </Section>
                ) : null;
              })
            : null}
        </div>
      ) : (
        <p className="py-6 text-center text-[13px] text-fg-2">{t('openInNone')}</p>
      )}
    </SheetFrame>
  );
}
