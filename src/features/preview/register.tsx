import { SidebarSimpleIcon } from '@phosphor-icons/react';
import { setSetting, useApp } from '@/lib/app-state';
import { registry } from '@/lib/registry';

function toggle(): void {
  void setSetting({ preview: { on: !useApp.getState().settings?.preview.on } });
}

/** The toolbar button, the action and the key that show or hide the preview. */
export function register(): void {
  registry.toolbar.add({ id: 'preview', side: 'right', icon: <SidebarSimpleIcon mirrored />, label: 'previewToggle', run: toggle });
  registry.actions.set('togglePreview', toggle);
  registry.keys.add({ 'Cmd+Shift+P': 'togglePreview' });
}
