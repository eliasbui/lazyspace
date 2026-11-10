// The path bar of a pane, as File Explorer's address bar: up and reload beside a field of crumbs, a menu of the folders
// in each crumb behind the arrow after it, what features show (the git branch) and the history at its end. Back, forward
// and the filter come with more than one pane; one pane has them in the toolbar.
import type { ReactNode } from 'react';
import { ArrowClockwiseIcon, ArrowUpIcon, CaretLeftIcon, CaretRightIcon, ClockCounterClockwiseIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { IconButton } from '@/components/macos/Tip';
import { useT } from '@/i18n';
import { useRegistry } from '@/lib/registry';
import { pathOf } from '@/lib/uri';
import { cn } from '@/lib/utils';
import { manager } from '../manager';
import { historyMenu } from '../menu/menus';
import type { Pane } from '../pane';
import { AddressField } from './AddressField';
import { Crumbs } from './Crumbs';
import { FilterField } from './FilterField';

export function PathBar({ pane, multi, focused }: { pane: Pane; multi: boolean; focused: boolean }) {
  const t = useT();
  const tab = pane.tab;
  return (
    <div className={cn('flex h-[40px] flex-none items-center gap-[2px] px-[8px] text-fg-2 transition-opacity', multi && !focused && 'opacity-60')}>
      {multi ? (
        <>
          <Stack pane={pane} way="back">
            <Nav label={t('back')} icon={<CaretLeftIcon weight="bold" />} disabled={!tab.back.length} run={() => manager.action('back', pane)} />
          </Stack>
          <Stack pane={pane} way="forward">
            <Nav label={t('forward')} icon={<CaretRightIcon weight="bold" />} disabled={!tab.forward.length} run={() => manager.action('forward', pane)} />
          </Stack>
        </>
      ) : null}
      <Nav label={t('enclosingFolder')} icon={<ArrowUpIcon weight="bold" />} disabled={!tab.uri || pathOf(tab.uri) === '/'} run={() => manager.action('enclosing', pane)} />
      <AddressBox pane={pane} tinted={multi && focused} />
      <Nav label={t('refresh')} icon={<ArrowClockwiseIcon weight="bold" />} run={() => manager.action('refresh', pane)} />
      {pane.filterOpen ? (
        <FilterField key={tab.id} pane={pane} />
      ) : multi ? (
        // The filter of the toolbar when there is one (the action "find"), else a field of the pane's own.
        <Nav label={t('filterPane')} icon={<MagnifyingGlassIcon weight="bold" />} run={() => manager.action('find', pane) || pane.openFilter()} />
      ) : null}
    </div>
  );
}

function Nav({ label, icon, disabled, run }: { label: string; icon: ReactNode; disabled?: boolean; run: () => void }) {
  return <IconButton label={label} icon={icon} isDisabled={disabled} className="size-[28px] rounded-field text-fg-2 hover:text-fg [&_svg]:size-[14px]" onPress={run} />;
}

/** Back and forward right-clicked list where they go, as Finder's do. */
function Stack({ pane, way, children }: { pane: Pane; way: 'back' | 'forward'; children: ReactNode }) {
  return (
    <span
      className="contents"
      onContextMenu={(e) => {
        e.preventDefault();
        pane.stackMenu(way, e.clientX, e.clientY);
      }}
    >
      {children}
    </span>
  );
}

/** The field of crumbs; anywhere in it but a crumb or a button, the path becomes a field to type in. */
function AddressBox({ pane, tinted }: { pane: Pane; tinted: boolean }) {
  const t = useT();
  const badges = useRegistry((s) => s.pathbar);
  const editing = pane.editingAddress;
  return (
    <div
      ref={(el) => {
        pane.boxEl = el;
      }}
      className={cn(
        'mx-[2px] flex h-[30px] min-w-0 flex-1 items-center gap-[2px] rounded-[9px] pr-[3px] pl-[4px] transition-[background-color,box-shadow] duration-150',
        editing ? 'bg-pane shadow-[0_0_0_1px_var(--tint),0_0_0_3.5px_var(--tint-soft)]' : tinted ? 'bg-tint/10 hover:bg-tint/15' : 'bg-field hover:bg-pressed',
      )}
      onClick={(e) => {
        if (!editing && e.target instanceof Element && !e.target.closest('button, input, [data-badge]')) pane.editAddress();
      }}
    >
      {editing ? <AddressField pane={pane} /> : <Crumbs pane={pane} tinted={tinted} />}
      {badges.map(({ id, Component }) => (
        <span key={id} data-badge className="flex flex-none items-center">
          <Component pane={pane} />
        </span>
      ))}
      <IconButton
        label={t('recentPlaces')}
        icon={<ClockCounterClockwiseIcon weight="bold" />}
        className="h-[24px] w-[26px] rounded-[6px] text-fg-2 hover:text-fg [&_svg]:size-[13px]"
        onPress={() => void historyMenu(pane)}
      />
    </div>
  );
}
