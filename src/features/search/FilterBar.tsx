import type { ReactNode } from 'react';
import { CaretDownIcon } from '@phosphor-icons/react';
import type { PressEvent } from 'react-aria-components';
import { Button } from '@/components/ui/button';
import { isWordKey, t as word, useT, type WordKey } from '@/i18n';
import { choose } from '@/lib/menu';
import { usePanesRevision, type PaneHandle } from '@/lib/panes-api';
import { isSearch, searchFolder, searchQuery, searchUri, type SearchQuery } from '@/lib/search-uri';
import type { MenuNode } from '@/services';
import { folderName } from './query';

type Which = 'kind' | 'date' | 'size';

const VALUES: Record<Which, string[]> = {
  kind: ['', 'folder', 'image', 'movie', 'audio', 'pdf', 'document', 'archive', 'app', 'code'],
  date: ['', 'today', 'week', 'month', 'year'],
  size: ['', '1m', '100m', '1g'],
};
const ICON_OF: Record<string, string> = {
  folder: 'folder',
  image: 'photo',
  movie: 'film',
  audio: 'music.note',
  pdf: 'doc.richtext',
  document: 'doc.text',
  archive: 'archivebox',
  app: 'app',
  code: 'chevron.left.forwardslash.chevron.right',
};

/** The words of a value of a filter ("kind.image", "date.week", "size.1m"); the empty value is "any". A value the
 *  tables do not know shows as it is. */
function valueLabel(which: Which, value: string, tr: (key: WordKey) => string): string {
  const key = value ? `${which}.${value}` : which === 'kind' ? 'kind.' : 'sAny';
  return isWordKey(key) ? tr(key) : value;
}

const go = (pane: PaneHandle, patch: SearchQuery, where: string) => {
  pane.navigate(searchUri({ ...searchQuery(pane.tab.uri), ...patch }, where), { history: false });
};

async function filterMenu(pane: PaneHandle, which: Which | 'where', e: PressEvent): Promise<void> {
  const uri = pane.tab.uri;
  const q = searchQuery(uri);
  const folder = searchFolder(uri);
  const r = e.target.getBoundingClientRect();
  if (which === 'where') {
    const home = q.from || folder;
    const id = await choose(
      [
        { id: 'here', label: folderName(home), icon: 'folder', checked: folder !== '/' },
        { id: 'mac', label: word('thisMac'), icon: 'desktopcomputer', checked: folder === '/' },
      ],
      r.left,
      r.bottom + 4,
    );
    if (id === 'mac' && folder !== '/') go(pane, { from: folder }, '/');
    else if (id === 'here' && folder === '/' && q.from) go(pane, { from: '' }, q.from);
    return;
  }
  const items: MenuNode[] = VALUES[which].map((v) => ({ id: v || 'any', label: valueLabel(which, v, word), icon: which === 'kind' ? ICON_OF[v] : undefined, checked: (q[which] ?? '') === v }));
  const id = await choose(items, r.left, r.bottom + 4);
  if (id) go(pane, { [which]: id === 'any' ? '' : id }, folder);
}

function Pill({ label, value, on, menu, onPress }: { label: string; value?: string; on: boolean; menu: boolean; onPress: (e: PressEvent) => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-haspopup={menu ? 'menu' : undefined}
      aria-pressed={menu ? undefined : on}
      onPress={onPress}
      className={
        on
          ? 'shrink-0 gap-1.5 rounded-full bg-tint-soft px-2.5 font-normal text-tint hover:bg-tint-soft aria-pressed:bg-tint-soft'
          : 'shrink-0 gap-1.5 rounded-full bg-field px-2.5 font-normal text-fg-2 hover:bg-hover hover:text-fg'
      }
    >
      <span>{label}</span>
      {value ? <b className={on ? 'font-semibold' : 'font-semibold text-fg'}>{value}</b> : null}
      {menu ? <CaretDownIcon weight="bold" className="size-2.5 opacity-70" /> : null}
    </Button>
  );
}

/** The bar of filters over the results of a search with words, as Finder's search bar: each filter a pill with its menu,
 *  tinted when it narrows the results; a change searches again in place. */
export function FilterBar({ pane }: { pane: PaneHandle }): ReactNode {
  const t = useT();
  usePanesRevision((s) => s.revision);
  const uri = pane.tab.uri;
  const q = isSearch(uri) ? searchQuery(uri) : null;
  if (!q?.q) return null;
  const folder = searchFolder(uri);
  const pill = (which: Which, label: WordKey) => (
    <Pill label={t(label)} value={q[which] ? valueLabel(which, q[which] ?? '', t) : ''} on={!!q[which]} menu onPress={(e) => void filterMenu(pane, which, e)} />
  );
  return (
    <div role="toolbar" aria-label={t('searchTitle')} className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
      <Pill label={t('sWhere')} value={folderName(folder)} on={false} menu onPress={(e) => void filterMenu(pane, 'where', e)} />
      {pill('kind', 'sKind')}
      {pill('date', 'sDate')}
      {pill('size', 'sSize')}
      <Pill label={t('sContent')} on={q.content === '1'} menu={false} onPress={() => go(pane, { content: q.content === '1' ? '' : '1' }, folder)} />
    </div>
  );
}
