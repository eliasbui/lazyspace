// The optional features, in the order of the old page's parts. Each exports `register()`, which plugs it into the registry
// (src/lib/registry.ts). The core (the panes, the sidebar, the toolbar) does not import any of them.
import { register as remote } from './remote';
import { register as office } from './office';
import { register as desktop } from './desktop';

export function registerFeatures(): void {
  remote();
  office();
  desktop();
}
