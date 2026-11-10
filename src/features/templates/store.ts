import { create } from 'zustand';
import { t } from '@/i18n';
import type { PaneHandle } from '@/lib/panes-api';
import { say, toast } from '@/lib/ui';
import { isLocal } from '@/lib/uri';
import { api, type Row, type Template } from '@/services';

export const useTemplates = create<{ list: Template[] }>(() => ({ list: [] }));

export async function loadTemplates(): Promise<Template[]> {
  const list = await api.templates.list().catch(() => useTemplates.getState().list);
  useTemplates.setState({ list });
  return list;
}

/** What a template is called in a menu: a built-in one by its name, one of the user's with its extension. */
export const templateLabel = (tpl: Template): string => (tpl.builtin ? tpl.name : `${tpl.name}${tpl.ext ? `.${tpl.ext}` : ''}`);

/** The new file is selected with its name ready to type, as a new folder's is. */
export function createFromTemplate(pane: PaneHandle, id: string): void {
  const tab = pane.tab;
  api.templates
    .create({ uri: tab.uri, id })
    .then((entry) => {
      tab.renameWhenListed(entry.name);
      pane.refresh();
    })
    .catch(say);
}

export function openTemplatesFolder(pane: PaneHandle): void {
  api.templates.folder().then((uri) => pane.newTab(uri), say);
}

/** A file of this Mac can become a template. */
export const canBeTemplate = (entry: Row): boolean => entry.kind === 'file' && isLocal(entry.uri);

export function addTemplate(entry: Row): void {
  api.templates.add({ uri: entry.uri }).then(() => {
    toast(t('templateAdded'));
    void loadTemplates();
  }, say);
}
