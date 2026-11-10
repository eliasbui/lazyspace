import { rpc } from '../client';

export const menu = {
  /** The choice comes back as `menu.chosen`, or `menu.closed` when nothing was chosen. */
  show: rpc('menu.show'),
};
