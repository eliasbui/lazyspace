import { rpc } from '../client';

export const settings = {
  /** The chosen folder as a path, or null when the picker was cancelled. */
  chooseFolder: rpc('settings.choose_folder'),
  get: rpc('settings.get'),
  set: rpc('settings.set'),
};
