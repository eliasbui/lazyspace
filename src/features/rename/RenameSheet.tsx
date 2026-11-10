// The batch rename sheet: rules applied in order and a live preview of the new names. Names that would collide are
// marked and keep the Rename button off; Return renames, as the default button of a Mac dialog does.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CaretDownIcon, CaretRightIcon, CaretUpIcon, PlusIcon, XIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { SheetFrame } from '@/components/macos/SheetFrame';
import { IconButton } from '@/components/macos/Tip';
import { useT, type WordKey } from '@/i18n';
import { panes } from '@/lib/panes-api';
import type { SheetProps } from '@/lib/registry';
import { errorText, say } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { api, type RenameRow, type RenameRule, type Targets } from '@/services';
import { addRule, fresh, moveRule, numberOf, oneOf, payload, removeRule, setRule, TYPES, useRules } from './rules';

export interface RenameProps {
  target: Extract<Targets, { view: string }>;
  count: number;
}

type Result = { rows: RenameRow[]; changed: number; problems: number } | { error: string };

/** The selection of the focused pane, for the sheet opened without props. */
function focusedBatch(): RenameProps | null {
  const tab = panes.focused()?.tab;
  return tab && tab.selCount() ? { target: tab.selection(), count: tab.selCount() } : null;
}

