// The compress sheet: a zip, 7z or tar archive of the selection, with a password and split volumes where the format allows.
import { useId, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { SheetFrame } from '@/components/macos/SheetFrame';
import { useT } from '@/i18n';
import { panes, type TabView } from '@/lib/panes-api';
import type { SheetProps } from '@/lib/registry';
import { errorText } from '@/lib/ui';
import { isLocal } from '@/lib/uri';
import { cn } from '@/lib/utils';
import { api, type ArchiveFormat, type Row, type Targets } from '@/services';
import { offeredName } from './kinds';

export interface CompressProps {
  target: Extract<Targets, { view: string }>;
  count: number;
  /** The name the archive is offered: the one item's name without its extension, or empty for several. */
  name: string;
}

/** What to compress of a tab: its selection, when some of it is on this Mac. */
export function compressBatch(tab: TabView, entries: Row[], count: number): CompressProps | null {
  const local = entries.filter((e) => isLocal(e.uri));
  if (!local.length) return null;
  const one = local.length === 1 ? local[0] : null;
  return { target: tab.selection(), count, name: one ? offeredName(one.name) : '' };
}

function focusedBatch(): CompressProps | null {
  const tab = panes.focused()?.tab;
  return tab ? compressBatch(tab, tab.selectedEntries(), tab.selCount()) : null;
}

const FORMATS: readonly ArchiveFormat[] = ['zip', '7z', 'tar.gz', 'tar.xz', 'tar.bz2'];
const LEVELS = [
  [1, 'levelFast'],
  [5, 'levelNormal'],
  [9, 'levelBest'],
] as const;
/** Volumes in MB; 0 is one file. */
const SPLITS = [100, 700, 1024, 4096];
const splitLabel = (mb: number): string => (mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`);

export function CompressSheet({ props, close }: SheetProps<CompressProps | undefined>) {
  const t = useT();
  const id = useId();
  const [batch] = useState(() => props ?? focusedBatch());
  const [name, setName] = useState(batch?.name ?? '');
  const [format, setFormat] = useState<ArchiveFormat>('zip');
  const [level, setLevel] = useState(5);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [split, setSplit] = useState(0);
  const [note, setNote] = useState('');
  // Only zip and 7z take a password or split volumes.
  const passworded = format === 'zip' || format === '7z';

  const go = () => {
    if (!batch) return;
    if (passworded && password && password !== again) return setNote(t('passwordMismatch'));
    api.archive
      .create({
        ...batch.target,
        format,
        name: name.trim() || null,
        password: passworded && password ? password : null,
        level,
        splitMb: passworded ? split : 0,
      })
      .then(
        () => close(),
        (error: unknown) => setNote(errorText(error)),
      );
  };
  const enter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    go();
  };

  const label = 'text-[12px] text-fg-2';
  const field = 'h-7 rounded-field px-2 text-[13px] md:text-[13px]';
  return (
    <SheetFrame
      open
      onClose={close}
      title={t('compressTitle', batch?.count ?? 0)}
      footer={
        <>
          <Button onPress={close}>{t('cancel')}</Button>
          <Button variant="default" isDisabled={!batch} onPress={go}>
            {t('doCompress')}
          </Button>
        </>
      }
    >
      <div onKeyDown={enter} className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 pt-1">
        <label htmlFor={`${id}-name`} className={label}>
          {t('archiveName')}
        </label>
        <Input id={`${id}-name`} autoFocus spellCheck={false} value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} className={field} />
        <label htmlFor={`${id}-format`} className={label}>
          {t('archiveFormat')}
        </label>
        <NativeSelect size="sm" id={`${id}-format`} value={format} onChange={(e) => setFormat(FORMATS.find((f) => f === e.target.value) ?? 'zip')} className="w-full">
          {FORMATS.map((f) => (
            <NativeSelectOption key={f} value={f}>
              {f}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <label htmlFor={`${id}-level`} className={label}>
          {t('archiveLevel')}
        </label>
        <NativeSelect size="sm" id={`${id}-level`} value={String(level)} onChange={(e) => setLevel(Number(e.target.value))} className="w-full">
          {LEVELS.map(([value, word]) => (
            <NativeSelectOption key={value} value={String(value)}>
              {t(word)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <label htmlFor={`${id}-pw`} className={cn(label, !passworded && 'opacity-45')}>
          {t('archivePassword')}
        </label>
        <Input id={`${id}-pw`} type="password" disabled={!passworded} value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        <label htmlFor={`${id}-pw2`} className={cn(label, !passworded && 'opacity-45')}>
          {t('archivePasswordAgain')}
        </label>
        <Input id={`${id}-pw2`} type="password" disabled={!passworded} value={again} onChange={(e) => setAgain(e.target.value)} className={field} />
        <label htmlFor={`${id}-split`} className={cn(label, !passworded && 'opacity-45')}>
          {t('splitVolumes')}
        </label>
        <NativeSelect size="sm" id={`${id}-split`} disabled={!passworded} value={String(split)} onChange={(e) => setSplit(Number(e.target.value))} className="w-full">
          <NativeSelectOption value="0">{t('splitNone')}</NativeSelectOption>
          {SPLITS.map((mb) => (
            <NativeSelectOption key={mb} value={String(mb)}>
              {splitLabel(mb)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="min-h-5 pt-2 pb-1 text-[12px]">
        {note ? <p role="alert" className="text-bad">{note}</p> : !passworded ? <p className="text-fg-3">{t('passwordOnlyZip7z')}</p> : null}
      </div>
    </SheetFrame>
  );
}
