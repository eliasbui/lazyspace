import { rpc } from '../client';

export const preview = {
  /** Answers at once with null; the info arrives as the `preview.ready` event. */
  info: rpc('preview.info'),
};
