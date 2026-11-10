import { useT } from '@/i18n';
import { panes, usePanesRevision } from '@/lib/panes-api';
import { searchUri } from '@/lib/search-uri';
import { TAG_DOT, TAG_NAMES, TAG_ORDER, tagWord } from '@/lib/tags';
import { cn } from '@/lib/utils';

/** The sidebar's tags: each colour opens the search of the whole Mac for it. */
export function TagsSection() {
  const t = useT();
  usePanesRevision((s) => s.revision);
  const here = panes.current()?.uri;
  return (
    <ul className="flex flex-col gap-px">
      {TAG_ORDER.map((colour) => {
        const uri = searchUri({ tag: TAG_NAMES[colour] }, '/');
        return (
          <li key={colour}>
            <button
              type="button"
              aria-current={here === uri ? 'page' : undefined}
              onClick={() => panes.open(uri)}
              className="flex h-7 w-full items-center gap-2 rounded-field px-2 text-left text-[13px] transition-colors hover:bg-hover aria-[current=page]:bg-select-dim"
            >
              <span className="grid size-4 shrink-0 place-items-center" aria-hidden>
                <span className={cn('size-2.5 rounded-full', TAG_DOT[colour])} />
              </span>
              <span className="truncate">{t(tagWord(colour))}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
