import { rpc } from '../client';

export const desktop = {
  enable: rpc('desktop.enable'),
  move: rpc('desktop.move'),
  place: rpc('desktop.place'),
  state: rpc('desktop.state'),
};
