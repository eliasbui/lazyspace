// The filter of a pane: narrows its tab to the items whose name holds what is typed. Escape shows them all again, Enter
// and Down go to the first of them.
import { useEffect, useRef } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useT } from '@/i18n';
import type { Pane } from '../pane';

export function FilterField({ pane }: { pane: Pane }) {
  const t = useT();
  const input = useRef<HTMLInputElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (pane.filterOpen) input.current?.focus();
    return () => clearTimeout(timer.current);
  }, [pane, pane.filterOpen]);
  const close = () => {
    pane.filterOpen = false;
    pane.touch();
  };
  return (
    <label className="flex h-[28px] w-[180px] flex-none items-center gap-[6px] rounded-field bg-field px-[8px] text-fg-2 focus-within:shadow-[0_0_0_1px_var(--tint)]">
      <MagnifyingGlassIcon weight="bold" className="size-[13px] flex-none" />
      <input
        ref={input}
        type="search"
        defaultValue={pane.tab.filter}
        spellCheck={false}
        aria-label={t('filterPane')}
        placeholder={t('filterPane')}
        className="min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-fg-3 [&::-webkit-search-cancel-button]:hidden"
        onChange={(e) => {
          const text = e.currentTarget.value;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => pane.setFilter(text), 120);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            clearTimeout(timer.current);
            e.currentTarget.value = '';
            pane.setFilter('');
            close();
            pane.focusList();
          } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault();
            pane.focusList();
            pane.move(1, false);
          }
        }}
        onBlur={(e) => {
          if (!e.currentTarget.value) close();
        }}
      />
    </label>
  );
}
