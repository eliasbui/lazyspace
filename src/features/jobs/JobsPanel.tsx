// The running jobs float above the panes, bottom right, each with a bar, its current item and a way to pause or stop it;
// the questions jobs ask are sheets of their own, kept apart from the other sheets so that none is lost to another.
import { useEffect, useState } from 'react';
import { PauseIcon, PlayIcon, XIcon } from '@phosphor-icons/react';
import { ProgressBar } from 'react-aria-components';
import { SheetFrame } from '@/components/macos/SheetFrame';
import { IconButton } from '@/components/macos/Tip';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { fmtDate, fmtSize } from '@/lib/format';
import { cn } from '@/lib/utils';
import { api, type FileSummary, type Question } from '@/services';
import { answer, connectJobs, useJobs, type JobRow } from './store';

function Job({ row }: { row: JobRow }) {
  const t = useT();
  const percent = row.total > 0 ? Math.min(100, (100 * row.done) / row.total) : null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-[12px]">
      <div className="truncate font-medium">{row.title}</div>
      <div className="flex gap-1">
        {/* A job is paused at its next step and goes on where it was. */}
        <IconButton
          label={t(row.paused ? 'resumeJob' : 'pauseJob')}
          icon={row.paused ? <PlayIcon weight="fill" /> : <PauseIcon weight="fill" />}
          variant="secondary"
          size="icon-xs"
          className="rounded-full text-fg-2 [&_svg]:size-2.5"
          onPress={() => void api.jobs.pause({ id: row.id, paused: !row.paused }).catch(() => undefined)}
        />
        <IconButton
          label={t('stop')}
          icon={<XIcon weight="bold" />}
          variant="secondary"
          size="icon-xs"
          className="rounded-full text-fg-2 [&_svg]:size-2.5"
          onPress={() => void api.jobs.cancel({ id: row.id }).catch(() => undefined)}
        />
      </div>
      <ProgressBar aria-label={row.title} value={percent ?? undefined} isIndeterminate={percent == null} className="col-span-2 h-1 overflow-hidden rounded-full bg-(--track)">
        <div
          className={cn('h-full rounded-full transition-[width] duration-150 ease-linear', row.paused ? 'bg-fg-3' : 'bg-tint', percent == null && 'w-[30%] animate-[indeterminate_1.1s_ease-in-out_infinite]')}
          style={percent == null ? undefined : { width: `${percent}%` }}
        />
      </ProgressBar>
      <div className="col-span-2 truncate text-[11px] text-fg-2">{row.paused ? t('jobPaused') : row.current}</div>
    </div>
  );
}

/** Escape answers a question that waits for an answer; a click beside it does nothing. */
function useEscape(run: () => void): void {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      run();
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [run]);
}

const stop = () => answer('stop');

function Conflict({ q }: { q: Extract<Question, { type: 'conflict' }> }) {
  const t = useT();
  const [all, setAll] = useState(false);
  useEscape(stop);
  const side = (x: FileSummary) => `${x.isDir ? '--' : fmtSize(x.size)}, ${fmtDate(x.mtime)}`;
  return (
    <SheetFrame
      open
      onClose={stop}
      dismissable={false}
      title={t('conflictTitle', q.name)}
      footer={
        <>
          <div className="mr-auto flex items-center gap-2 text-[12px] text-fg-2">
            <Checkbox aria-label={t('applyAll')} isSelected={all} onChange={setAll} />
            <span aria-hidden onClick={() => setAll(!all)}>
              {t('applyAll')}
            </span>
          </div>
          <Button onPress={() => answer('stop', all)}>{t('stop')}</Button>
          <Button onPress={() => answer('skip', all)}>{t('skip')}</Button>
          {q.folder ? <Button onPress={() => answer('merge', all)}>{t('merge')}</Button> : null}
          <Button onPress={() => answer('replace', all)}>{t('replace')}</Button>
          <Button variant="default" autoFocus onPress={() => answer('keepBoth', all)}>
            {t('keepBoth')}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-snug text-fg-2">{q.folder ? t('conflictFolder', q.name) : t('conflictText')}</p>
      <dl className="mt-2.5 mb-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px] text-fg-2">
        <dt>{t('incoming')}</dt>
        <dd className="font-medium text-fg tabular-nums">{side(q.source)}</dd>
        <dt>{t('existing')}</dt>
        <dd className="font-medium text-fg tabular-nums">{side(q.target)}</dd>
      </dl>
    </SheetFrame>
  );
}

function Password({ q }: { q: Extract<Question, { type: 'password' }> }) {
  const t = useT();
  const [text, setText] = useState('');
  useEscape(stop);
  const title = t('password', q.what);
  return (
    <SheetFrame
      open
      onClose={stop}
      dismissable={false}
      size="sm"
      title={title}
      footer={
        <>
          <Button onPress={stop}>{t('cancel')}</Button>
          <Button variant="default" onPress={() => answer({ text })}>
            {t('ok')}
          </Button>
        </>
      }
    >
      <Input
        autoFocus
        type="password"
        aria-label={title}
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') answer({ text });
        }}
      />
    </SheetFrame>
  );
}

function Confirm({ q }: { q: Extract<Question, { type: 'confirm' }> }) {
  const t = useT();
  return (
    <SheetFrame
      open
      onClose={() => answer('no')}
      size="sm"
      title={<span className="whitespace-pre-line">{q.text}</span>}
      footer={
        <>
          <Button onPress={() => answer('no')}>{t('cancel')}</Button>
          <Button variant="default" autoFocus onPress={() => answer('yes')}>
            {t('yes')}
          </Button>
        </>
      }
    >
      {null}
    </SheetFrame>
  );
}

function Asking() {
  const asked = useJobs((s) => s.questions[0]);
  if (!asked) return null;
  const q = asked.question;
  if (q.type === 'conflict') return <Conflict key={asked.seq} q={q} />;
  if (q.type === 'password') return <Password key={asked.seq} q={q} />;
  return <Confirm key={asked.seq} q={q} />;
}

export function JobsPanel() {
  const t = useT();
  const rows = useJobs((s) => s.rows);
  useEffect(() => connectJobs(), []);
  return (
    <>
      {rows.length ? (
        <section aria-label={t('jobsLabel')} data-chrome="" className="fixed right-3.5 bottom-10 z-40 flex w-75 flex-col gap-2.5 rounded-card px-3.5 py-3 glass-pop">
          {rows.map((row) => (
            <Job key={row.id} row={row} />
          ))}
        </section>
      ) : null}
      <Asking />
    </>
  );
}
