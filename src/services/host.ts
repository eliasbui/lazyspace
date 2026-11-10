import { createTauriHost } from './tauri';

/** The way requests leave the page and events come in: Tauri in the app, an in-memory mock in a browser. */
export interface Host {
  /** True when the host is the real app. */
  readonly native: boolean;
  /** Rejects with an Error whose message is the host's error string. */
  request(method: string, args: unknown): Promise<unknown>;
  /** Returns the function that stops the subscription. */
  subscribe(handler: (event: string, data: unknown) => void): () => void;
}

let host: Host | undefined;

/** The one host of the page. React StrictMode runs effects twice, so connecting must not repeat. */
export function getHost(): Host {
  host ??= isNative() ? createTauriHost() : createLazyMockHost();
  return host;
}

function isNative(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// The mock is a chunk of its own, loaded on the first use, so the app never carries it.
function createLazyMockHost(): Host {
  const handlers = new Set<(event: string, data: unknown) => void>();
  const loaded = import('./mock').then(({ createMockHost }) => {
    const mock = createMockHost();
    mock.subscribe((event, data) => {
      for (const handler of [...handlers]) handler(event, data);
    });
    return mock;
  });
  return {
    native: false,
    request: async (method, args) => (await loaded).request(method, args),
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
