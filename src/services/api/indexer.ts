import { rpc } from '../client';

export const index = {
  rebuild: rpc('index.rebuild'),
  search: rpc('index.search'),
  state: rpc('index.state'),
};
