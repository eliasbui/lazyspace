import { rpc } from '../client';

export const menuedit = {
  get: rpc('menuedit.get'),
  set: rpc('menuedit.set'),
};
