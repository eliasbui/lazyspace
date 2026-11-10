// The current folder in a terminal or an editor (src-tauri/src/features/openin.rs): two toolbar buttons open it in the
// default of each kind (Option-click picks another), the context menu lists every one on this Mac, and the Open With
// sheet lists them with the apps for the file selected; the one used last becomes the default.
import { CodeIcon, TerminalWindowIcon } from '@phosphor-icons/react';
import { createElement } from 'react';
import { useApp } from '@/lib/app-state';
import { panes } from '@/lib/panes-api';
import { openSheet, registry, type MenuItemDef } from '@/lib/registry';
import { isLocal } from '@/lib/uri';
import { on } from '@/services';
import { OpenWithSheet } from './OpenWithSheet';
import { chooseTool, loadTools, openIn, useTools, type ToolKind } from './store';

const KINDS: Array<{ kind: ToolKind; label: 'openTerminal' | 'openEditor'; symbol: string; icon: typeof TerminalWindowIcon; order: number }> = [
  { kind: 'terminal', label: 'openTerminal', symbol: 'terminal', icon: TerminalWindowIcon, order: 1 },
  { kind: 'editor', label: 'openEditor', symbol: 'chevron.left.forwardslash.chevron.right', icon: CodeIcon, order: 2 },
];

export function register(): void {
  // A toolbar button is told only where it is; whether Option was held comes from the press itself.
  let option = false;
  const held = (e: PointerEvent | KeyboardEvent) => {
    option = e.altKey;
  };
  window.addEventListener('pointerdown', held, true);
  window.addEventListener('keydown', held, true);

  for (const { kind, label, symbol, icon, order } of KINDS) {
    registry.toolbar.add({
      id: kind,
      side: 'left',
      order: 20 + order,
      icon: createElement(icon),
      label,
      run: (rect) => {
        const pane = panes.focused();
        if (!pane) return;
        if (option) void chooseTool(pane, kind, rect.left, rect.bottom + 6);
        else openIn(pane, kind, null);
      },
    });
    registry.menu.add({
      id: `openin.${kind}`,
      label,
      icon: symbol,
      group: 55,
      order,
      when: (c) => isLocal(c.tab.uri) && useTools.getState().list.some((tool) => tool.kind === kind),
      submenu: (): MenuItemDef[] =>
        useTools
          .getState()
          .list.filter((tool) => tool.kind === kind)
          .map((tool) => ({ id: `openin.${kind}.${tool.id}`, label: () => tool.name, checked: () => tool.default, run: (c) => openIn(c.pane, kind, tool.id) })),
    });
    registry.actions.set(label, (pane) => openIn(pane, kind, null));
  }

  registry.sheets.register({ id: 'openin', Component: OpenWithSheet });
  registry.actions.set('openIn', () => openSheet('openin'));

  on('app.hello', () => void loadTools());
  if (useApp.getState().hello) void loadTools();
}
