import { rpc } from '../client';

export const viewer = {
  enable: rpc('viewer.enable'),
  reveal: rpc('viewer.reveal'),
  state: rpc('viewer.state'),
};
