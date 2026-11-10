import { rpc } from '../client';

export const git = {
  status: rpc('git.status'),
};
