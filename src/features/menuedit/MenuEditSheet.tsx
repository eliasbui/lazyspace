import { useEffect, useState, type ReactNode } from 'react';
import { Dialog as AriaDialog } from 'react-aria-components';
import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react';
import { Group } from '@/components/macos/Settings';
import { SheetFrame } from '@/components/macos/SheetFrame';
import { IconButton, Tip } from '@/components/macos/Tip';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { isWordKey, useT } from '@/i18n';
import { openSheet, registry, type MenuItemDef, type SheetProps } from '@/lib/registry';
import { say } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { api, pixelRatio, symbolUrl, type MenuLayout } from '@/services';
import { EMPTY_LAYOUT, ordered, separatorsOf } from './layout';

/** The SF Symbols offered for an item; the native menu draws the one chosen. */
const SYMBOLS = [
  'folder', 'folder.fill', 'folder.badge.plus', 'doc', 'doc.text', 'doc.badge.plus', 'doc.on.doc', 'doc.on.clipboard', 'scissors', 'trash', 'trash.slash', 'pencil',
  'pencil.and.list.clipboard', 'eye', 'eye.slash', 'info.circle', 'link', 'star', 'star.fill', 'heart', 'tag', 'bookmark', 'paperplane', 'square.and.arrow.up',
  'square.and.arrow.down', 'arrow.up.forward.app', 'arrow.up.right.square', 'macwindow', 'terminal', 'chevron.left.forwardslash.chevron.right', 'curlybraces', 'number',
  'lock', 'lock.open', 'key', 'archivebox', 'shippingbox', 'externaldrive', 'internaldrive', 'server.rack', 'network', 'globe', 'cloud', 'icloud', 'tray',
  'tray.and.arrow.down', 'tray.full', 'photo', 'film', 'music.note', 'magnifyingglass', 'gearshape', 'slider.horizontal.3', 'wand.and.stars', 'sparkles', 'bolt',
  'flag', 'bell', 'clock', 'calendar', 'plus.square.on.square', 'square.grid.2x2', 'list.bullet', 'arrow.up.arrow.down', 'arrow.triangle.2.circlepath', 'plus.rectangle.on.rectangle',
];

/** An SF Symbol painted as a mask in the colour of the text, so it follows light and dark. */
function Symbol({ name }: { name: string }) {
  return <span aria-hidden className="size-4 bg-current [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]" style={{ maskImage: `url("${symbolUrl(name, 16 * pixelRatio())}")` }} />;
}

/** Up or down; a button that cannot move takes no tooltip, as a disabled button cannot take the focus a tooltip needs. */
function Move({ label, icon, disabled, onPress }: { label: string; icon: ReactNode; disabled: boolean; onPress: () => void }) {
  return disabled ? (
    <Button aria-label={label} variant="ghost" size="icon-sm" isDisabled>
      {icon}
    </Button>
  ) : (
    <IconButton label={label} icon={icon} size="icon-sm" onPress={onPress} />
  );
}

/** What `from` says opened the editor; Done goes back there. */
export interface MenuEditProps {
  from?: 'settings';
}

/**
 * The context menu editor: every item of the menu with a box to show or hide it, a symbol of the user's choice, a line
 * after it, and buttons to move it; saved as menu.json, which the menu follows at once.
 */
