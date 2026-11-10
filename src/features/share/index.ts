// The share sheet of macOS (src-tauri/src/native/share.rs) for the items selected, or the folder itself when none is: from
// a button of the toolbar, as Finder has it, from the context menu, and as the `share` action.
import { ExportIcon } from '@phosphor-icons/react';
import { createElement } from 'react';
import { panes, type PaneHandle } from '@/lib/panes-api';
import { registry, type MenuCtx } from '@/lib/registry';
import { say } from '@/lib/ui';
import { isLocal } from '@/lib/uri';
import { api } from '@/services';

const targets = (pane: PaneHandle): string[] => (pane.tab.selCount() ? pane.tab.selectedEntries().map((e) => e.uri) : [pane.tab.uri]).filter(isLocal);

function share(pane: PaneHandle, x: number, y: number): void {
  const uris = targets(pane);
  if (uris.length) api.native.share({ uris, x, y }).catch(say);
}

const local = (ctx: MenuCtx): boolean => (ctx.count ? ctx.entries.length > 0 && ctx.entries.every((e) => isLocal(e.uri)) : isLocal(ctx.tab.uri));

export function register(): void {
  // The sheet comes out of the toolbar button; the action, run from a key or a command, uses where the button last was.
  let button: DOMRect | null = null;
  registry.actions.set('share', (pane) => share(pane, button ? button.left + button.width / 2 : innerWidth / 2, button ? button.bottom : 60));
  registry.toolbar.add({
    id: 'share',
    side: 'right',
    icon: createElement(ExportIcon),
    label: 'share',
    run: (rect) => {
      button = rect;
      const pane = panes.focused();
      if (pane) share(pane, rect.left + rect.width / 2, rect.bottom);
    },
  });
  registry.menu.add({ id: 'share', label: 'm.share', icon: 'square.and.arrow.up', group: 30, order: 6, when: local, run: (ctx) => share(ctx.pane, ctx.x, ctx.y) });
}
