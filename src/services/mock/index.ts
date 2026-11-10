import type { Host } from '../host';
import { browseHandlers } from './browse';
import { coreHandlers } from './core';
import type { Handlers } from './handlers';
import { MockState } from './state';
import { toolsHandlers } from './tools';
import { setLanguage, sleep, tr } from './util';

// A host that answers all of the protocol from memory, for a page opened in a browser or photographed.
//
// The query of the page drives it: ?lang=vi|en  ?theme=light|dark  ?role=main|desktop|shelf  ?glass=1  ?update=1
// ?folder=<path>.

// Compile-time proof that every method has a handler.
const handlers: Handlers = { ...coreHandlers, ...browseHandlers, ...toolsHandlers };
const table: Record<string, (args: never, s: MockState) => unknown> = handlers;

function applyQuery(s: MockState, search: string): void {
  const query = new URLSearchParams(search);
  const lang = query.get('lang');
  if (lang === 'vi' || lang === 'en') s.settings.language = lang;
  const theme = query.get('theme');
  if (theme === 'light' || theme === 'dark') {
    s.settings.theme = theme;
    s.systemTheme = theme;
  } else if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) {
    s.systemTheme = 'dark';
  }
  s.settings.glass = query.get('glass') === '1';
  const role = query.get('role');
  if (role === 'main' || role === 'desktop' || role === 'shelf') s.windowRole = role;
  s.updateAvailable = query.get('update') === '1';
  const folder = query.get('folder');
  if (folder?.startsWith('/')) s.folder = folder;
  setLanguage(s.settings.language);
}

export function createMockHost(search = globalThis.location?.search ?? ''): Host {
  const s = new MockState();
  applyQuery(s, search);
  return {
    native: false,
    async request(method, args) {
      await sleep(2);
      const handler = table[method];
      if (!handler) throw new Error(`${tr('Lệnh không rõ', 'Unknown command')}: ${method}`);
      // A copy, as the answer of the host is: the page cannot change what the mock keeps.
      return structuredClone(await handler(args as never, s));
    },
    subscribe(handler) {
      const listener = (event: string, data: unknown): void => handler(event, structuredClone(data));
      s.listeners.add(listener);
      return () => s.listeners.delete(listener);
    },
  };
}
