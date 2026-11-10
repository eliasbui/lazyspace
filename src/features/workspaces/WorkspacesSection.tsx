import { useEffect } from 'react';
import { LayoutIcon, PlusIcon } from '@phosphor-icons/react';
import { useT } from '@/i18n';
import { openSheet } from '@/lib/registry';
import { loadWorkspaces, restoreWorkspace, useWorkspaces, workspaceMenu } from './store';

const item =
  'flex h-7 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0';

/** The workspaces in the sidebar: a click brings one back, a right click renames, saves over or deletes it. */
export function WorkspacesSection() {
  const t = useT();
  const list = useWorkspaces((s) => s.list);
  useEffect(() => {
    void loadWorkspaces();
  }, []);
  return (
    <div className="flex flex-col gap-px">
      {list.map((w) => (
        <button
          key={w.id}
          type="button"
          className={item}
          onClick={() => restoreWorkspace(w)}
          onContextMenu={(e) => {
            e.preventDefault();
            void workspaceMenu(w, e.clientX, e.clientY);
          }}
        >
          <LayoutIcon className="text-fg-2 in-data-[sidebar-icons=color]:text-tint" />
          <span className="truncate">{w.name}</span>
        </button>
      ))}
      <button type="button" className={`${item} text-fg-3 hover:text-fg-2`} onClick={() => openSheet('workspaces')}>
        <PlusIcon />
        <span className="truncate">{t('saveWorkspace')}</span>
      </button>
    </div>
  );
}
