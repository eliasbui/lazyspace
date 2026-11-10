// Places as the panes write them: the label of a place in a list of places, the crumbs of the path bar, the pictures
// of an item.
import { useApp } from '@/lib/app-state';
import { registry, type Crumb } from '@/lib/registry';
import { archiveUri, fileUri, isLocal, pathOf, schemeOf, withPath } from '@/lib/uri';
import { iconUrl, pixelRatio, thumbUrl, type Entry, type Uri } from '@/services';

const homePath = (): string | null => {
  const home = useApp.getState().places?.home;
  return home ? pathOf(home) : null;
};

/** A place as a list of places writes it: the path from the home folder (~) on this Mac, the place and the path elsewhere. */
export function placeLabel(uri: Uri): string {
  const path = pathOf(uri);
  if (!isLocal(uri)) return path === '/' ? registry.places.nameOf(uri) : `${registry.places.nameOf(withPath(uri, '/'))}: ${path}`;
  const home = homePath();
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

/** The name of the folder of `uri` that `here` came out of, to select it there (going up selects where you were). */
export function childOf(here: Uri, uri: Uri): string[] | null {
  const from = pathOf(here);
  const there = pathOf(uri).replace(/\/$/, '');
  if (!from.startsWith(`${there}/`)) return null;
  const name = from.slice(there.length + 1).split('/')[0];
  return name ? [name] : null;
}

/**
 * The crumbs of the path bar, from the top down: a place of a feature has its own; a place on this Mac starts at the
 * home folder or the disk, and an archive goes on with the folders inside it.
 */
export function crumbsOf(uri: Uri): Crumb[] {
  const own = registry.places.crumbsOf(uri);
  if (own) return own;
  const scheme = schemeOf(uri);
  if (scheme !== 'file' && scheme !== 'archive') {
    // A place no feature names: its root, then a crumb for each folder of its path.
    const out: Crumb[] = [[withPath(uri, '/'), registry.places.nameOf(withPath(uri, '/')), null]];
    let at = '';
    for (const part of pathOf(uri).split('/').filter(Boolean)) out.push([withPath(uri, (at = `${at}/${part}`)), part, null]);
    return out;
  }
  const full = pathOf(uri);
  const cut = scheme === 'archive' ? full.indexOf('!') : -1;
  const path = cut >= 0 ? full.slice(0, cut) : full;
  const home = homePath();
  const homeUri = useApp.getState().places?.home;
  const parts: Array<[path: string, name: string, first: boolean]> = [];
  if (home && homeUri && (path === home || path.startsWith(`${home}/`))) {
    parts.push([home, registry.places.nameOf(homeUri), true]);
    let at = home;
    for (const part of path.slice(home.length).split('/').filter(Boolean)) parts.push([(at = `${at}/${part}`), part, false]);
  } else {
    parts.push(['/', 'Macintosh HD', true]);
    let at = '';
    for (const part of path.split('/').filter(Boolean)) parts.push([(at = `${at}/${part}`), part, false]);
  }
  const items: Crumb[] = parts.map(([p, name, first]) => [fileUri(p), name, first ? `path:${p}` : null]);
  if (cut >= 0) {
    // The archive's crumb opens its top; each folder inside it opens that folder.
    const last = items[items.length - 1];
    if (last) items[items.length - 1] = [archiveUri(path, ''), last[1], `path:${path}`];
    let at = '';
    for (const part of full.slice(cut + 1).split('/').filter(Boolean)) items.push([archiveUri(path, (at = at ? `${at}/${part}` : part)), part, null]);
  }
  return items;
}

/** The icon of a folder a tab or crumb shows. */
export const placeIcon = (uri: Uri, points: number): string => iconUrl(isLocal(uri) ? `path:${pathOf(uri)}` : 'type:public.folder', points * pixelRatio());

const THUMBNAILED = /^(jpe?g|png|gif|heic|heif|webp|tiff?|bmp|psd|mov|mp4|m4v|avi|pdf|key|pages|numbers|cr2|nef|arw|dng|raf|orf)$/i;

/** The icon of an item, `points` wide. */
export const entryIcon = (entry: Entry, points: number): string => iconUrl(entry.icon, points * pixelRatio());

/** A Quick Look thumbnail for a picture, a film or a document of this Mac, or null when the icon will do. */
export const entryThumb = (entry: Entry, points: number): string | null =>
  entry.kind === 'file' && THUMBNAILED.test(entry.ext) && isLocal(entry.uri) ? thumbUrl(pathOf(entry.uri), points * pixelRatio()) : null;
