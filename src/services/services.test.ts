import { describe, expect, it } from 'vitest';
import type { Events, Methods, Row } from './protocol';
import { createMockHost } from './mock';

// Tests of the mock host through the same door as the page: request and subscribe.

function connect(search = '') {
  const host = createMockHost(search);
  const seen: Array<{ event: string; data: unknown }> = [];
  host.subscribe((event, data) => seen.push({ event, data }));

  const call = <M extends keyof Methods>(method: M, args: Methods[M]['args']): Promise<Methods[M]['result']> =>
    host.request(method, args) as Promise<Methods[M]['result']>;

  /** Waits for the event, which may already have come. */
  const next = async <E extends keyof Events>(event: E): Promise<Events[E]> => {
    for (let i = 0; i < 200; i++) {
      const found = seen.find((s) => s.event === event);
      if (found) {
        seen.splice(seen.indexOf(found), 1);
        return found.data as Events[E];
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`no ${event}`);
  };
  return { call, next };
}

const HOME = 'file:///Users/demo';

describe('the mock host', () => {
  it('lists a folder and gives the window of rows asked for, and refuses a stale generation', async () => {
    const { call, next } = connect();
    await call('fs.list', { view: 't1', uri: `${HOME}/Documents/Work` });
    const changed = await next('view.changed');
    expect(changed.view).toBe('t1');
    expect(changed.count).toBeGreaterThan(10);

    const window = await call('view.rows', { view: 't1', start: 2, count: 5, generation: changed.generation });
    expect(window.rows).toHaveLength(5);
    expect(window.start).toBe(2);

    const all = await call('view.rows', { view: 't1', start: 0, count: 500, generation: changed.generation });
    expect(all.rows.slice(2, 7).map((r: Row) => r.name)).toEqual(window.rows.map((r: Row) => r.name));
    // Natural order: "Report 2" comes before "Report 10".
    const names = all.rows.map((r: Row) => r.name);
    expect(names.indexOf('Report 2.pdf')).toBeLessThan(names.indexOf('Report 10.pdf'));

    await expect(call('view.rows', { view: 't1', start: 0, count: 5, generation: changed.generation + 1 })).rejects.toThrow('stale');
  });

  it('reports 100000 items for the big folder and answers a window of rows without storing them', async () => {
    const { call, next } = connect();
    await call('fs.list', { view: 'big', uri: `${HOME}/Big` });
    const changed = await next('view.changed');
    expect(changed.count).toBe(100_000);

    const middle = await call('view.rows', { view: 'big', start: 54_321, count: 30, generation: changed.generation });
    expect(middle.rows).toHaveLength(30);
    expect(middle.rows[0]?.name).toBe('Item 054282.jpg');

    expect(await call('view.index_of', { view: 'big', name: 'Album 0003' })).toEqual({ index: 2 });

    const sorted = await call('view.sort', { view: 'big', sort: { by: 'name', desc: true, foldersFirst: false, group: '' } });
    const last = await call('view.rows', { view: 'big', start: 0, count: 1, generation: sorted.generation });
    expect(last.rows[0]?.name).toBe('Item 099960.mov');

    const filtered = await call('view.filter', { view: 'big', text: 'Item 000007' });
    expect(filtered.count).toBe(1);
    expect(await call('view.index_of', { view: 'big', name: 'Album 0003' })).toEqual({ index: null });
  });

  it('merges a settings patch, refuses what the host refuses, and tells every window with settings.changed', async () => {
    const { call, next } = connect('?lang=en&theme=dark');
    const before = await call('settings.get', undefined);
    expect(before.language).toBe('en');
    expect(before.theme).toBe('dark');

    const after = await call('settings.set', { patch: { sort: { desc: true }, show_hidden: true } });
    expect(after.sort).toEqual({ by: 'name', desc: true, foldersFirst: true, group: '' });
    expect(after.show_hidden).toBe(true);
    const changed = await next('settings.changed');
    expect(changed.show_hidden).toBe(true);

    await expect(call('settings.set', { patch: { theme: 'sepia' as 'dark' } })).rejects.toThrow();
    await expect(call('settings.set', { patch: { sidebar_hidden: [] } as never })).rejects.toThrow('no key');
  });

  it('says hello after app.ready with what the query asks for', async () => {
    const { call, next } = connect('?role=shelf&folder=/Users/demo/Pictures&glass=1');
    await call('app.ready', undefined);
    const hello = await next('app.hello');
    expect(hello.windowRole).toBe('shelf');
    expect(hello.uri).toBe(`${HOME}/Pictures`);
    expect(hello.settings.glass).toBe(true);
    expect(hello.features).toEqual([]);
  });

  it('copies as a job with progress and a finish, and the folder lists again', async () => {
    const { call, next } = connect();
    await call('fs.list', { view: 'a', uri: `${HOME}/Desktop` });
    await next('view.changed');
    const { job } = await call('fs.copy', { from: [`${HOME}/Documents/Resume.pdf`], to: `${HOME}/Desktop`, mode: 'copy' });
    expect((await next('jobs.started')).id).toBe(job);
    await next('jobs.progress');
    const finished = await next('jobs.finished');
    expect(finished).toMatchObject({ id: job, ok: true });
    const changed = await next('view.changed');
    expect(changed.view).toBe('a');
  });
});
