import type { WordKey } from '@/i18n';
import type { AccentName, Settings } from '@/services';

/** The accent colours of the Mac, as Settings offers them; the stylesheet paints each (`[data-accent]`). */
export const ACCENTS: readonly AccentName[] = ['system', 'blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite'];

export const ICON_SIZES: Array<[Settings['icon_size'], WordKey]> = [
  [48, 'sizeSmall'],
  [64, 'sizeMedium'],
  [96, 'sizeLarge'],
  [128, 'sizeHuge'],
];

/** The system's own designs, which CSS names by keyword; the families installed on the Mac come after them. */
export const DESIGNS: Array<[string, WordKey]> = [
  ['', 'fontSystem'],
  ['ui-rounded', 'fontRounded'],
  ['ui-serif', 'fontSerif'],
  ['ui-monospace', 'fontMono'],
];

/** The CSS font list for a font of the settings: a design keyword or a family, then the system's. */
export function fontValue(font: string): string {
  const first = font.startsWith('ui-') ? `${font}, ` : `"${font.replace(/["\\]/g, '\\$&')}", `;
  return `${first}-apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
}

/** The next icon size up (`by` 1) or down (-1) from `size`, kept within the sizes there are. */
export function stepIconSize(size: number, by: 1 | -1): Settings['icon_size'] {
  const sizes = ICON_SIZES.map(([s]) => s);
  const at = Math.max(0, sizes.indexOf(size as Settings['icon_size']));
  return sizes[Math.min(sizes.length - 1, Math.max(0, at + by))] ?? 64;
}
