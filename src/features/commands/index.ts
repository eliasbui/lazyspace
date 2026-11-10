// Commands and shortcuts (the old page's parts/14-commands.js): the actions a dual-pane manager is known for, and the
// palette (Cmd+P, or Cmd+/ for the list of shortcuts) that lists every action with its keys and runs it.
import { openSheet, registry } from '@/lib/registry';
import { registerActions } from './actions';
import { Palette } from './Palette';

export function register(): void {
  registerActions();
  registry.sheets.register({ id: 'commands', Component: Palette });
  registry.actions.set('palette', () => openSheet('commands'));
}
