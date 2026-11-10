import { useEffect } from 'react';
import { LayoutIcon } from '@phosphor-icons/react';
import { SideHead, SideItem } from '@/components/macos/SideItem';
import { useT } from '@/i18n';
import { openSheet } from '@/lib/registry';
import { loadWorkspaces, restoreWorkspace, useWorkspaces, workspaceMenu } from './store';

/** The workspaces in the sidebar: a click brings one back, a right click renames, saves over or deletes it; + saves one. */
export function WorkspacesSection() {
  const t = useT();
  const list = useWorkspaces((s) => s.list);
  useEffect(() => {
    void loadWorkspaces();
  }, []);
  return (
    <>
      <SideHead title={t('workspaces')} add={{ label: t('saveWorkspace'), run: () => openSheet('workspaces') }} />
      {list.map((w) => (
        <SideItem
          key={w.id}
          label={w.name}
          icon={<LayoutIcon />}
          ico="workspace"
          onPress={() => restoreWorkspace(w)}
          onContextMenu={(e) => {
            e.preventDefault();
            void workspaceMenu(w, e.clientX, e.clientY);
          }}
        />
      ))}
    </>
  );
}
