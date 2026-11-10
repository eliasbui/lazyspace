// The optional features, in the order of the old page's parts. Each exports `register()`, which plugs it into the registry
// (src/lib/registry.ts). The core (the panes, the sidebar, the toolbar) does not import any of them.
import { register as workspaces } from './workspaces';
import { register as keyboard } from './keyboard';
import { register as menuedit } from './menuedit';
import { register as appearance } from './appearance';
import { register as commands } from './commands';
import { register as finder } from './finder';
import { register as settings } from './settings';
import { register as explorer } from './explorer';
import { register as access } from './access';
import { register as remote } from './remote';
import { register as office } from './office';
import { register as desktop } from './desktop';

export function registerFeatures(): void {
  workspaces();
  keyboard();
  menuedit();
  appearance();
  commands();
  finder();
  settings();
  explorer();
  access();
  remote();
  office();
  desktop();
}
