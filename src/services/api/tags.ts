import { rpc } from '../client';

export const tags = {
  /** `colour` 1 to 7. */
  set: rpc('tags.set'),
};
