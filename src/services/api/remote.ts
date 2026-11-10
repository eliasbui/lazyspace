import { rpc } from '../client';

export const remote = {
  clouds: rpc('remote.clouds'),
  connect: rpc('remote.connect'),
  delete: rpc('remote.delete'),
  disconnect: rpc('remote.disconnect'),
  list: rpc('remote.list'),
  onedriveApp: rpc('remote.onedrive_app'),
  onedriveOpen: rpc('remote.onedrive_open'),
  /** `kept` is whether the Keychain took the password for good. */
  password: rpc('remote.password'),
  rcloneAdd: rpc('remote.rclone_add'),
  rcloneInstall: rpc('remote.rclone_install'),
  rcloneRemove: rpc('remote.rclone_remove'),
  /** `secret` null leaves the stored one, "" deletes it. */
  save: rpc('remote.save'),
  test: rpc('remote.test'),
  trust: rpc('remote.trust'),
};
