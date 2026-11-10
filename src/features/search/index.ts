// Search (src-tauri/src/features/search.rs, index.rs). The results are a place of their own (`search://<what>/<folder>`),
// the best match first, with a bar of filters over them: where, the kind, when it changed, how big, and whether the
// contents count. The search panel offers to search the pane's folder and every folder in it, the whole Mac, or the
// contents too, and lists the items of the quick index that match best, as fzf matches, to jump to.
//
// The toolbar's field filters the pane as typed and keeps what is typed as the tab's `filter`; the actions
// `searchFolder`, `searchMac` and `searchContent` search for it (Enter in the field), `search` opens the panel with it.
import { openSheet, registry } from '@/lib/registry';
import type { PaneHandle } from '@/lib/panes-api';
import { FilterBar } from './FilterBar';
import { IndexSettings } from './IndexSettings';
import { runSearch, searchCrumbs, searchTitle, wordsOf } from './query';
import { SearchPanel } from './SearchPanel';

const openPanel = (pane: PaneHandle | null) => openSheet('search', { text: wordsOf(pane) });

/** Searches for what the pane is filtered by, or opens the panel when it is not filtered. */
const searchFiltered = (options: { mac?: boolean; content?: boolean }) => (pane: PaneHandle) =>
  pane.tab.filter.trim() ? runSearch(pane, pane.tab.filter, options) : openPanel(pane);

export function register(): void {
  registry.places.name('search', searchTitle);
  registry.places.crumbs('search', searchCrumbs);
  registry.pane.pathbar({ id: 'search', Component: FilterBar });
  registry.sheets.register({ id: 'search', Component: SearchPanel });
  registry.settings.section({ id: 'search', title: 'searchTitle', order: 60, Component: IndexSettings });

  registry.actions.set('search', openPanel);
  registry.actions.set('searchFolder', searchFiltered({}));
  registry.actions.set('searchMac', searchFiltered({ mac: true }));
  registry.actions.set('searchContent', searchFiltered({ content: true }));
  registry.keys.add({ 'Cmd+Shift+F': 'search' }, 'mac');
  registry.keys.add({ 'Ctrl+Shift+F': 'search' }, 'windows');
}
