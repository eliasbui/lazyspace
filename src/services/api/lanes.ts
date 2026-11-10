import { rpc } from '../client';

export const lanes = {
  available: rpc('lanes.available'),
  send: rpc('lanes.send'),
};
