import { rpc } from '../client';

export const openin = {
  add: rpc('openin.add'),
  /** Either `tool` (an id) or `kind` (the default tool of that kind). */
  open: rpc('openin.open'),
  tools: rpc('openin.tools'),
};
