// Settings (the old page's parts/16-settings.js and the Settings sheet of index.html): a sheet of pages, one per section
// of the registry, with a search over all of them; the window's own pages are General, Appearance and About. It opens
// from the action `settings` (the palette, the toolbar's menu), Cmd+, and the menu bar's Settings.
import { openSheet, registry } from '@/lib/registry';
import { on } from '@/services';
import { AboutSection, GeneralSection, ThemeSection } from './sections';
import { SettingsSheet, type SettingsProps } from './SettingsSheet';
import { listenForUpdates } from './update';

/** Opens Settings, at the page of the section `page` if one is given. */
export const openSettings = (page?: string): void => openSheet<SettingsProps>('settings', page ? { page } : {});

export function register(): void {
  registry.sheets.register({ id: 'settings', Component: SettingsSheet });
  registry.settings.section({ id: 'general', title: 'general', order: 0, Component: GeneralSection });
  registry.settings.section({ id: 'theme', title: 'appearance', order: 10, Component: ThemeSection });
  registry.settings.section({ id: 'about', title: 'about', order: 1000, Component: AboutSection });
  registry.actions.set('settings', () => openSettings());
  registry.keys.add({ 'Cmd+,': 'settings' });
  on('menu.action', ({ id }) => {
    if (id === 'app.settings') openSettings();
  });
  listenForUpdates();
}
