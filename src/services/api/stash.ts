import { rpc } from '../client';

export const stash = {
  add: rpc('stash.add'),
  addClipboard: rpc('stash.add_clipboard'),
  /** One of `text`, `url`, or `base64` (a file of that content, named `name`). */
  addData: rpc('stash.add_data'),
  clear: rpc('stash.clear'),
  count: rpc('stash.count'),
  items: rpc('stash.items'),
  remove: rpc('stash.remove'),
  /** Shows or hides the shelf window; without `on` it toggles. */
  show: rpc('stash.show'),
};
