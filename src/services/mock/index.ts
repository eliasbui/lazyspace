import type { Host } from '../host';

// Replaced by the full mock in the next commit.
export function createMockHost(): Host {
  return {
    native: false,
    request: () => Promise.reject(new Error('The mock is not built yet')),
    subscribe: () => () => undefined,
  };
}
