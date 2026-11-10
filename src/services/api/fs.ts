import { rpc } from '../client';

export const fs = {
  complete: rpc('fs.complete'),
  /** `mode` "auto" moves on the same disk and copies to another, as a drop in Finder. It wins over `move`. */
  copy: rpc('fs.copy'),
  createFile: rpc('fs.create_file'),
  delete: rpc('fs.delete'),
  /** Starts listing into the tab `view`; the rows come with `view.changed`. `request` numbers this listing. */
  list: rpc('fs.list'),
  /** Without `name`, "untitled folder" (numbered when taken). Returns the new folder. */
  mkdir: rpc('fs.mkdir'),
  readText: rpc('fs.read_text'),
  rename: rpc('fs.rename'),
  sizes: rpc('fs.sizes'),
  stat: rpc('fs.stat'),
  subfolders: rpc('fs.subfolders'),
  trash: rpc('fs.trash'),
  undo: rpc('fs.undo'),
  /** The title of the step `fs.undo` would take back, or null. */
  undoTitle: rpc('fs.undo_title'),
  /** `mtime` is what `fs.read_text` gave; the write is refused when the file changed since. */
  writeText: rpc('fs.write_text'),
};
