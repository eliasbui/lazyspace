// Commands of the user's own (src-tauri/src/features/actions.rs): written in Settings, offered in the context menu for the
// items they fit, run with the items as their arguments; what they print comes back as a toast.
import { t } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { registry, type MenuCtx } from '@/lib/registry';
import { say, toast } from '@/lib/ui';
import { isLocal, parentOf } from '@/lib/uri';
import { api, on, type UserAction } from '@/services';
import { ActionsSettings } from './ActionsSettings';
import { loadActions, useUserActions } from './store';

/** Whether a command is offered for what the menu is about. */
const fits = (a: UserAction, ctx: MenuCtx): boolean =>
  a.when === 'none' ? ctx.count === 0 : ctx.count > 0 && (a.when === 'any' || ctx.entries.every((e) => (a.when === 'folders' ? e.isDir : !e.isDir)));

/** The folder a command runs in: the pane's, or the folder of the first item when the pane is not one of this Mac. */
function folderOf(ctx: MenuCtx): string | null {
  if (isLocal(ctx.tab.uri)) return ctx.tab.uri;
  const first = ctx.entries[0];
  return first ? parentOf(first.uri) : null;
}

const saved = (): UserAction[] => useUserActions.getState().list.filter((a) => a.name.trim() && a.command.trim());

export function register(): void {
  registry.menu.add({
    id: 'actions',
    label: 'm.actions',
    icon: 'terminal',
    group: 70,
    order: 1,
    when: (ctx) => saved().some((a) => fits(a, ctx)) && !!folderOf(ctx) && ctx.entries.every((e) => isLocal(e.uri)),
    submenu: (ctx) =>
      saved()
        .filter((a) => fits(a, ctx))
        .map((a) => ({
          id: `action.${a.id}`,
          label: () => a.name,
          run: (c: MenuCtx) => {
            const folder = folderOf(c);
            if (folder) api.actions.run({ id: a.id, folder, uris: c.count ? c.entries.map((e) => e.uri) : [] }).catch(say);
          },
        })),
  });

  on('jobs.finished', (d) => {
    if (!d.ok || !d.data || typeof d.data !== 'object' || !('action' in d.data)) return;
    const out = String(d.data.output || '').trim();
    toast(out ? (out.length > 300 ? `${out.slice(0, 300)}...` : out) : t('actionDone', d.data.action));
  });

  registry.settings.section({ id: 'actions', title: 'actionsTitle', order: 70, Component: ActionsSettings });

  on('app.hello', () => void loadActions());
  if (useApp.getState().hello) void loadActions();
}
