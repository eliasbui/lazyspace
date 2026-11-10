import { rpc } from '../client';

export const history = {
  add: rpc('history.add'),
  clear: rpc('history.clear'),
  list: rpc('history.list'),
  remove: rpc('history.remove'),
};
