// New files from templates (src-tauri/src/features/templates.rs): a toolbar button and a context menu entry list the
// templates, and the New File sheet shows them as tiles; the new file is selected and its name is ready to type, as a
// new folder's is.
import { FilePlusIcon } from '@phosphor-icons/react';
import { createElement } from 'react';
import { t } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { choose } from '@/lib/menu';
import { panes } from '@/lib/panes-api';
import { openSheet, registry, type MenuItemDef } from '@/lib/registry';
import { on } from '@/services';
import { SYMBOL } from './icons';
import { addTemplate, canBeTemplate, createFromTemplate, loadTemplates, openTemplatesFolder, templateLabel, useTemplates } from './store';
import { TemplatesSheet } from './TemplatesSheet';

export function register(): void {
  registry.toolbar.add({
    id: 'newFile',
    // With the new-folder and Trash buttons, before them.
    side: 'left',
    order: 0,
    icon: createElement(FilePlusIcon),
    label: 'newFile',
    run: async (rect) => {
      const pane = panes.focused();
      if (!pane?.tab.capabilities.write) return;
      const list = await loadTemplates();
      const id = await choose(
        [
          ...list.map((tpl) => ({ id: `tpl:${tpl.id}`, label: templateLabel(tpl), icon: SYMBOL[tpl.ext] ?? 'doc' })),
          { separator: true },
          { id: 'folder', label: t('templatesFolder'), icon: 'folder' },
        ],
        rect.left,
        rect.bottom + 6,
      );
      if (id === 'folder') openTemplatesFolder(pane);
      else if (id?.startsWith('tpl:')) createFromTemplate(pane, id.slice(4));
    },
  });

  registry.menu.add({
    id: 'newFile',
    label: 'newFile',
    icon: 'doc.badge.plus',
    group: 50,
    order: 0,
    when: (c) => c.count === 0 && c.tab.capabilities.write,
    submenu: (): MenuItemDef[] => [
      ...useTemplates.getState().list.map((tpl, i): MenuItemDef => ({
        id: `newFile.${i}`,
        label: () => templateLabel(tpl),
        icon: SYMBOL[tpl.ext] ?? 'doc',
        group: 1,
        run: (c) => createFromTemplate(c.pane, tpl.id),
      })),
      { id: 'newFile.folder', label: 'templatesFolder', icon: 'folder', group: 2, run: (c) => openTemplatesFolder(c.pane) },
    ],
  });
  registry.menu.add({
    id: 'addTemplate',
    label: 'addTemplate',
    icon: 'doc.on.doc',
    group: 50,
    order: 9,
    when: (c) => c.count === 1 && !!c.entry && canBeTemplate(c.entry),
    run: (c) => c.entry && addTemplate(c.entry),
  });

  registry.sheets.register({ id: 'templates', Component: TemplatesSheet });
  registry.actions.set('newFile', () => openSheet('templates'));

  on('app.hello', () => void loadTemplates());
  if (useApp.getState().hello) void loadTemplates();
}
