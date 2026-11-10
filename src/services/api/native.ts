import { rpc } from '../client';

export const native = {
  appsFor: rpc('native.apps_for'),
  eject: rpc('native.eject'),
  fonts: rpc('native.fonts'),
  fullDisk: rpc('native.full_disk'),
  getInfo: rpc('native.get_info'),
  home: rpc('native.home'),
  officeApps: rpc('native.office_apps'),
  open: rpc('native.open'),
  openFullDisk: rpc('native.open_full_disk'),
  openWith: rpc('native.open_with'),
  /** Shows the items in Quick Look, or hides the panel when it is open. With no targets it only hides. */
  quicklook: rpc('native.quicklook'),
  reveal: rpc('native.reveal'),
  share: rpc('native.share'),
  volumes: rpc('native.volumes'),
};
