// LazySpace as the desktop (W9, ui/parts/90-desktop.js): in the desktop's own window, the icons of ~/Desktop on the
// wallpaper, each where it was put; in Settings, the switches that turn it on and hide Finder's own icons.
import { registry } from '@/lib/registry';
import { DesktopPage } from './DesktopPage';
import { DesktopSettings } from './DesktopSettings';

export function register(): void {
  registry.role('desktop', DesktopPage);
  registry.settings.section({ id: 'desktop', title: 'desktop', order: 80, Component: DesktopSettings });
}
