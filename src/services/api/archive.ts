import { rpc } from '../client';

export const archive = {
  create: rpc('archive.create'),
  extract: rpc('archive.extract'),
  password: rpc('archive.password'),
};
