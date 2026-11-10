import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { translate, useT, type WordKey } from '@/i18n';
import { useSettings } from '@/lib/app-state';
import { panes, type PaneHandle } from '@/lib/panes-api';
import { registry, type MenuCtx, type MenuItemDef, type SheetProps } from '@/lib/registry';
import { COMMANDS, CORE_ACTIONS, GROUPS, keysOf, matches, searchText, wordOf, type CommandId } from './list';

interface MenuCommand {
  key: string;
  label: string;
  text: string;
  run: () => void;
}

/** The context menu as the focused pane would show it for its selection. */
function menuCtx(pane: PaneHandle): MenuCtx {
  const { tab } = pane;
  const entries = tab.selectedEntries();
  const count = tab.selCount();
  return { pane, tab, entries, entry: entries[0] ?? null, count, where: count ? 'item' : 'empty', x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 3) };
}

/** The items of the context menu that fit the selection and that no command of the list already is, submenus one deep. */
function menuCommands(pane: PaneHandle | null, shown: ReadonlySet<string>, t: (key: WordKey) => string): MenuCommand[] {
  if (!pane) return [];
  let ctx: MenuCtx;
  try {
    ctx = menuCtx(pane);
  } catch {
    return [];
  }
  const fits = (item: MenuItemDef) => (!item.when || item.when(ctx)) && (!item.enabled || item.enabled(ctx));
  const words = (item: MenuItemDef) => (typeof item.label === 'string' ? { label: t(item.label), text: `${translate('vi', item.label)} ${translate('en', item.label)}` } : { label: item.label(ctx), text: item.label(ctx) });
  const out: MenuCommand[] = [];
  for (const item of registry.menu.list().filter(fits)) {
    if (shown.has(item.id) || (item.action && shown.has(item.action))) continue;
    const top = words(item);
    const run = item.run;
    if (run) out.push({ key: `menu:${item.id}`, label: top.label, text: `${top.text} ${item.id}`, run: () => run(ctx) });
    const sub = typeof item.submenu === 'function' ? item.submenu(ctx) : item.submenu;
    for (const child of (sub ?? []).filter(fits)) {
      const childRun = child.run;
      if (!childRun || (child.action && shown.has(child.action))) continue;
      const w = words(child);
      out.push({ key: `menu:${item.id}:${child.id}`, label: `${top.label}: ${w.label}`, text: `${top.text} ${w.text} ${child.id}`, run: () => childRun(ctx) });
    }
  }
  return out;
}

/** Runs an action on the focused pane once the palette has closed and given the focus back. */
function runLater(run: () => void): void {
  requestAnimationFrame(run);
}

/**
 * The palette (Cmd+P, or Cmd+/ for the list of shortcuts): every action by its name in either language, typed without
 * accents if one likes, with its keys, run with Enter; then what the context menu offers for the selection.
 */
export function Palette({ close }: SheetProps) {
  const t = useT();
  const keymap = useSettings()?.keymap ?? 'mac';
  const map = registry.keys.map(keymap);
  const available = COMMANDS.filter(([id]) => registry.actions.get(id) || CORE_ACTIONS.has(id));
  const shown = new Set<string>(available.map(([id]) => id));
  const pane = panes.focused();
  const menu = menuCommands(pane, shown, t);

  const run = (key: string) => {
    close();
    if (key.startsWith('cmd:')) {
      const id = key.slice(4);
      runLater(() => {
        if (panes.action(id)) return;
        const action = registry.actions.get(id);
        const focused = panes.focused();
        if (action && focused) void action(focused);
      });
    } else {
      const item = menu.find((m) => m.key === key);
      if (item) runLater(item.run);
    }
  };

  const commandItem = (id: CommandId) => {
    const keys = keysOf(id, map, keymap, t);
    return (
      <CommandItem key={id} id={`cmd:${id}`} textValue={searchText(id)} className={itemClass}>
        <span className="truncate">{t(wordOf(id))}</span>
        {keys.length ? (
          <CommandShortcut className="tracking-normal">
            <KbdGroup>
              {keys.map((k) => (
                <Kbd key={k} className={kbdClass}>
                  {k}
                </Kbd>
              ))}
            </KbdGroup>
          </CommandShortcut>
        ) : null}
      </CommandItem>
    );
  };

  return (
    <CommandDialog open onOpenChange={(open) => !open && close()} title={t('commandsTitle')} description={t('commandsSearch')} className="top-[14%] rounded-panel! sm:max-w-[560px]">
      <Command className="rounded-panel! bg-transparent p-1.5 backdrop-blur-none" filter={matches}>
        <CommandInput placeholder={t('commandsSearch')} spellCheck={false} autoComplete="off" />
        <CommandList autoFocus="first" aria-label={t('commandsTitle')} className="mt-1 max-h-[min(420px,60vh)]" onAction={(key) => run(String(key))} renderEmptyState={() => <CommandEmpty className="text-fg-2">{t('noCommand')}</CommandEmpty>}>
          {GROUPS.map((group) => {
            const ids = available.filter(([, g]) => g === group).map(([id]) => id);
            return ids.length ? (
              <CommandGroup key={group} id={group} heading={t(`cmdGroup.${group}`)} className={groupClass}>
                {ids.map(commandItem)}
              </CommandGroup>
            ) : null;
          })}
          {menu.length ? (
            <CommandGroup id="menu" heading={t('cmdGroup.menu')} className={groupClass}>
              {menu.map((m) => (
                <CommandItem key={m.key} id={m.key} textValue={m.text} className={itemClass}>
                  <span className="truncate">{m.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

const groupClass = 'p-0.5 **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-[11px] **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:text-fg-2';
const itemClass = 'h-[30px] rounded-[8px]! px-2.5 py-0 text-[13px] data-focused:bg-tint data-focused:text-primary-foreground';
const kbdClass = 'h-[18px] rounded-[5px] bg-field px-1.5 font-mono text-[11px] text-fg-2 group-data-focused/command-item:bg-primary-foreground/20 group-data-focused/command-item:text-primary-foreground';
