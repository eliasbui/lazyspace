import { rpc } from '../client';

export const disk = {
  map: rpc('disk.map'),
  twins: rpc('disk.twins'),
};
