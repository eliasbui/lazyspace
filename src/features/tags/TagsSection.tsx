import { SideItem } from '@/components/macos/SideItem';
import { useT } from '@/i18n';
import { searchUri } from '@/lib/search-uri';
import { TAG_DOT, TAG_NAMES, TAG_ORDER, tagWord } from '@/lib/tags';
import { cn } from '@/lib/utils';

/** The sidebar's tags: each colour opens the search of the whole Mac for it. */
export function TagsSection() {
  const t = useT();
  return TAG_ORDER.map((colour) => (
    <SideItem key={colour} uri={searchUri({ tag: TAG_NAMES[colour] }, '/')} label={t(tagWord(colour))} icon={<span className={cn('size-2.5 rounded-full', TAG_DOT[colour])} />} />
  ));
}
