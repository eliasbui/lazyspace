import { rpc } from '../client';

export const templates = {
  add: rpc('templates.add'),
  /** Makes "Untitled.<ext>" in the folder `uri`. */
  create: rpc('templates.create'),
  folder: rpc('templates.folder'),
  list: rpc('templates.list'),
};
