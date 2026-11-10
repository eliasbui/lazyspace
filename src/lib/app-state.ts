// What the window knows of itself, from the host: the settings, the well-known places, which kind of window this is. The
// host sends it as `app.hello` once the page says `app.ready`, and `settings.changed` after every change.
import { create } from 'zustand';
import { setLanguage } from '@/i18n';
import { api, getHost, on, type HelloData, type Places, type ResolvedTheme, type Settings, type SettingsPatch, type WindowRole } from '@/services';
import { say, toast } from './ui';

interface AppState {
  hello: HelloData | null;
  settings: Settings | null;
  places: Places | null;
  role: WindowRole;
  windowId: number;
  version: string;
  /** The light or dark the window is drawn in now. */
  theme: ResolvedTheme;
}

export const useApp = create<AppState>(() => ({ hello: null, settings: null, places: null, role: 'main', windowId: 0, version: '', theme: 'light' }));

/** Asks the host to change settings; says the host's error if it refuses. */
export function setSetting(patch: SettingsPatch): Promise<void> {
  return api.settings.set({ patch }).then(
    () => undefined,
    (error: unknown) => say(error),
  );
}

/** The settings, once the host has said hello. */
export function useSettings(): Settings | null {
  return useApp((s) => s.settings);
}

const systemDark = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Puts the look of the settings on the root of the page: the classes and attributes the stylesheet follows. */
export function paintRoot(): void {
  const { settings, role, theme, hello } = useApp.getState();
  const root = document.documentElement;
  if (!settings) return;
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && (hello ? theme === 'dark' : systemDark()));
  root.classList.toggle('dark', dark);
  root.classList.toggle('light', !dark);
  // Only a main window has the glass behind it; the shelf and the desktop draw their own.
  root.classList.toggle('glass', settings.glass && role === 'main' && getHost().native);
  root.classList.toggle('preview', !getHost().native);
  const access = hello?.accessibility;
  root.classList.toggle('reduce-transparency', !!access?.reduceTransparency);
  root.classList.toggle('increase-contrast', !!access?.increaseContrast);
  root.classList.toggle('reduce-motion', !!access?.reduceMotion);
  root.lang = settings.language;
  root.dataset.accent = settings.accent;
  root.dataset.textSize = settings.text_size;
  root.dataset.iconSize = String(settings.icon_size);
  root.dataset.sidebarIcons = settings.sidebar_icons;
  setLanguage(settings.language);
}

let connected = false;

/**
 * Starts listening to the host and says `app.ready`. Safe to call twice (React StrictMode runs effects twice): the second
 * call does nothing. Returns nothing to undo, since the page lives as long as the window.
 */
export function connectApp(): void {
  if (connected) return;
  connected = true;
  on('app.hello', (hello) => {
    useApp.setState({ hello, settings: hello.settings, role: hello.windowRole, windowId: hello.windowId, version: hello.version, theme: hello.theme });
    paintRoot();
    void api.native.home().then(
      (places) => useApp.setState({ places }),
      (error: unknown) => say(error),
    );
  });
  on('settings.changed', (settings) => {
    useApp.setState({ settings });
    paintRoot();
  });
  on('theme.changed', ({ theme }) => {
    useApp.setState({ theme });
    paintRoot();
  });
  on('toast', (text) => toast(text));
  if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintRoot);
  window.addEventListener('error', (e) => void api.app.log({ message: `${e.message} (${e.filename}:${e.lineno})` }).catch(() => undefined));
  window.addEventListener('unhandledrejection', (e) => void api.app.log({ message: `unhandled: ${String(e.reason)}` }).catch(() => undefined));
  void api.app.ready();
}
