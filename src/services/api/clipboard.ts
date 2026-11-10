import { rpc } from '../client';

export const clipboard = {
  copy: rpc('clipboard.copy'),
  cut: rpc('clipboard.cut'),
  /** Moves what was copied instead of copying it when `move` is set, or when it was cut. */
  paste: rpc('clipboard.paste'),
  /** The URIs that were cut and are still on the clipboard. */
  state: rpc('clipboard.state'),
  text: rpc('clipboard.text'),
};
