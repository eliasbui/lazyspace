// Jobs on the page: a row for each one that takes more than a moment, and the questions a job asks while it waits, asked
// one at a time in the order they came.
import { create } from 'zustand';
import { say } from '@/lib/ui';
import { api, on, type Answer, type Question } from '@/services';

export interface JobRow {
  id: number;
  title: string;
  done: number;
  total: number;
  current: string;
  paused: boolean;
}

export interface Asked {
  /** Tells apart two questions of one job, so each gets a sheet of its own. */
  seq: number;
  id: number;
  question: Question;
}

export const useJobs = create<{ rows: JobRow[]; questions: Asked[] }>(() => ({ rows: [], questions: [] }));

// A job over in a moment never shows: it waits here until it has run this long.
const SHOW_AFTER = 450;
const waiting = new Map<number, { row: JobRow; timer: number }>();
let seq = 0;

function change(id: number, patch: Partial<JobRow>): void {
  const early = waiting.get(id);
  if (early) Object.assign(early.row, patch);
  else useJobs.setState((s) => ({ rows: s.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
}

let connected = false;

/** Starts listening to the jobs of the host; safe to call twice. */
export function connectJobs(): void {
  if (connected) return;
  connected = true;
  on('jobs.started', (d) => {
    const row: JobRow = { id: d.id, title: d.title, done: 0, total: 0, current: '', paused: false };
    const timer = window.setTimeout(() => {
      waiting.delete(d.id);
      useJobs.setState((s) => ({ rows: [...s.rows, row] }));
    }, SHOW_AFTER);
    waiting.set(d.id, { row, timer });
  });
  on('jobs.paused', (d) => change(d.id, { paused: d.paused }));
  on('jobs.progress', (d) => change(d.id, { done: d.done, total: d.total, current: d.current }));
  on('jobs.finished', (d) => {
    window.clearTimeout(waiting.get(d.id)?.timer);
    waiting.delete(d.id);
    // A question of a job that ended is no longer asked.
    useJobs.setState((s) => ({ rows: s.rows.filter((r) => r.id !== d.id), questions: s.questions.filter((q) => q.id !== d.id) }));
    if (!d.ok && 'error' in d && d.error) say(d.error);
  });
  on('jobs.ask', (d) => useJobs.setState((s) => ({ questions: [...s.questions, { seq: ++seq, id: d.id, question: d.question }] })));
}

/** Answers the question asked now, and asks the next. */
export function answer(value: Answer, applyAll = false): void {
  const asked = useJobs.getState().questions[0];
  if (!asked) return;
  useJobs.setState((s) => ({ questions: s.questions.slice(1) }));
  api.jobs.answer({ id: asked.id, answer: value, applyAll }).catch(say);
}
