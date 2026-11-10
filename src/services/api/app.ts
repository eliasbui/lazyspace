import { rpc } from '../client';

export const app = {
  drag: rpc('app.drag'),
  drawn: rpc('app.drawn'),
  log: rpc('app.log'),
  newWindow: rpc('app.new_window'),
  openUrl: rpc('app.open_url'),
  ready: rpc('app.ready'),
  zoom: rpc('app.zoom'),
};
