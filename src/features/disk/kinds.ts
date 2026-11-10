import type { WordKey } from '@/i18n';
import type { DiskNode } from '@/services';

export type Kind = 'folder' | 'image' | 'video' | 'audio' | 'archive' | 'doc' | 'code' | 'file' | 'other';

/** The order of the legend. */
export const KINDS: readonly Kind[] = ['folder', 'image', 'video', 'audio', 'archive', 'doc', 'code', 'file', 'other'];

const BY_EXT: Array<[RegExp, Kind]> = [
  [/^(png|jpe?g|gif|heic|webp|tiff?|bmp|raw|dng|psd|svg)$/, 'image'],
  [/^(mov|mp4|m4v|mkv|avi|webm)$/, 'video'],
  [/^(mp3|m4a|aac|wav|flac|aiff|ogg)$/, 'audio'],
  [/^(zip|7z|rar|tar|gz|tgz|xz|bz2|dmg|iso|pkg)$/, 'archive'],
  [/^(pdf|docx?|xlsx?|pptx?|pages|numbers|key|txt|md|rtf)$/, 'doc'],
  [/^(rs|js|ts|tsx|py|go|swift|c|h|cpp|java|kt|rb|php|cs|sh|html|css|json)$/, 'code'],
];

/** What an item of the map is, for its colour. */
export function kindOf(node: DiskNode): Kind {
  if (node.other) return 'other';
  if (node.dir) return 'folder';
  const ext = node.name.includes('.') ? (node.name.split('.').pop() ?? '').toLowerCase() : '';
  return BY_EXT.find(([re]) => re.test(ext))?.[1] ?? 'file';
}

export const FILL: Record<Kind, string> = {
  folder: 'bg-(--disk-folder)',
  image: 'bg-(--disk-image)',
  video: 'bg-(--disk-video)',
  audio: 'bg-(--disk-audio)',
  archive: 'bg-(--disk-archive)',
  doc: 'bg-(--disk-doc)',
  code: 'bg-(--disk-code)',
  file: 'bg-(--disk-file)',
  other: 'bg-(--track)',
};

/** The ink of a label on each fill: white, but dark on the yellow and on the gray of the rest. */
export const INK: Record<Kind, string> = {
  folder: 'text-primary-foreground',
  image: 'text-primary-foreground',
  video: 'text-primary-foreground',
  audio: 'text-primary-foreground',
  archive: 'text-fg',
  doc: 'text-primary-foreground',
  code: 'text-primary-foreground',
  file: 'text-primary-foreground',
  other: 'text-fg-2',
};

/** Neighbours of one kind told apart by a step of light; in the dark only darker, as the dark steps are light already. */
const SHADES = ['', 'brightness-110 dark:brightness-90', 'brightness-90 dark:brightness-[.82]', 'brightness-120 dark:brightness-95', 'brightness-95 dark:brightness-[.86]'];
export const shade = (kind: Kind, i: number): string => (kind === 'other' ? '' : (SHADES[i % (kind === 'folder' ? 5 : 3)] ?? ''));

export const KIND_WORD: Record<Kind, WordKey> = {
  folder: 'disk.kind.folder',
  image: 'disk.kind.image',
  video: 'disk.kind.video',
  audio: 'disk.kind.audio',
  archive: 'disk.kind.archive',
  doc: 'disk.kind.doc',
  code: 'disk.kind.code',
  file: 'disk.kind.file',
  other: 'disk.kind.other',
};
