// Git in the list (src-tauri/src/features/git.rs): in a folder of a repository each item changed shows a letter after its
// name, as the editors show them (M changed, A added, D gone, R renamed, U new, C in conflict), and the branch shows at the
// end of the path bar. It is asked again whenever the listing of the tab a pane shows changes.
import { panes } from '@/lib/panes-api';
import { registry } from '@/lib/registry';
import { on } from '@/services';
import { BranchPill } from './BranchPill';
import { ask } from './store';

export function register(): void {
  registry.pane.pathbar({ id: 'git', Component: BranchPill });
  on('view.changed', (d) => {
    const found = panes.findTab(d.view);
    if (found && found.pane.tab.id === found.tab.id) ask(d.view, found.tab.uri);
  });
}
