import { describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (data: unknown) => void>();
const sent = vi.fn((_args: unknown) => Promise.resolve(null));

vi.mock('@/services', () => ({
  on: (event: string, handler: (data: unknown) => void) => {
    handlers.set(event, handler);
    return () => undefined;
  },
  api: { jobs: { answer: (args: unknown) => sent(args) } },
}));
vi.mock('@/lib/ui', () => ({ say: vi.fn() }));

const { answer, connectJobs, useJobs } = await import('./store');
const fire = (event: string, data: unknown) => handlers.get(event)?.(data);

describe('jobs', () => {
  connectJobs();

  it('shows a job only once it has run for a moment, with the progress it made meanwhile', () => {
    vi.useFakeTimers();
    fire('jobs.started', { id: 5, kind: 'copy', title: 'Copying' });
    fire('jobs.progress', { id: 5, done: 1, total: 4, current: 'a.txt' });
    expect(useJobs.getState().rows).toEqual([]);
    vi.advanceTimersByTime(450);
    expect(useJobs.getState().rows[0]).toMatchObject({ id: 5, done: 1, total: 4, current: 'a.txt', paused: false });
    fire('jobs.paused', { id: 5, paused: true });
    expect(useJobs.getState().rows[0]?.paused).toBe(true);
    fire('jobs.finished', { id: 5, ok: true, data: null });
    expect(useJobs.getState().rows).toEqual([]);
    vi.useRealTimers();
  });

  it('asks one question at a time and drops those of a job that ended', () => {
    const question = { type: 'confirm', text: 'Sure?' };
    fire('jobs.ask', { id: 1, question });
    fire('jobs.ask', { id: 2, question });
    fire('jobs.ask', { id: 1, question });
    fire('jobs.finished', { id: 1, ok: false, cancelled: true });
    expect(useJobs.getState().questions.map((q) => q.id)).toEqual([2]);
    answer('yes', true);
    expect(sent).toHaveBeenCalledWith({ id: 2, answer: 'yes', applyAll: true });
    expect(useJobs.getState().questions).toEqual([]);
  });
});
