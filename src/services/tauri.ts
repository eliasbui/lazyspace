import { invoke } from '@tauri-apps/api/core';
import type { Host } from './host';

// The Rust side answers and sends events by evaluating `window.app && app.receive(<json>)` in the page.
declare global {
  interface Window {
    app?: { receive(message: unknown): void };
  }
}

interface Pending {
  resolve(data: unknown): void;
  reject(error: Error): void;
}

type Handler = (event: string, data: unknown) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The real host. `ipc` answers later, as a message with the request's id, not as the result of the command. */
export function createTauriHost(): Host {
  const pending = new Map<number, Pending>();
  const handlers = new Set<Handler>();
  let next = 0;

  const receive = (message: unknown): void => {
    if (!isRecord(message)) return;
    if (typeof message.id === 'number') {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok === true) request.resolve(message.data ?? null);
      else request.reject(new Error(typeof message.error === 'string' ? message.error : 'Unknown error'));
    } else if (typeof message.event === 'string') {
      for (const handler of [...handlers]) handler(message.event, message.data ?? null);
    }
  };
  window.app = { receive };

  return {
    native: true,
    request(method, args) {
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        invoke('ipc', { body: JSON.stringify({ id, method, args }) }).catch((error: unknown) => {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
