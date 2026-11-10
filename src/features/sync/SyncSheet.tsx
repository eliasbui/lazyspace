import { memo, useEffect, useId, useMemo, type ReactNode } from 'react';
import { ArrowsLeftRightIcon } from '@phosphor-icons/react';
import { Pill } from '@/components/macos/Glass';
import { Segmented } from '@/components/macos/Segmented';
import { SheetFrame } from '@/components/macos/SheetFrame';
import { IconButton } from '@/components/macos/Tip';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useT } from '@/i18n';
import { fmtDate, fmtSize } from '@/lib/format';
import type { SheetProps } from '@/lib/registry';
import { pathOf } from '@/lib/uri';
import { cn } from '@/lib/utils';
import type { SyncPair, SyncSide } from '@/services';
import { ACTIONS, apply, compare, fromPanes, setAction, setOption, SHOWN, STATES, swap, useSync, type Options } from './store';

const TONE = { leftNewer: 'tint', rightNewer: 'tint', leftOnly: 'neutral', rightOnly: 'neutral', conflict: 'warn', same: 'neutral' } as const;
const side = (s: SyncSide | null): string => (s ? `${s.isDir ? '--' : fmtSize(s.size)}, ${fmtDate(s.mtime)}` : '');

/** Two folders side by side: how they differ, what each line would do, and Sync to do it. */
export function SyncSheet({ close }: SheetProps<undefined>) {
  const t = useT();
  const left = useSync((s) => s.left);
  const right = useSync((s) => s.right);
  const pairs = useSync((s) => s.pairs);
  const job = useSync((s) => s.job);
  const filter = useSync((s) => s.filter);
  const options = useSync((s) => s.options);
  const status = useSync((s) => s.status);

  // Opened with no folders (a sheet opened by its id), it takes the panes' folders, as Compare with the Next Pane does.
  useEffect(() => {
    if (!useSync.getState().left) fromPanes();
  }, []);

  const counts = useMemo(() => {
    const c = { leftNewer: 0, rightNewer: 0, leftOnly: 0, rightOnly: 0, conflict: 0, same: 0 };
    for (const p of pairs) c[p.state]++;
    return c;
  }, [pairs]);
  const shown = useMemo(() => pairs.map((p, i) => [p, i] as const).filter(([p]) => filter === 'all' || p.state === filter), [pairs, filter]);
  const active = pairs.filter((p) => p.action !== 'skip').length;
  const busy = status?.kind === 'comparing';
  const filters = [{ key: 'all' as const, label: t('filterAll'), n: pairs.length }, ...STATES.filter((s) => counts[s]).map((s) => ({ key: s, label: t(`s.${s}`), n: counts[s] }))];

  return (
    <SheetFrame
      open
      onClose={close}
      size="xl"
      title={t('syncTitle')}
      footer={
        <>
          <Button onPress={close}>{t('done')}</Button>
          <Button variant="default" isDisabled={!active || busy} onPress={() => void apply()}>
            {active ? `${t('doSync')} (${active})` : t('doSync')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <Place uri={left} />
          <IconButton label={t('swap')} icon={<ArrowsLeftRightIcon />} isDisabled={!left || !right} onPress={swap} />
          <Place uri={right} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented<Options['mode']>
            label={t('syncDirection')}
            value={options.mode}
            onChange={(v) => setOption('mode', v)}
            options={[
              { value: 'ltr', label: t('modeLtr') },
              { value: 'rtl', label: t('modeRtl') },
              { value: 'both', label: t('modeBoth') },
            ]}
          />
          <Segmented<'time' | 'content'>
            label={t('syncCompareBy')}
            value={options.content ? 'content' : 'time'}
            onChange={(v) => setOption('content', v === 'content')}
            options={[
              { value: 'time', label: t('byTime') },
              { value: 'content', label: t('byContent') },
            ]}
          />
          <Button className="ml-auto" isDisabled={!left || !right} onPress={compare}>
            {t('compare')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Check checked={options.ignoreHidden} onChange={(on) => setOption('ignoreHidden', on)}>
            {t('ignoreHidden')}
          </Check>
          <Check checked={options.mirror && options.mode !== 'both'} disabled={options.mode === 'both'} onChange={(on) => setOption('mirror', on)}>
            {t('mirror')}
          </Check>
        </div>
        {pairs.length ? (
          <ToggleGroup
            aria-label={t('syncShow')}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[filter]}
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              const found = filters.find((f) => f.key === next);
              if (found) useSync.setState({ filter: found.key });
            }}
            spacing={1}
            className="flex-wrap"
          >
            {filters.map((f) => (
              <ToggleGroupItem key={f.key} id={f.key} size="sm" className="rounded-full text-[12px] text-fg-2 data-selected:bg-tint-soft data-selected:text-tint">
                {f.label}
                <span className="font-semibold tabular-nums">{f.n}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
        <p className={cn('flex min-h-5 items-center gap-2 text-[12px] text-fg-2', status?.kind === 'error' && 'text-bad')} aria-live="polite">
          {busy ? <Spinner aria-label={t('comparing')} className="size-3.5" /> : null}
          {status?.kind === 'comparing' ? t('comparing') : null}
          {status?.kind === 'error' ? status.text : null}
          {status?.kind === 'result' ? `${t('syncSummary', status.same, pairs.length)}${status.truncated ? ` ${t('syncTruncated')}` : ''}` : null}
        </p>
        <div className="pane max-h-[min(40vh,320px)] min-h-32 overflow-y-auto rounded-card">
          {shown.length ? (
            <ul className="divide-y divide-hair">
              {shown.slice(0, SHOWN).map(([p, i]) => (
                <Line key={p.rel} pair={p} index={i} />
              ))}
            </ul>
          ) : status?.kind === 'result' && !job ? (
            <p className="flex h-32 items-center justify-center text-[13px] text-fg-2">{t('allSame')}</p>
          ) : null}
        </div>
      </div>
    </SheetFrame>
  );
}

function Place({ uri }: { uri: string | null }) {
  const path = uri ? pathOf(uri) : '--';
  return (
    <span className="selectable flex h-7 min-w-0 items-center rounded-field bg-field px-2.5 text-[12px]" title={path}>
      <span className="truncate">{path}</span>
    </span>
  );
}

const Line = memo(function Line({ pair, index }: { pair: SyncPair; index: number }) {
  const t = useT();
  return (
    <li className="grid h-9 grid-cols-[104px_minmax(0,1fr)_132px_164px_132px] items-center gap-2 px-3 text-[12px]">
      <Pill tone={TONE[pair.state]} className="justify-self-start">
        {pair.state === 'same' ? '' : t(`s.${pair.state}`)}
      </Pill>
      <span className="truncate" title={pair.rel}>
        {pair.rel}
      </span>
      <span className="truncate text-right text-[11px] text-fg-2 tabular-nums">{side(pair.left)}</span>
      <NativeSelect size="sm" aria-label={pair.rel} value={pair.action} onChange={(e) => {
          const action = ACTIONS.find((a) => a === e.target.value);
          if (action) setAction(index, action);
        }} className="w-full">
        {ACTIONS.map((a) => (
          <NativeSelectOption key={a} value={a}>
            {t(`a.${a}`)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <span className="truncate text-[11px] text-fg-2 tabular-nums">{side(pair.right)}</span>
    </li>
  );
});

/** A box to tick with its words beside it; a press on the words ticks it too. */
function Check({ checked, disabled = false, onChange, children }: { checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className={cn('flex items-center gap-2 text-[13px]', disabled && 'opacity-50')}>
      <Checkbox isSelected={checked} isDisabled={disabled} onChange={onChange} aria-labelledby={id} />
      <span id={id} onClick={() => !disabled && onChange(!checked)}>
        {children}
      </span>
    </div>
  );
}
