// Places as URIs (design.md section 7.1): `file:///Users/me/a.txt`, `archive:///Users/me/a.zip!/dir`, `sftp://user@host/path`.
// Pure helpers, shared by every feature.

export const isLocal = (uri: string | null | undefined): uri is string => typeof uri === 'string' && uri.startsWith('file://');

/** The scheme of a place, or '' for anything that is not a URI. */
export const schemeOf = (uri: string | null | undefined): string => (typeof uri === 'string' && uri.includes('://') ? uri.split('://')[0] : '');

/** The path of a place, decoded; for any other scheme the part after the authority. */
export function pathOf(uri: string): string {
  const rest = uri.replace(/^[a-z0-9+-]+:\/\/[^/]*/, '');
  try {
    return decodeURIComponent(rest) || '/';
  } catch {
    return rest || '/';
  }
}

/** The part between `scheme://` and the path, decoded: the id of a server's connection. */
export function authorityOf(uri: string): string {
  const raw = (uri.split('://')[1] ?? '').split('/')[0] ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export const nameOf = (uri: string): string => pathOf(uri).split('/').filter(Boolean).pop() ?? '/';

export const samePlace = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && schemeOf(a) === schemeOf(b) && authorityOf(a) === authorityOf(b) && pathOf(a) === pathOf(b);

/** A path with every byte but the unreserved ones encoded, `!` included, as the app's own URIs are. */
export const encodePath = (path: string): string =>
  path
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');

export const fileUri = (path: string): string => `file://${path.split('/').map(encodeURIComponent).join('/')}`;

/** The place `inside` in the archive at `path` (archive:///path/a.zip!/inside). */
export const archiveUri = (path: string, inside: string): string => `archive://${encodePath(path)}!/${encodePath(inside)}`.replace(/\/$/, '');

/** The place at `path` where `uri` is: on the same disk, server or connection. */
export const withPath = (uri: string, path: string): string => uri.replace(/^([a-z0-9+-]+:\/\/[^/]*).*$/, '$1') + encodePath(path);

/** The parent of a place, or null at the top. */
export function parentOf(uri: string): string | null {
  const path = pathOf(uri);
  if (path === '/') return null;
  const up = path.slice(0, path.lastIndexOf('/')) || '/';
  return withPath(uri, up);
}