export function RenameSheet({ props, close }: SheetProps<RenameProps | undefined>) {
  const t = useT();
  const [batch] = useState(() => props ?? focusedBatch());
  const rules = useRules((s) => s.rules);
  const [result, setResult] = useState<Result | null>(null);
  const asked = useRef(0);
  const body = useRef<HTMLDivElement>(null);
  const canApply = !!result && !('error' in result) && result.problems === 0 && result.changed > 0;

  useEffect(() => {
    const timer = setTimeout(() => body.current?.querySelector<HTMLInputElement>('input[type="text"]')?.focus(), 30);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!batch) return;
    // Only the answer to the latest rules counts; an earlier one may come back later.
    const n = ++asked.current;
    const timer = setTimeout(() => {
      api.rename.preview({ ...batch.target, rules: payload(rules) }).then(
        (d) => n === asked.current && setResult(d),
        (error: unknown) => n === asked.current && setResult({ error: errorText(error) }),
      );
    }, 120);
    return () => clearTimeout(timer);
  }, [batch, rules]);

  const apply = () => {
    if (!batch || !canApply) return;
    api.rename.apply({ ...batch.target, rules: payload(rules) }).then(() => close(), say);
  };

  const enter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement) || e.target.type === 'checkbox' || !batch) return;
    e.preventDefault();
    const args = { ...batch.target, rules: payload(rules) };
    const n = ++asked.current;
    api.rename
      .preview(args)
      .then((d) => {
        if (d.problems === 0 && d.changed > 0) return api.rename.apply(args).then(() => close());
        if (n === asked.current) setResult(d);
      })
      .catch(say);
  };

  const rows = result && !('error' in result) ? result.rows : [];
  const bad = !!result && ('error' in result || result.problems > 0);
  return (
    <SheetFrame
      open
      onClose={close}
      size="lg"
      title={t('batchTitle', batch?.count ?? 0)}
      footer={
        <>
          <Button onPress={close}>{t('cancel')}</Button>
          <Button variant="default" isDisabled={!canApply} onPress={apply}>
            {t('doRename')}
          </Button>
        </>
      }
    >
      <div ref={body} onKeyDown={enter} className="flex flex-col gap-2 pb-1">
        {rules.map((rule, i) => (
          <RuleCard key={i} rule={rule} index={i} last={i === rules.length - 1} />
        ))}
        <div>
          <Button size="sm" onPress={addRule}>
            <PlusIcon />
            {t('addRule')}
          </Button>
        </div>
        <p role="status" className={cn('mx-0.5 mt-2 min-h-4 text-[12px] font-semibold text-fg-2', bad && 'text-bad')}>
          {result ? ('error' in result ? result.error : t('previewSummary', result.changed, result.problems)) : ''}
        </p>
        {rows.length ? (
          <div role="list" aria-label={t('preview')} className="pane max-h-[34vh] overflow-y-auto rounded-card py-1">
            {rows.map((r, i) => (
              <div role="listitem" key={i} className="grid grid-cols-[1fr_16px_1fr] items-center gap-2 px-2.5 py-1 text-[12px] whitespace-nowrap even:bg-stripe">
                <span className="truncate text-fg-2">{r.from}</span>
                <CaretRightIcon className="size-2.5 text-fg-3" />
                <span title={r.problem ?? undefined} className={cn('truncate', r.to !== r.from && 'font-medium', r.problem && 'text-bad')}>
                  {r.to}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </SheetFrame>
  );
}

function RuleCard({ rule, index, last }: { rule: RenameRule; index: number; last: boolean }) {
  const t = useT();
  return (
    <div className="pane grid grid-cols-[136px_1fr_auto] items-start gap-2.5 rounded-card p-2.5">
      <Choice label={t('ruleKind')} value={rule.type} options={TYPES.map((type) => [type, `r.${type}` as const] as const)} onChange={(type) => setRule(index, fresh(type))} className="w-full" />
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <Fields rule={rule} set={(next) => setRule(index, next)} />
      </div>
      <div className="flex gap-0.5">
        <IconButton size="icon-sm" className="text-fg-2" label={t('moveUp')} icon={<CaretUpIcon />} isDisabled={index === 0} onPress={() => moveRule(index, -1)} />
        <IconButton size="icon-sm" className="text-fg-2" label={t('moveDown')} icon={<CaretDownIcon />} isDisabled={last} onPress={() => moveRule(index, 1)} />
        <IconButton size="icon-sm" className="text-fg-2" label={t('removeRule')} icon={<XIcon />} onPress={() => removeRule(index)} />
      </div>
    </div>
  );
}

const AT = [
  ['start', 'atStart'],
  ['end', 'atEnd'],
  ['index', 'atIndex'],
] as const;

function Fields({ rule, set }: { rule: RenameRule; set: (rule: RenameRule) => void }) {
  const t = useT();
  switch (rule.type) {
    case 'replace':
      return (
        <>
          <TextField wide label={t('find')} value={rule.find} onChange={(find) => set({ ...rule, find })} />
          <TextField wide label={t('replaceWith')} value={rule.with ?? ''} onChange={(value) => set({ ...rule, with: value })} />
          <CheckField label={t('regex')} value={!!rule.regex} onChange={(regex) => set({ ...rule, regex })} />
          <CheckField label={t('ignoreCase')} value={!!rule.caseInsensitive} onChange={(caseInsensitive) => set({ ...rule, caseInsensitive })} />
          <Choice
            label={t('scope')}
            value={rule.scope ?? 'name'}
            options={[
              ['name', 'scopeName'],
              ['ext', 'scopeExt'],
              ['all', 'scopeAll'],
            ]}
            onChange={(scope) => set({ ...rule, scope })}
          />
        </>
      );
    case 'insert':
      return (
        <>
          <TextField wide label={t('text')} value={rule.text} onChange={(text) => set({ ...rule, text })} />
          <Choice label={t('position')} value={rule.at ?? 'end'} options={AT} onChange={(at) => set({ ...rule, at })} />
          {rule.at === 'index' ? <NumberField label={t('position')} value={rule.index ?? 0} onChange={(index) => set({ ...rule, index })} /> : null}
        </>
      );
    case 'remove':
      return (
        <>
          <NumberField label={t('count')} min={1} value={rule.count} onChange={(count) => set({ ...rule, count })} />
          <NumberField label={t('position')} value={rule.from ?? 0} onChange={(from) => set({ ...rule, from })} />
          <CheckField label={t('fromEnd')} value={!!rule.fromEnd} onChange={(fromEnd) => set({ ...rule, fromEnd })} />
        </>
      );
    case 'number':
      return (
        <>
          <NumberField label={t('start')} min={-999999} value={rule.start ?? 1} onChange={(start) => set({ ...rule, start })} />
          <NumberField label={t('step')} min={-9999} value={rule.step ?? 1} onChange={(step) => set({ ...rule, step })} />
          <NumberField label={t('digits')} value={rule.pad ?? 2} onChange={(pad) => set({ ...rule, pad })} />
          <Choice label={t('position')} value={rule.at ?? 'end'} options={AT} onChange={(at) => set({ ...rule, at })} />
          {rule.at === 'index' ? <NumberField label={t('position')} value={rule.index ?? 0} onChange={(index) => set({ ...rule, index })} /> : null}
          <TextField label={t('separator')} value={rule.sep ?? ''} onChange={(sep) => set({ ...rule, sep })} />
        </>
      );
    case 'parent':
      return (
        <>
          <Choice label={t('position')} value={rule.at === 'end' ? 'end' : 'start'} options={AT.slice(0, 2)} onChange={(at) => set({ ...rule, at })} />
          <TextField label={t('separator')} value={rule.sep ?? ''} onChange={(sep) => set({ ...rule, sep })} />
        </>
      );
    case 'case':
      return (
        <Choice
          label={t('r.case')}
          value={rule.mode}
          options={[
            ['lower', 'lower'],
            ['upper', 'upper'],
            ['title', 'title'],
            ['sentence', 'sentence'],
          ]}
          onChange={(mode) => set({ ...rule, mode })}
        />
      );
    case 'ext':
      return (
        <>
          <TextField wide label={t('newExt')} value={rule.set ?? ''} onChange={(value) => set({ ...rule, set: value })} />
          <Choice
            label={t('r.case')}
            value={rule.case === 'lower' || rule.case === 'upper' ? rule.case : ''}
            options={[
              ['', 'keepCase'],
              ['lower', 'lower'],
              ['upper', 'upper'],
            ]}
            onChange={(value) => set({ ...rule, case: value || null })}
          />
        </>
      );
  }
}

function Choice<T extends string>({ label, value, options, onChange, className }: { label: string; value: T; options: ReadonlyArray<readonly [T, WordKey]>; onChange: (value: T) => void; className?: string }) {
  const t = useT();
  const values = options.map(([v]) => v);
  return (
    <NativeSelect size="sm" aria-label={label} value={value} onChange={(e) => onChange(oneOf(values, e.target.value))} className={cn('min-w-28', className)}>
      {options.map(([v, word]) => (
        <NativeSelectOption key={v} value={v}>
          {t(word)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

const fieldClass = 'h-7 rounded-field px-2 text-[13px] text-fg md:text-[13px]';

function TextField({ label, value, onChange, wide = false }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-fg-2">
      <span>{label}</span>
      <Input type="text" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} className={cn(fieldClass, wide ? 'w-[150px]' : 'w-[70px]')} />
    </label>
  );
}

function NumberField({ label, value, onChange, min = 0 }: { label: string; value: number; onChange: (value: number) => void; min?: number }) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-fg-2">
      <span>{label}</span>
      <Input type="number" min={min} value={String(value)} onChange={(e) => onChange(numberOf(e.target.value))} className={cn(fieldClass, 'w-[70px]')} />
    </label>
  );
}

/** A checkbox with its words beside it; a click on the words ticks it too. */
function CheckField({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px]">
      <Checkbox aria-label={label} isSelected={value} onChange={onChange} />
      <span aria-hidden="true" onClick={() => onChange(!value)}>
        {label}
      </span>
    </span>
  );
}
