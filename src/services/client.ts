import { getHost } from './host';
import type { EventName, Events, MethodName, Methods } from './protocol';

// No second parameter when a method takes none, an optional one when every field is optional.
type CallArgs<A> = [A] extends [void] ? [] : Record<never, never> extends A ? [args?: A] : [args: A];

/** Calls a method of the host. Rejects with an Error whose message is the host's text; `view.rows` says "stale". */
export function call<M extends MethodName>(method: M, ...args: CallArgs<Methods[M]['args']>): Promise<Methods[M]['result']> {
  // The host answers with what the table in protocol.ts says; nothing at runtime checks it.
  return getHost().request(method, args[0] ?? {}) as Promise<Methods[M]['result']>;
}

/** A function for one method, for the wrappers in api/: `rpc('fs.list')(args)`. */
export function rpc<M extends MethodName>(method: M) {
  return (...args: CallArgs<Methods[M]['args']>): Promise<Methods[M]['result']> => call(method, ...args);
}

/** Listens to one event. Returns the function that stops listening. */
export function on<E extends EventName>(event: E, handler: (data: Events[E]) => void): () => void {
  return getHost().subscribe((name, data) => {
    // The host sends the payload each event's entry in protocol.ts describes.
    if (name === event) handler(data as Events[E]);
  });
}

/** Listens to every event, also those protocol.ts does not know. For logging. */
export function onAny(handler: (event: string, data: unknown) => void): () => void {
  return getHost().subscribe(handler);
}

/** The text of an error from `call`, or of anything thrown. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
