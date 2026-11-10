import { rpc } from '../client';

export const jobs = {
  answer: rpc('jobs.answer'),
  cancel: rpc('jobs.cancel'),
  list: rpc('jobs.list'),
  pause: rpc('jobs.pause'),
};
