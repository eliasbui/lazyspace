import { rpc } from '../client';

export const devices = {
  install: rpc('devices.install'),
  openApp: rpc('devices.open_app'),
  phones: rpc('devices.phones'),
};
