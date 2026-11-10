import { rpc } from '../client';

export const sync = {
  apply: rpc('sync.apply'),
  compare: rpc('sync.compare'),
};
