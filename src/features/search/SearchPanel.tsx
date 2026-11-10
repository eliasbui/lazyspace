import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DesktopIcon, FileMagnifyingGlassIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { SheetFrame } from '@/components/macos/SheetFrame';
import { DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { panes, type PaneHandle } from '@/lib/panes-api';
import { closeSheet, type SheetProps } from '@/lib/registry';
import { say } from '@/lib/ui';
import { fileUri } from '@/lib/uri';
import { cn } from '@/lib/utils';
import { api, iconUrl, pixelRatio, type IndexHit } from '@/services';
import { folderName, placeLabel, runSearch, scopeOf, wordsOf } from './query';

interface Choice {
  key: string;
  label: string;
  picture: ReactNode;
  where?: string;
  hit?: boolean;
  /** `meta`: Command was held, which opens a file in its app. */
  go: (meta: boolean) => void;
}

/** The offers to search (the folder and those in it, which Enter takes; the whole Mac; the contents too), then the items
 *  of the quick index that match best. A folder opens in the pane; a file opens its folder with it selected. */
function choicesOf(pane: PaneHandle | null, text: string, hits: IndexHit[], t: ReturnType<typeof useT>): Choice[] {
  const words = text.trim();
  if (!pane || !words) return [];
  const icon = 'size-4 shrink-0 text-fg-2 group-aria-selected:text-primary-foreground';
  const list: Choice[] = [
    { key: 'in', label: t('searchIn', words, folderName(scopeOf(pane))), picture: <MagnifyingGlassIcon className={icon} />, go: () => runSearch(pane, words) },
    { key: 'mac', label: t('searchMac', words), picture: <DesktopIcon className={icon} />, go: () => runSearch(pane, words, { mac: true }) },
    { key: 'content', label: t('searchContent', words), picture: <FileMagnifyingGlassIcon className={icon} />, go: () => runSearch(pane, words, { content: true }) },
  ];
  for (const hit of hits) {
    const name = hit.path.split('/').pop() ?? hit.path;
    const parent = hit.path.slice(0, hit.path.lastIndexOf('/')) || '/';
    list.push({
      key: hit.path,
      label: name,
      hit: true,
      where: placeLabel(parent),
      picture: <img src={iconUrl(`path:${hit.path}`, 16 * pixelRatio())} alt="" draggable={false} className="size-4 shrink-0" />,
      go: (meta) => {
        if (hit.folder) pane.navigate(fileUri(hit.path));
        else if (meta) api.native.open({ uris: [fileUri(hit.path)] }).catch(say);
        else pane.navigate(fileUri(parent), { select: [name] });
      },
    });
  }
  return list;
}

/** The search panel, as Spotlight has it: what is typed is offered as a search of the folder, of the Mac or of the
 *  contents, and the quick index's best matches follow. Arrows move, Enter takes, Command-Enter opens a file in its app. */
export function SearchPanel({ props, close }: SheetProps<{ text?: string } | undefined>) {
  const t = useT();
  const pane = panes.focused();
  const [text, setText] = useState(() => props?.text ?? wordsOf(pane));
  const [hits, setHits] = useState<IndexHit[]>([]);
  const [at, setAt] = useState(0);
  const asked = useRef(0);

  // The best of the quick index for what is typed; an answer to an older text is dropped.
  useEffect(() => {
    const words = text.trim();
    const mine = ++asked.current;
    if (!words) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      api.index.search({ q: words, limit: 8 }).then(
        (d) => mine === asked.current && setHits(d.items),
        () => undefined,
      );
    }, 40);
    return () => clearTimeout(timer);
  }, [text]);

  const list = choicesOf(pane, text, hits, t);
  const mark = Math.min(at, Math.max(0, list.length - 1));
  const pick = (i: number, meta: boolean) => {
    const choice = list[i];
    closeSheet();
    choice?.go(meta);
  };

  return (
    <SheetFrame open onClose={close} size="lg" className="top-[14%] translate-y-0">
      <DialogTitle className="sr-only">{t('searchTitle')}</DialogTitle>
      <div className="-mx-5 -my-2 flex flex-col">
        <div className={cn('flex h-12 items-center gap-2.5 px-4', list.length > 0 && 'border-b border-hair')}>
          <MagnifyingGlassIcon className="size-5 shrink-0 text-fg-2" />
          <Input
            autoFocus
            role="combobox"
            aria-label={t('searchTitle')}
            aria-expanded={list.length > 0}
            aria-controls="search-choices"
            aria-activedescendant={list.length ? `search-choice-${mark}` : undefined}
            aria-autocomplete="list"
            placeholder={t('searchPanelHint')}
            spellCheck={false}
            value={text}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              setText(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              // Escape is the sheet's; every other key is the field's, not the keymap's.
              if (e.key === 'Escape') return;
              e.stopPropagation();
              if (e.key === 'Enter' && list.length) {
                e.preventDefault();
                pick(mark, e.metaKey);
              } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && list.length) {
                e.preventDefault();
                setAt((mark + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length);
              }
            }}
            className="h-9 border-0 bg-transparent px-0 text-[17px] focus-visible:ring-0 md:text-[17px] dark:bg-transparent"
          />
        </div>
        {list.length ? (
          <ul id="search-choices" role="listbox" aria-label={t('searchTitle')} className="max-h-[420px] overflow-y-auto p-1.5">
            {list.map((c, i) => (
              <li key={c.key} role="presentation">
                {c.hit && !list[i - 1]?.hit ? <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold text-fg-2">{t('quickHits')}</p> : null}
                <div
                  id={`search-choice-${i}`}
                  role="option"
                  aria-selected={i === mark}
                  onMouseMove={() => i !== mark && setAt(i)}
                  onMouseDown={(e) => {
                    // The field keeps the keyboard.
                    e.preventDefault();
                    pick(i, e.metaKey);
                  }}
                  className="group flex h-8 items-center gap-2.5 rounded-field px-2.5 text-[13px] aria-selected:bg-select aria-selected:text-primary-foreground"
                >
                  {c.picture}
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.where ? <small className="max-w-[45%] shrink-0 truncate pl-2.5 text-[11px] text-fg-2 group-aria-selected:text-primary-foreground/80">{c.where}</small> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </SheetFrame>
  );
}
