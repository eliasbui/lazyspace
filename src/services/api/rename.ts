import { rpc } from '../client';

export const rename = {
  apply: rpc('rename.apply'),
  preview: rpc('rename.preview'),
};
