// A column of a folder other than the tab's is a listing of its own, listed while the column shows it and listed again
// by Rust when the folder changes. (The tab's own rows are the pane's, loaded with `ensure`.)
import { useEffect, useState } from 'react';
import { useApp } from '@/lib/app-state';
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
