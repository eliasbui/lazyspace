import { useEffect, useState } from 'react';
import { LayoutIcon, PencilSimpleIcon, TrashIcon, TrayArrowDownIcon } from '@phosphor-icons/react';
import { Group } from '@/components/macos/Settings';
import { SheetFrame } from '@/components/macos/SheetFrame';
import { IconButton } from '@/components/macos/Tip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { fmtDate } from '@/lib/format';
import type { SheetProps } from '@/lib/registry';
import type { Workspace } from '@/services';
import { deleteWorkspace, loadWorkspaces, renameWorkspace, restoreWorkspace, saveWorkspace, useWorkspaces } from './store';

/** Saves the window under a name, and lists the workspaces saved before: open one, rename it, save over it, delete it. */
export function WorkspacesSheet({ close }: SheetProps) {
  const t = useT();
  const list = useWorkspaces((s) => s.list);
  const [name, setName] = useState('');
  useEffect(() => {
    void loadWorkspaces();
  }, []);
  const save = () => {
    const value = name.trim();
    if (value) void saveWorkspace(value).then((saved) => saved && close());
  };
  return (
    <SheetFrame
      open
      onClose={close}
      title={t('saveWorkspace')}
      footer={
        <>
          <Button onPress={close}>{t('cancel')}</Button>
          <Button variant="default" isDisabled={!name.trim()} onPress={save}>
            {t('saveWorkspace')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        <div className="flex flex-col gap-1.5">
          <Input
            autoFocus
            aria-label={t('workspaceName')}
            placeholder={t('workspaceName')}
            value={name}
            spellCheck={false}
            className="h-7"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') save();
            }}
          />
          <p className="px-1 text-[12px] leading-snug text-fg-2">{t('workspaceNameText')}</p>
        </div>
        <Group title={t('savedWorkspaces')}>
          {list.length ? list.map((w) => <WorkspaceRow key={w.id} workspace={w} close={close} />) : <p className="px-4 py-3 text-[13px] text-fg-3">{t('noWorkspaces')}</p>}
        </Group>
      </div>
    </SheetFrame>
  );
}

function WorkspaceRow({ workspace, close }: { workspace: Workspace; close: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const finish = (value: string | null) => {
    setEditing(false);
    if (value?.trim() && value.trim() !== workspace.name) renameWorkspace(workspace, value.trim());
  };
  return (
    <div className="flex min-h-12 items-center gap-1 py-1.5 pr-2 pl-2">
      {editing ? (
        <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1.5">
          <LayoutIcon className="size-5 shrink-0 text-tint" />
          <Input
            autoFocus
            aria-label={t('workspaceName')}
            defaultValue={workspace.name}
            spellCheck={false}
            className="h-7"
            onFocus={(e) => e.target.select()}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') finish(e.currentTarget.value);
              else if (e.key === 'Escape') finish(null);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-field px-1.5 py-1 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${t('openWorkspace')}: ${workspace.name}`}
          onClick={() => {
            restoreWorkspace(workspace);
            close();
          }}
        >
          <LayoutIcon className="size-5 shrink-0 text-tint" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px]">{workspace.name}</span>
            <span className="truncate text-[11px] text-fg-3">{fmtDate(workspace.created)}</span>
          </span>
        </button>
      )}
      <IconButton label={t('renameWorkspace')} icon={<PencilSimpleIcon />} onPress={() => setEditing(true)} />
      <IconButton label={t('overwriteWorkspace')} icon={<TrayArrowDownIcon />} onPress={() => void saveWorkspace(workspace.name)} />
      <IconButton label={t('deleteWorkspace')} icon={<TrashIcon />} className="hover:text-bad" onPress={() => deleteWorkspace(workspace)} />
    </div>
  );
}
