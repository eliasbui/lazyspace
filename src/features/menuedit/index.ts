// The context menu editor (the old page's parts/12-menuedit.js), in Settings: every item of the menu with a box to show or
// hide it, buttons to move it, a line after it, and an SF Symbol of the user's choice; saved as menu.json.
import { registry } from '@/lib/registry';
import { MenuEditSection } from './MenuEditSection';
import { MenuEditSheet } from './MenuEditSheet';

export function register(): void {
  registry.settings.section({ id: 'contextmenu', title: 'contextMenu', order: 30, Component: MenuEditSection });
  registry.sheets.register({ id: 'menuedit', Component: MenuEditSheet });
}
