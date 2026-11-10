// The hashes of the selected files (src-tauri/src/features/hash.rs), in a sheet: every algorithm for each file, a button
// to copy one, and a field to paste a hash into, which marks the one that matches.
import { registry } from '@/lib/registry';
import { HashSheet } from './HashSheet';
import { listen, startHash } from './store';

export function register(): void {
  listen();
  registry.sheets.register({ id: 'hash', Component: HashSheet });
  registry.actions.set('hash', (pane) => startHash(pane));
  registry.menu.add({
    id: 'hash',
    label: 'hashMenu',
    icon: 'number',
    group: 20,
    order: 5,
    when: (c) => c.count > 0 && c.entries.some((e) => e.kind === 'file'),
    run: (c) => startHash(c.pane),
  });
}
