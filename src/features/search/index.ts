// Search (src-tauri/src/features/search.rs, index.rs). The results are a place of their own (`search://<what>/<folder>`),
// the best match first, with a bar of filters over them: where, the kind, when it changed, how big, and whether the
// contents count. The search panel offers to search the pane's folder and every folder in it, the whole Mac, or the
// contents too, and lists the items of the quick index that match best, as fzf matches, to jump to.
//
// The toolbar's field (the chrome's) filters the pane as typed. Enter there searches the folder and every folder in it
// (search results are searched again with the new words), and the down arrow opens the panel with what is typed, for the
// other offers and the quick index. The actions `searchFolder`, `searchMac` and `searchContent` search for what the pane
// is filtered by; `search` opens the panel.
import { panes, type PaneHandle } from '@/lib/panes-api';
import { openSheet, registry } from '@/lib/registry';
import { FilterBar } from './FilterBar';
import { IndexSettings } from './IndexSettings';
import { runSearch, searchCrumbs, searchTitle, wordsOf } from './query';
import { SearchPanel } from './SearchPanel';

const openPanel = (pane: PaneHandle | null, text = wordsOf(pane)) => openSheet('search', { text });

/** Searches for what the pane is filtered by, or opens the panel when it is not filtered. */
const searchFiltered = (options: { mac?: boolean; content?: boolean }) => (pane: PaneHandle) =>
  pane.tab.filter.trim() ? runSearch(pane, pane.tab.filter, options) : openPanel(pane);

/** The keys of the toolbar's field that are the search's, taken before the field's own while it holds words. */
function fieldKeys(e: KeyboardEvent): void {
  const field = e.target;
  if (!(field instanceof HTMLInputElement) || field.type !== 'search' || !field.closest('[data-chrome]') || e.isComposing) return;
  const pane = panes.focused();
  if (!pane || !field.value.trim() || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Enter') runSearch(pane, field.value);
  else if (e.key === 'ArrowDown') openPanel(pane, field.value);
  else return;
  e.preventDefault();
  e.stopPropagation();
}

export function register(): void {
  registry.places.name('search', searchTitle);
  registry.places.crumbs('search', searchCrumbs);
  registry.pane.pathbar({ id: 'search', Component: FilterBar });
  registry.sheets.register({ id: 'search', Component: SearchPanel });
  registry.settings.section({ id: 'search', title: 'searchTitle', order: 60, Component: IndexSettings });

  registry.actions.set('search', (pane) => openPanel(pane));
  registry.actions.set('searchFolder', searchFiltered({}));
  registry.actions.set('searchMac', searchFiltered({ mac: true }));
  registry.actions.set('searchContent', searchFiltered({ content: true }));
  registry.keys.add({ 'Cmd+Shift+F': 'search' }, 'mac');
  registry.keys.add({ 'Ctrl+Shift+F': 'search' }, 'windows');
  document.addEventListener('keydown', fieldKeys, true);
}
