// The keys of Windows (the old page's parts/11-keyboard.js): a switch in Settings between the keys of a Mac and those of
// Windows Explorer, for someone coming from Windows (Ctrl+C, Ctrl+X, Ctrl+V; Enter opens; F2 renames; Delete trashes).
import { registry } from '@/lib/registry';
import { KeyboardSection } from './KeyboardSection';

export function register(): void {
  registry.settings.section({ id: 'keyboard', title: 'keyboard', order: 20, Component: KeyboardSection });
}
