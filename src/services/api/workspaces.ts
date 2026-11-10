import { rpc } from '../client';

export const workspaces = {
  delete: rpc('workspaces.delete'),
  list: rpc('workspaces.list'),
  rename: rpc('workspaces.rename'),
  save: rpc('workspaces.save'),
};
