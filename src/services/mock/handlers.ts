import type { MethodName, Methods } from '../protocol';
import type { MockState } from './state';

/** One function per method of the protocol: the table of handlers is complete when it compiles. */
export type Handlers = {
  [M in MethodName]: (args: Methods[M]['args'], s: MockState) => Methods[M]['result'] | Promise<Methods[M]['result']>;
};
