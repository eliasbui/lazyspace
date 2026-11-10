import { rpc } from '../client';

export const update = {
  check: rpc('update.check'),
  install: rpc('update.install'),
  relaunch: rpc('update.relaunch'),
};
