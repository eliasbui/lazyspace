import { rpc } from '../client';

export const drag = {
  arm: rpc('drag.arm'),
  disarm: rpc('drag.disarm'),
};
