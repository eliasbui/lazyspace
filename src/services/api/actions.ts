import { rpc } from '../client';

export const actions = {
  list: rpc('actions.list'),
  /** A job, or null when the output goes to Terminal. */
  run: rpc('actions.run'),
  save: rpc('actions.save'),
};
