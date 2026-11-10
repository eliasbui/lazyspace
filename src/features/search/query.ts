// The place of search results (`search://<what>/<folder>`) as the panes name it, and how a search is started from a pane.
import { t } from '@/i18n';
import { useApp } from '@/lib/app-state';
import type { PaneHandle } from '@/lib/panes-api';
import type { Crumb } from '@/lib/registry';
import { isSearch, searchFolder, searchQuery, searchUri, type SearchQuery } from '@/lib/search-uri';
import { tagLabel } from '@/lib/tags';
import { fileUri, isLocal, nameOf, pathOf } from '@/lib/uri';

const homePath = (): string | null => {
  const home = useApp.getState().places?.home;
  return home ? pathOf(home) : null;
};

export function searchTitle(uri: string): string {
  const q = searchQuery(uri);
  if (q.recent === '1') return t('recents');
  if (!q.q && q.tag) return tagLabel(q.tag);
  return t('searchFor', q.q ?? '');
}

/** The folder a search looks in, then the search itself; a search of a tag or of the recent items has only itself. */
export function searchCrumbs(uri: string): Crumb[] {
  const q = searchQuery(uri);
  const folder = searchFolder(uri);
  const crumbs: Crumb[] = [];
  if (q.q) crumbs.push(folder === '/' ? [fileUri('/'), t('thisMac'), 'path:/'] : [fileUri(folder), nameOf(fileUri(folder)), `path:${folder}`]);
  crumbs.push([uri, searchTitle(uri), null]);
  return crumbs;
}

export const folderName = (folder: string): string => (folder === '/' ? t('thisMac') : nameOf(fileUri(folder)));

/** A folder of this Mac as a list of places writes it: from the home folder (~), else the whole path. */
export function placeLabel(path: string): string {
  const home = homePath();
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

/** Where a search from the pane looks: its folder on this Mac, the folder of the search it shows, or the home. */
export function scopeOf(pane: PaneHandle): string {
  const uri = pane.tab.uri;
  if (isSearch(uri)) return searchQuery(uri).from || searchFolder(uri);
  return isLocal(uri) ? pathOf(uri) : (homePath() ?? '/');
}

/** Searches the pane's folder and every folder in it (or the whole Mac) for `text`, keeping the filters of a search the
 *  pane shows; searching again from search results does not add to the Back stack. */
export function runSearch(pane: PaneHandle, text: string, { mac = false, content = false } = {}): void {
  const words = text.trim();
  if (!words) return;
  const folder = scopeOf(pane);
  const before: SearchQuery = isSearch(pane.tab.uri) ? searchQuery(pane.tab.uri) : {};
  const q: SearchQuery = { ...before, q: words, content: content || before.content ? '1' : '', recent: '', tag: '', from: mac ? folder : '' };
  pane.navigate(searchUri(q, mac ? '/' : folder), { history: !isSearch(pane.tab.uri) });
  pane.focusList();
}

/** The words a pane is filtered or searched by, to start the panel with. */
export function wordsOf(pane: PaneHandle | null): string {
  if (!pane) return '';
  return isSearch(pane.tab.uri) ? (searchQuery(pane.tab.uri).q ?? '') : pane.tab.filter;
}
