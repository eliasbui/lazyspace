import { useEffect, useState } from 'react';
import { SheetFrame } from '@/components/macos/SheetFrame';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { fmtSize } from '@/lib/format';
import { panes } from '@/lib/panes-api';
import type { SheetProps } from '@/lib/registry';
import { say, toast } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { api, type HashResult } from '@/services';
import { ALGOS, matchOf, normalHash, startHash, useHash } from './store';

function copy(text: string, done: string): void {
  api.clipboard.text({ text }).then(() => toast(done), say);
}

function FileHashes({ result, want }: { result: HashResult; want: string }) {
  const t = useT();
  return (
    <div className="pane rounded-card px-3 py-2.5">
      <div className="mb-1.5 flex min-w-0 items-baseline gap-2">
        <b className="truncate font-semibold">{result.name}</b>
        <span className="shrink-0 text-[12px] text-fg-2">{fmtSize(result.size)}</span>
      </div>
      {ALGOS.map(([key, label]) => {
        const value = result.hashes[key];
        return (
          <div key={key} className={cn('grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-0.5', want && value === want && 'bg-good/15')}>
            <span className="text-[11px] font-semibold text-fg-2">{label}</span>
            <code className="selectable font-mono text-[11.5px] break-all">{value}</code>
            <Button size="xs" onPress={() => copy(value, t('copied'))} aria-label={`${t('copy')} ${label}`}>
              {t('copy')}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

/** The hashes of the files selected: every algorithm for each file, and a field to paste a hash into, which marks the
 *  one that matches. */
export function HashSheet({ close }: SheetProps<unknown>) {
  const t = useT();
  const { started, results, error } = useHash();
  const [compare, setCompare] = useState('');
  const want = normalHash(compare);
  const hit = want ? matchOf(results, want) : null;

  // Opened by itself (not by the menu or the action), it hashes what the focused pane has selected.
  useEffect(() => {
    const pane = panes.focused();
    if (!useHash.getState().started && pane?.tab.selCount()) startHash(pane, false);
  }, []);

  return (
    <SheetFrame
      open
      onClose={close}
      size="lg"
      title={t('hashTitle')}
      footer={
        <Button variant="default" onPress={close}>
          {t('done')}
        </Button>
      }
    >
      <div className="flex flex-col gap-2 pb-2">
        <Input
          className="h-7 font-mono text-[12px]"
          aria-label={t('hashCompare')}
          placeholder={t('hashCompare')}
          spellCheck={false}
          value={compare}
          onChange={(e) => setCompare(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <p role="status" className={cn('min-h-[18px] text-[12px] font-semibold', hit ? 'text-good' : 'text-bad')}>
          {want ? (hit ? t('hashMatch', hit[0], hit[1]) : t('hashNoMatch')) : ''}
        </p>
        <div className="flex flex-col gap-3">
          {results.map((result) => (
            <FileHashes key={result.uri} result={result} want={want} />
          ))}
          {error ? <p className="text-[13px] text-bad">{error}</p> : null}
          {!error && started && !results.length ? (
            <p className="flex items-center gap-2 text-[13px] text-fg-2">
              <Spinner aria-hidden className="size-3.5" />
              {t('hashWorking')}
            </p>
          ) : null}
          {!started ? <p className="py-4 text-center text-[13px] text-fg-2">{t('hashNothing')}</p> : null}
        </div>
      </div>
    </SheetFrame>
  );
}
