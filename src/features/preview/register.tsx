import { SidebarSimpleIcon } from '@phosphor-icons/react';
import { setSetting, useApp } from '@/lib/app-state';
import { registry, type ToolbarItemDef } from '@/lib/registry';

const isOn = (): boolean => !!useApp.getState().settings?.preview.on;

function toggle(): void {
  void setSetting({ preview: { on: !isOn() } });
}

/** The toolbar button, the action and the key that show or hide the preview. */
export function register(): void {
  // An order of its own: added again, the button keeps its place before the stash's.
  const button: ToolbarItemDef = { id: 'preview', side: 'right', order: 40, icon: <SidebarSimpleIcon className="-scale-x-100" />, label: 'previewToggle', run: toggle, active: isOn };
  registry.toolbar.add(button);
  // The button shows pressed while the preview is on: added again, the toolbar draws it again.
  useApp.subscribe((s, before) => {
    if (!!s.settings?.preview.on !== !!before.settings?.preview.on) registry.toolbar.add(button);
  });
  registry.actions.set('togglePreview', toggle);
  registry.keys.add({ 'Cmd+Shift+P': 'togglePreview' });
}
