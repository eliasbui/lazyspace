import { isLocal } from '@/lib/uri';
import type { Row } from '@/services';

const EXT = /\.(zip|7z|rar|tar|tgz|gz|tbz2?|bz2|txz|xz|lzma|tlz|iso|cab|cpio|xar|lha|lzh|jar|war|apk|ipa|cbz|cbr|z)$/i;

/** A file of this Mac that the app opens as a folder. */
export const isArchive = (row: Row | null | undefined): row is Row => !!row && row.kind === 'file' && isLocal(row.uri) && EXT.test(row.name);

export const inArchive = (uri: string | null | undefined): boolean => !!uri && uri.startsWith('archive://');
