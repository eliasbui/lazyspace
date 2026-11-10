// Search results are a place of their own (src-tauri/src/features/search.rs): `search://<query>/<folder>`, `/` for the
// whole Mac. The query is `key=value` pairs, each value encoded, and the whole of it encoded once more as the authority.
import { authorityOf, encodePath, pathOf, schemeOf } from './uri';

/** What a search asks for. `content`, `recent` are "1" or empty; `from` (the page's own) is the folder a search of the
 *  whole Mac was started from. */
export interface SearchQuery {
  q?: string;
  kind?: string;
  date?: string;
  size?: string;
  content?: string;
  tag?: string;
  recent?: string;
  from?: string;
}

export const isSearch = (uri: string | null | undefined): boolean => schemeOf(uri) === 'search';

export const searchQuery = (uri: string): SearchQuery => Object.fromEntries(new URLSearchParams(authorityOf(uri)));

/** The folder a search looks in, as a path; `/` is the whole Mac. */
export const searchFolder = (uri: string): string => pathOf(uri);

export function searchUri(query: SearchQuery, folder: string): string {
  const text = Object.entries(query)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `search://${encodeURIComponent(text)}${encodePath(folder || '/')}`;
}
