// The look of the app beyond light and dark (the old page's parts/13-appearance.js): the accent colour, the font of the
// window, the sidebar's icons in grey or in colour, the size of icons in the icon view (Cmd+= and Cmd+- too), and the size
// of the text of lists. Each is a setting; paintRoot puts them on the root of the page, and this puts the font there.
import { setSetting, useApp } from '@/lib/app-state';
import { registry } from '@/lib/registry';
import { AppearanceSection } from './AppearanceSection';
import { fontValue, stepIconSize } from './look';

function applyFont(font: string): void {
  const root = document.documentElement;
  if (font) root.style.setProperty('--font', fontValue(font));
  else root.style.removeProperty('--font');
}

/** Bigger and smaller icons from the keyboard, as in Finder. */
function stepIcons(by: 1 | -1): void {
  const size = useApp.getState().settings?.icon_size;
  if (!size) return;
  const next = stepIconSize(size, by);
  if (next !== size) void setSetting({ icon_size: next });
}

export function register(): void {
  // Right under Appearance (10), the group of light and dark it goes with.
  registry.settings.section({ id: 'appearance', title: 'colorsIcons', order: 11, Component: AppearanceSection });
  registry.actions.set('iconsBigger', () => stepIcons(1));
  registry.actions.set('iconsSmaller', () => stepIcons(-1));
  registry.keys.add({ 'Cmd+=': 'iconsBigger', 'Cmd+-': 'iconsSmaller' });
  useApp.subscribe((state, before) => {
    const font = state.settings?.font ?? '';
    if (font !== (before.settings?.font ?? '')) applyFont(font);
  });
}
