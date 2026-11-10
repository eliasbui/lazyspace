import { useState } from 'react';
import { PlusIcon, XIcon } from '@phosphor-icons/react';
import { Group, Row } from '@/components/macos/Settings';
import { IconButton } from '@/components/macos/Tip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useT, type WordKey } from '@/i18n';
import type { UserAction } from '@/services';
import { editAction, saveSoon, useUserActions } from './store';

const WHEN: Array<[UserAction['when'], WordKey]> = [
  ['any', 'when.any'],
  ['files', 'when.files'],
  ['folders', 'when.folders'],
  ['none', 'when.none'],
];
const OUTPUT: Array<[UserAction['output'], WordKey]> = [
  ['toast', 'out.toast'],
  ['terminal', 'out.terminal'],
  ['none', 'out.none'],
];

const isWhen = (v: string): v is UserAction['when'] => WHEN.some(([w]) => w === v);
const isOutput = (v: string): v is UserAction['output'] => OUTPUT.some(([o]) => o === v);

/** Settings: the commands as rows of fields, saved as they are typed. */
export function ActionsSettings() {
  const t = useT();
  const list = useUserActions((s) => s.list);
  const [added, setAdded] = useState<string | null>(null);

  const add = () => {
    const id = `a${Date.now().toString(36)}`;
    useUserActions.setState((s) => ({ list: [...s.list, { id, name: '', command: '', when: 'any', output: 'toast' }] }));
    setAdded(id);
  };
  const remove = (index: number) => {
    useUserActions.setState((s) => ({ list: s.list.filter((_, i) => i !== index) }));
    saveSoon();
  };

  return (
    // The keys typed here are the fields' own, not the keymap's; Escape is still the sheet's.
    <div onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
      <Group>
        {list.map((a, i) => (
          <div key={a.id} className="grid grid-cols-[120px_minmax(0,1fr)_112px_128px_28px] items-center gap-1.5 px-3 py-2">
            <Input className="h-7 text-[12px]" aria-label={t('actionName')} placeholder={t('actionName')} spellCheck={false} autoFocus={a.id === added} value={a.name} onChange={(e) => editAction(i, { name: e.target.value })} />
            <Input className="h-7 font-mono text-[12px]" aria-label={t('actionCommand')} placeholder={t('actionCommand')} spellCheck={false} value={a.command} onChange={(e) => editAction(i, { command: e.target.value })} />
            <NativeSelect size="sm" className="w-full" aria-label={t('actionWhen')} value={a.when} onChange={(e) => isWhen(e.target.value) && editAction(i, { when: e.target.value })}>
              {WHEN.map(([value, word]) => (
                <NativeSelectOption key={value} value={value}>
                  {t(word)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect size="sm" className="w-full" aria-label={t('actionOutput')} value={a.output} onChange={(e) => isOutput(e.target.value) && editAction(i, { output: e.target.value })}>
              {OUTPUT.map(([value, word]) => (
                <NativeSelectOption key={value} value={value}>
                  {t(word)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <IconButton label={t('removeAction')} icon={<XIcon />} size="icon" className="text-fg-2 hover:text-bad" onPress={() => remove(i)} />
          </div>
        ))}
        <Row
          className="px-3"
          label={
            <Button onPress={add}>
              <PlusIcon />
              {t('addAction')}
            </Button>
          }
          keywords={`${t('actionsTitle')} ${t('addAction')}`}
          hint={t('actionsHint')}
          infoLabel={t('actionsTitle')}
        />
      </Group>
    </div>
  );
}
