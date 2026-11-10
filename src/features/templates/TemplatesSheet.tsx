import { useEffect } from 'react';
import { FolderIcon } from '@phosphor-icons/react';
import { SheetFrame } from '@/components/macos/SheetFrame';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { panes, usePanesRevision } from '@/lib/panes-api';
import type { SheetProps } from '@/lib/registry';
import { templateIcon } from './icons';
import { addTemplate, canBeTemplate, createFromTemplate, loadTemplates, openTemplatesFolder, templateLabel, useTemplates } from './store';

/** New File: the templates as tiles; one makes its file in the focused pane's folder, named and ready to rename. */
export function TemplatesSheet({ close }: SheetProps<unknown>) {
  const t = useT();
  usePanesRevision((s) => s.revision);
  const list = useTemplates((s) => s.list);
  useEffect(() => void loadTemplates(), []);
  const pane = panes.focused();
  const writable = !!pane?.tab.capabilities.write;
  const one = pane?.tab.selCount() === 1 ? (pane.tab.selectedEntries()[0] ?? null) : null;
  const template = one && canBeTemplate(one) ? one : null;

  return (
    <SheetFrame
      open
      onClose={close}
      title={t('newFile')}
      footer={
        <>
          <div className="mr-auto flex gap-2">
            {pane ? (
              <Button
                onPress={() => {
                  openTemplatesFolder(pane);
                  close();
                }}
              >
                <FolderIcon />
                {t('templatesFolder')}
              </Button>
            ) : null}
            {template ? <Button onPress={() => addTemplate(template)}>{t('addTemplate')}</Button> : null}
          </div>
          <Button onPress={close}>{t('cancel')}</Button>
        </>
      }
    >
      {pane && writable ? (
        <ul className="grid grid-cols-4 gap-2 pb-2">
          {list.map((tpl) => {
            const Icon = templateIcon(tpl.ext);
            return (
              <li key={tpl.id}>
                <Button
                  variant="ghost"
                  className="h-auto w-full flex-col gap-1.5 rounded-card px-2 py-3 text-[12px] font-normal whitespace-normal"
                  onPress={() => {
                    createFromTemplate(pane, tpl.id);
                    close();
                  }}
                >
                  <Icon weight="light" className="size-8 text-tint" />
                  <span className="line-clamp-2 text-center break-words">{templateLabel(tpl)}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-6 text-center text-[13px] text-fg-2">{t('noNewFileHere')}</p>
      )}
    </SheetFrame>
  );
}
