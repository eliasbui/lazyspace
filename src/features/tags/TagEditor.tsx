import { useState } from 'react';
import { CheckIcon } from '@phosphor-icons/react';
import { SheetFrame } from '@/components/macos/SheetFrame';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { useT } from '@/i18n';
import { panes, usePanesRevision } from '@/lib/panes-api';
import type { SheetProps } from '@/lib/registry';
import { TAG_DOT, TAG_ORDER, tagWord } from '@/lib/tags';
import { isLocal } from '@/lib/uri';
import { cn } from '@/lib/utils';
import { hasTag, setTag } from './tagging';

/** The seven colours for the items selected in the focused pane: each one on when every item has it. */
export function TagEditor({ close }: SheetProps<unknown>) {
  const t = useT();
  usePanesRevision((s) => s.revision);
  const pane = panes.focused();
  const entries = (pane?.tab.selectedEntries() ?? []).filter((e) => isLocal(e.uri));
  // What was just set shows at once, before the pane is listed again with it.
  const [set, setSet] = useState<Record<number, boolean>>({});
  const on = (colour: number): boolean => set[colour] ?? (entries.length > 0 && entries.every((e) => hasTag(e, colour)));

  return (
    <SheetFrame
      open
      onClose={close}
      size="sm"
      title={t('tagsTitle')}
      footer={
        <Button variant="default" onPress={close}>
          {t('done')}
        </Button>
      }
    >
      {pane && entries.length ? (
        <div className="flex flex-col gap-3 pb-2">
          <p className="truncate text-[12px] text-fg-2">{entries.length === 1 ? entries[0]?.name : t('items', entries.length)}</p>
          <div role="group" aria-label={t('tagsTitle')} className="grid grid-cols-2 gap-1">
            {TAG_ORDER.map((colour) => (
              <Toggle
                key={colour}
                size="sm"
                isSelected={on(colour)}
                onChange={(next) => {
                  setSet((s) => ({ ...s, [colour]: next }));
                  void setTag(pane, entries, colour, next);
                }}
                className="justify-start gap-2 rounded-field px-2 text-[13px] font-normal data-selected:bg-tint-soft"
              >
                <span className={cn('size-3 shrink-0 rounded-full', TAG_DOT[colour])} aria-hidden />
                <span className="truncate">{t(tagWord(colour))}</span>
                {on(colour) ? <CheckIcon weight="bold" className="ml-auto size-3.5 text-tint" /> : null}
              </Toggle>
            ))}
          </div>
        </div>
      ) : (
        <p className="py-6 text-center text-[13px] text-fg-2">{t('tagsNone')}</p>
      )}
    </SheetFrame>
  );
}
