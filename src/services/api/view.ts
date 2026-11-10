import { rpc } from '../client';

export const view = {
  close: rpc('view.close'),
  filter: rpc('view.filter'),
  find: rpc('view.find'),
  hidden: rpc('view.hidden'),
  indexOf: rpc('view.index_of'),
  /** Rejects with "stale" when `generation` is not the view's current one; at most 500 rows per call. */
  rows: rpc('view.rows'),
  sort: rpc('view.sort'),
};
