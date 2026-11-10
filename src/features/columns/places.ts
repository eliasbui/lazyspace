import { archiveUri, fileUri, isLocal, pathOf, schemeOf, withPath } from '@/lib/uri';
import { iconUrl, pixelRatio, thumbUrl, type Row, type Uri } from '@/services';

/**
 * The folders above the tab's, from the start of its place (the home folder, the disk, a server's root, an archive's
 * top), the highest first; none for a search or the shelf, whose items come from many folders.
 */
export function above(uri: Uri, home: Uri | null): Uri[] {
  const scheme = schemeOf(uri);
  if (!uri || scheme === 'search' || scheme === 'stash') return [];
  const path = pathOf(uri);
  if (scheme === 'archive') {
    const cut = path.indexOf('!');
    if (cut < 0) return [];
    const archive = path.slice(0, cut);
    const parts = path.slice(cut + 1).split('/').filter(Boolean);
    return parts.map((_, i) => archiveUri(archive, parts.slice(0, i).join('/')));
  }
  const homePath = home ? pathOf(home) : null;
  const start = scheme === 'file' && homePath && (path === homePath || path.startsWith(`${homePath}/`)) ? homePath : '/';
  if (path === start) return [];
  const folders = [start];
  let at = start === '/' ? '' : start;
  for (const part of path.slice(start.length).split('/').filter(Boolean).slice(0, -1)) folders.push((at = `${at}/${part}`));
  return folders.map((p) => (scheme === 'file' ? fileUri(p) : withPath(uri, p)));
}

const THUMBNAILED = /^(jpe?g|png|gif|heic|heif|webp|tiff?|bmp|psd|mov|mp4|m4v|avi|pdf|key|pages|numbers|cr2|nef|arw|dng|raf|orf)$/i;

/** A Quick Look thumbnail for a picture, a film or a document of this Mac, `points` wide; null when the icon will do. */
export const thumbOf = (row: Row, points: number): string | null =>
  row.kind === 'file' && THUMBNAILED.test(row.ext) && isLocal(row.uri) ? thumbUrl(pathOf(row.uri), points * pixelRatio()) : null;

export const iconOf = (row: Row, points: number): string => iconUrl(row.icon, points * pixelRatio());