export function MenuEditSheet({ props, close }: SheetProps<MenuEditProps | undefined>) {
  const t = useT();
  const [layout, setLayout] = useState<MenuLayout>(EMPTY_LAYOUT);
  useEffect(() => {
    api.menuedit.get().then(
      (saved) => setLayout({ ...EMPTY_LAYOUT, ...saved, icons: saved.icons ?? {} }),
      () => undefined,
    );
  }, []);

  const items = ordered(registry.menu.list(), layout.order);
  const separators = separatorsOf(items, layout);
  const labelOf = (item: MenuItemDef): string => (typeof item.label === 'string' ? t(item.label) : isWordKey(item.id) ? t(item.id) : item.id);

  const store = (next: MenuLayout) => {
    setLayout(next);
    api.menuedit.set({ layout: next }).catch(say);
  };
  // The first change of a default menu writes out its full order, and the lines it had.
  const arrange = (list: MenuItemDef[], patch: Partial<MenuLayout>) => store({ ...layout, order: list.map((i) => i.id), separators, ...patch });
  const move = (at: number, by: -1 | 1) => {
    const list = [...items];
    const [item] = list.splice(at, 1);
    if (!item) return;
    list.splice(at + by, 0, item);
    arrange(list, {});
  };
  const done = () => (props?.from === 'settings' ? openSheet('settings', { page: 'contextmenu' }) : close());

  return (
    <SheetFrame
      open
      onClose={done}
      title={t('contextMenu')}
      footer={
        <>
          <Button className="mr-auto" onPress={() => store(EMPTY_LAYOUT)}>
            {t('resetMenu')}
          </Button>
          <Button variant="default" onPress={done}>
            {t('done')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        <p className="px-1 text-[12px] leading-snug text-fg-2">{t('contextMenuHint')}</p>
        <Group>
          {items.map((item, i) => {
            const hidden = layout.hidden.includes(item.id);
            const line = separators.includes(item.id);
            const icon = layout.icons[item.id] ?? item.icon;
            const label = labelOf(item);
            return (
              <div key={item.id} className={cn('flex h-10 items-center gap-2 pr-2 pl-3', line && 'border-b-2 border-b-hair-2')}>
                <Checkbox
                  aria-label={`${t('showItem')}: ${label}`}
                  isSelected={!hidden}
                  onChange={(show) => arrange(items, { hidden: show ? layout.hidden.filter((id) => id !== item.id) : [...layout.hidden, item.id] })}
                />
                <PopoverTrigger>
                  <IconButton label={t('chooseIcon')} variant="secondary" size="icon-sm" className="rounded-[6px]" icon={icon ? <Symbol name={icon} /> : null} />
                  <Popover placement="bottom start" className="w-auto p-3">
                    <AriaDialog aria-label={t('chooseIcon')} className="outline-none">
                      {({ close: shut }) => (
                        <div className="grid grid-cols-8 gap-1.5">
                          <p className="col-span-8 px-0.5 pb-1 text-[12px] font-semibold text-fg-2">{t('chooseIcon')}</p>
                          {SYMBOLS.map((name) => (
                            <Tip key={name} text={name}>
                              <Button
                                variant={name === icon ? 'outline' : 'secondary'}
                                aria-label={name}
                                className={cn('size-10 rounded-tile', name === icon && 'text-tint')}
                                onPress={() => {
                                  store({ ...layout, icons: { ...layout.icons, [item.id]: name } });
                                  shut();
                                }}
                              >
                                <Symbol name={name} />
                              </Button>
                            </Tip>
                          ))}
                        </div>
                      )}
                    </AriaDialog>
                  </Popover>
                </PopoverTrigger>
                <span className={cn('min-w-0 flex-1 truncate text-[13px]', hidden && 'text-fg-3')}>{label}</span>
                <Checkbox aria-label={`${t('lineAfter')}: ${label}`} isSelected={line} onChange={(on) => arrange(items, { separators: on ? [...separators, item.id] : separators.filter((id) => id !== item.id) })} />
                <span aria-hidden className="pr-1 text-[12px] text-fg-2">
                  {t('line')}
                </span>
                <Move label={t('moveUp')} icon={<CaretUpIcon />} disabled={i === 0} onPress={() => move(i, -1)} />
                <Move label={t('moveDown')} icon={<CaretDownIcon />} disabled={i === items.length - 1} onPress={() => move(i, 1)} />
              </div>
            );
          })}
        </Group>
      </div>
    </SheetFrame>
  );
}
