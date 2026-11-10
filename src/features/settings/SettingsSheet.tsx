import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { Input, ListBox, ListBoxItem, SearchField } from 'react-aria-components';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { SettingsQuery } from '@/components/macos/Settings';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTitle } from '@/components/ui/dialog';
import { useT } from '@/i18n';
import { fold } from '@/lib/format';
import { useRegistry, type SettingsSectionDef, type SheetProps } from '@/lib/registry';
import { cn } from '@/lib/utils';
import { lookOf } from './look';

/** What a caller may open Settings at: a page, by the id of its section. */
export interface SettingsProps {
  page?: string;
}

// The page shown last, so Settings opens where it was left.
const usePage = create<{ page: string }>(() => ({ page: 'general' }));

function Tile({ section, selected }: { section: SettingsSectionDef; selected: boolean }) {
  const [Icon, accent] = lookOf(section.title);
  return (
    <span data-accent={accent} className={cn('grid size-[22px] shrink-0 place-items-center rounded-[6px] bg-tint text-primary-foreground shadow-xs', selected && 'ring-1 ring-primary-foreground/50')}>
      <Icon weight="fill" className="size-[14px]" />
    </span>
  );
}

/**
 * Settings in pages, as System Settings has them: every section (the window's own and those features add) is a page,
 * listed on the left with a symbol on a coloured tile; the search on top of the list shows the settings whose words hold
 * what is typed, from every page at once, under the title of their page.
 */
export function SettingsSheet({ props, close }: SheetProps<SettingsProps | undefined>) {
  const t = useT();
  const registered = useRegistry((s) => s.settings);
  const sections = useMemo(() => [...registered].sort((a, b) => (a.order ?? 50) - (b.order ?? 50)), [registered]);
  const page = usePage((s) => s.page);
  const [query, setQuery] = useState('');
  const asked = props?.page;
  useEffect(() => {
    if (!asked) return;
    usePage.setState({ page: asked });
    setQuery('');
  }, [asked]);

  const current = sections.find((s) => s.id === page) ?? sections[0];
  const words = fold(query.trim());
  const show = (id: string) => {
    usePage.setState({ page: id });
    setQuery('');
  };

  return (
    <Dialog isOpen onOpenChange={(open) => !open && close()} showCloseButton={false} className="h-[min(640px,calc(100vh-48px))] w-[min(880px,calc(100vw-48px))] max-w-none gap-0 overflow-hidden rounded-panel p-0 sm:max-w-none">
      <div className="grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)]">
        <nav className="flex min-h-0 flex-col gap-3 bg-hover px-3 pt-4 pb-3">
          <SearchField aria-label={t('searchSettings')} value={query} onChange={setQuery} className="relative shrink-0">
            <MagnifyingGlassIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-3" />
            <Input
              placeholder={t('searchSettings')}
              spellCheck={false}
              className="h-7 w-full rounded-field bg-field pr-2 pl-8 text-[13px] outline-none placeholder:text-fg-3 focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
            />
          </SearchField>
          <ListBox
            aria-label={t('settingsPages')}
            selectionMode="single"
            selectionBehavior="replace"
            disallowEmptySelection={!words}
            selectedKeys={words || !current ? [] : [current.id]}
            onSelectionChange={(keys) => {
              const id = [...keys][0];
              if (typeof id === 'string') show(id);
            }}
            className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 outline-none"
          >
            {sections.map((section) => (
              <ListBoxItem
                key={section.id}
                id={section.id}
                textValue={t(section.title)}
                className="flex h-8 shrink-0 items-center gap-2.5 rounded-[8px] px-2 text-[13px] outline-none hover:bg-hover data-focus-visible:ring-2 data-focus-visible:ring-ring data-selected:bg-tint data-selected:text-primary-foreground"
              >
                {({ isSelected }) => (
                  <>
                    <Tile section={section} selected={isSelected} />
                    <span className="truncate">{t(section.title)}</span>
                  </>
                )}
              </ListBoxItem>
            ))}
          </ListBox>
        </nav>
        <section className="flex min-h-0 min-w-0 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 pr-4 pl-7">
            <DialogTitle className="truncate text-[17px] font-bold tracking-tight">{words || !current ? t('settings') : t(current.title)}</DialogTitle>
            <Button variant="default" onPress={close}>
              {t('done')}
            </Button>
          </header>
          <div key={words ? 'search' : current?.id} className="min-h-0 flex-1 overflow-y-auto px-7 pt-1 pb-7">
            {words ? (
              // While searching, a page left without a row hides, and when every page has, the note says nothing matched.
              <div className="flex flex-col gap-6 [&:not(:has([data-slot=settings-row]))_[data-none]]:block">
                {sections.map((section) => (
                  <SettingsQuery.Provider key={section.id} value={fold(t(section.title)).includes(words) ? '' : words}>
                    <div className="flex flex-col gap-2 not-has-data-[slot=settings-row]:hidden">
                      <h3 className="px-1 text-[12px] font-semibold text-fg-2">{t(section.title)}</h3>
                      <section.Component />
                    </div>
                  </SettingsQuery.Provider>
                ))}
                <p data-none className="hidden pt-16 text-center text-[13px] text-fg-2">
                  {t('noSettingMatch')}
                </p>
              </div>
            ) : current ? (
              <current.Component />
            ) : null}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
