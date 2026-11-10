import type { Answer, Events, JobInfo, JobKind, JobResults, Question } from '../protocol';
import { errorText, sleep, tr } from './util';

export type Emit = <E extends keyof Events>(event: E, data: Events[E]) => void;

/** What the work of a job holds: its progress, its questions, and the user's cancel. */
export interface JobContext {
  readonly id: number;
  cancelled(): boolean;
  /** Reports how far the job is and lets a moment pass, so a fake job can be watched. */
  progress(done: number, total: number, current: string, pause?: number): Promise<void>;
  /** Asks the page and waits for the answer; an answer given for all is kept for the kind of question. */
  ask(question: Question): Promise<Answer>;
  emit: Emit;
}

interface Handle {
  kind: JobKind;
  title: string;
  cancelled: boolean;
  paused: boolean;
  waiting?: (answer: [Answer, boolean]) => void;
  remembered: Map<string, Answer>;
}

export class Jobs {
  private next = 0;
  private readonly running = new Map<number, Handle>();

  constructor(private readonly emit: Emit) {}

  /** Starts `work` and tells the page; it always ends with `jobs.finished`. Returns the job's id. */
  spawn<K extends JobKind>(kind: K, title: string, work: (ctx: JobContext) => Promise<JobResults[K]>): number {
    const id = ++this.next;
    const handle: Handle = { kind, title, cancelled: false, paused: false, remembered: new Map() };
    this.running.set(id, handle);
    this.emit('jobs.started', { id, kind, title });
    const ctx: JobContext = {
      id,
      emit: this.emit,
      cancelled: () => handle.cancelled,
      progress: async (done, total, current, pause = 70) => {
        while (handle.paused && !handle.cancelled) await sleep(50);
        this.emit('jobs.progress', { id, done, total, current });
        await sleep(pause);
      },
      ask: async (question) => {
        const kind = question.type === 'conflict' && question.folder ? 'conflict-folder' : question.type;
        const kept = handle.remembered.get(kind);
        if (kept) return kept;
        this.emit('jobs.ask', { id, question });
        const [answer, all] = await new Promise<[Answer, boolean]>((resolve) => {
          handle.waiting = resolve;
        });
        if (all) handle.remembered.set(kind, answer);
        return handle.cancelled ? 'stop' : answer;
      },
    };
    setTimeout(() => {
      work(ctx).then(
        (data) => this.finish(id, handle, { id, ok: true, data }),
        (error: unknown) => {
          const message = errorText(error);
          if (handle.cancelled || message === 'cancelled') this.finish(id, handle, { id, ok: false, cancelled: true });
          else this.finish(id, handle, { id, ok: false, error: message });
        },
      );
    }, 0);
    return id;
  }

  private finish(id: number, handle: Handle, result: Events['jobs.finished']): void {
    this.running.delete(id);
    handle.waiting = undefined;
    this.emit('jobs.finished', result);
  }

  private get(id: number): Handle {
    const handle = this.running.get(id);
    if (!handle) throw new Error(tr('Việc này đã xong', 'That job is over'));
    return handle;
  }

  cancel(id: number): void {
    const handle = this.get(id);
    handle.cancelled = true;
    handle.waiting?.(['stop', false]);
  }

  pause(id: number, paused: boolean): void {
    this.get(id).paused = paused;
    this.emit('jobs.paused', { id, paused });
  }

  answer(id: number, answer: Answer, all: boolean): void {
    const handle = this.get(id);
    if (!handle.waiting) throw new Error(tr('Việc này đã xong', 'That job is over'));
    handle.waiting([answer, all]);
    handle.waiting = undefined;
  }

  list(): JobInfo[] {
    return [...this.running].map(([id, h]) => ({ id, kind: h.kind, title: h.title }));
  }
}
