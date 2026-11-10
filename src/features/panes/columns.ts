// The columns of the list view, the groups a list can be shown in, the colours of tabs, and the sizes of rows and icons.
import type { WordKey } from '@/i18n';
import type { ColumnKey, GroupBy, Settings, TabColor, ViewMode } from '@/services';

/** The name, then those Settings lists (`columns`) in its order, each at the width it starts at. */
export const COLUMNS: Record<ColumnKey | 'name', { word: WordKey; width: number; num?: boolean }> = {
  name: { word: 'colName', width: 0 },
  mtime: { word: 'colModified', width: 160 },
  ctime: { word: 'colCreated', width: 160 },
  size: { word: 'colSize', width: 86, num: true },
  kind: { word: 'colKind', width: 150 },
  ext: { word: 'colExt', width: 72 },
  where: { word: 'colWhere', width: 220 },
};
export const COLUMN_KEYS: ColumnKey[] = ['mtime', 'ctime', 'size', 'kind', 'ext', 'where'];
export const isColumn = (key: string): key is ColumnKey => (COLUMN_KEYS as string[]).includes(key);

/** Finder's "Use Groups", with the words of their menu. */
export const GROUPS: Array<[GroupBy, WordKey]> = [
  ['', 'groupNone'],
  ['kind', 'groupKind'],
  ['date', 'groupDate'],
  ['size', 'groupSize'],
];

export const TAB_COLORS: TabColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
export const isTabColor = (c: unknown): c is TabColor => typeof c === 'string' && (TAB_COLORS as string[]).includes(c);

/** The columns a tab wants: those of Settings, the folder of each item first in search results. */
export function wantedColumns(settings: Settings | null, search: boolean): ColumnKey[] {
  const chosen = (Array.isArray(settings?.columns) ? settings.columns : (['mtime', 'size', 'kind'] as ColumnKey[])).filter(isColumn);
  return search && !chosen.includes('where') ? ['where', ...chosen] : chosen;
}

/**
 * The columns a list `width` points wide shows, as QSpace drops columns in a narrow pane: the name keeps at least 180
 * points and the others come in their order while they fit. The column view and a gallery show the name alone.
 */
export function shownColumns(mode: ViewMode, width: number, wanted: ColumnKey[], widths: Record<ColumnKey, number>): Array<ColumnKey | 'name'> {
  if (mode === 'columns' || mode === 'gallery') return ['name'];
  const room = (width || 800) - 16;
  const out: Array<ColumnKey | 'name'> = ['name'];
  let used = 180;
  for (const key of wanted) {
    used += widths[key] ?? COLUMNS[key].width;
    if (used > room) break;
    out.push(key);
  }
  return out;
}

/** The CSS grid of a row and of the header for the columns shown. */
export const gridOf = (shown: Array<ColumnKey | 'name'>, widths: Record<ColumnKey, number>): string =>
  `minmax(${shown.length > 2 ? 140 : 110}px, 1fr) ${shown
    .slice(1)
    .map((c) => `${c === 'name' ? 0 : (widths[c] ?? COLUMNS[c].width)}px`)
    .join(' ')}`;

export const defaultWidths = (): Record<ColumnKey, number> => ({ mtime: 160, ctime: 160, size: 86, kind: 150, ext: 72, where: 220 });

/** The height of a row and the side of an icon and of its cell, which follow the text and icon sizes of Settings. */
export function metrics(settings: Settings | null): { rowH: number; icon: number; cellW: number; cellH: number } {
  const rowH = { small: 22, medium: 24, large: 28 }[settings?.text_size ?? 'medium'] ?? 24;
  const icon = settings && [48, 64, 96, 128].includes(settings.icon_size) ? settings.icon_size : 64;
  return { rowH, icon, cellW: icon + 44, cellH: icon + 54 };
}
