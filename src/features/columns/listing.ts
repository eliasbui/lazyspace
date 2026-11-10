// The rows the views draw. A column of a folder other than the tab's is a listing of its own, listed while the column
// shows it and listed again by Rust when the folder changes; the tab's own rows are asked for by range, as the list does.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/app-state';
import type { TabView } from '@/lib/panes-api';
import { api, on, type Row, type Uri, type ViewSort } from '@/services';

/** The most rows a column of its own shows. */
export const LIMIT = 2000;

/** The rows of the columns shown now, by place, for `columnIn` to go to the first item of the next one. */
export const shownRows = new Map<Uri, Row[]>();

export interface Listing {
  /** Null until the listing is in. */
  rows: Row[] | null;
  count: number;
}

let seq = 0;

export function useListing(uri: Uri, sort: ViewSort, showHidden: boolean): Listing {
  const windowId = useApp((s) => s.windowId);
  const [state, setState] = useState<Listing & { uri: Uri }>({ uri, rows: null, count: 0 });
  const sortKey = `${sort.by}|${sort.desc}|${sort.foldersFirst}`;

  useEffect(() => {
    const view = `w${windowId}col${++seq}`;
    let live = true;
    const give = (rows: Row[], count: number) => {
      if (!live) return;
      shownRows.set(uri, rows);
      setState({ uri, rows, count });
    };
    const offChanged = on('view.changed', (d) => {
      if (d.view !== view) return;
      void (async () => {
        const rows: Row[] = [];
        for (let start = 0; start < Math.min(d.count, LIMIT); start += 500) {
          const got = await api.view.rows({ view, start, count: 500, generation: d.generation }).catch(() => null);
          if (!got) return;
          rows.push(...got.rows);
        }
        give(rows, d.count);
      })();
    });
    const offError = on('view.error', (d) => d.view === view && give([], 0));
    api.fs.list({ view, uri, sort, showHidden }).catch(() => give([], 0));
    return () => {
      live = false;
      offChanged();
      offError();
      shownRows.delete(uri);
      api.view.close({ view }).catch(() => undefined);
    };
    // `sort` is read through `sortKey`, which changes with it.
  }, [uri, windowId, sortKey, showHidden]);

  return state.uri === uri ? state : { rows: null, count: 0 };
}

/**
 * The tab's rows from `first` to `last`: those the panes have, and those asked for here, a little beyond, 500 at most at
 * a time. Returns the row at an index, or null while it is on its way.
 */
export function useTabRows(tab: TabView, first: number, last: number): (index: number) => Row | null {
  const key = `${tab.id}|${tab.generation}`;
  const cache = useRef<{ key: string; rows: Map<number, Row> }>({ key, rows: new Map() });
  if (cache.current.key !== key) cache.current = { key, rows: new Map() };
  const [, setGot] = useState(0);
  const rows = cache.current.rows;
  const rowAt = (i: number): Row | null => tab.rowAt(i) ?? rows.get(i) ?? null;

  let missing = -1;
  if (tab.generation) {
    for (let i = Math.max(0, first); i < Math.min(last, tab.count); i++) {
      if (!rowAt(i)) {
        missing = i;
        break;
      }
    }
  }
  const view = tab.id;
  const generation = tab.generation;
  useEffect(() => {
    if (missing < 0) return;
    let live = true;
    const from = Math.max(0, missing - 30);
    const count = Math.min(500, last - from + 60);
    api.view.rows({ view, start: from, count, generation }).then(
      (d) => {
        if (!live || cache.current.key !== key) return;
        d.rows.forEach((row, k) => cache.current.rows.set(from + k, row));
        setGot((n) => n + 1);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [key, view, generation, missing, last]);

  return rowAt;
}
