import { GitBranchIcon } from '@phosphor-icons/react';
import { useT } from '@/i18n';
import { usePanesRevision, type PaneHandle } from '@/lib/panes-api';
import { useGit } from './store';

/** The branch of the repository the pane's folder is in, at the end of its path bar; nothing outside a repository. */
export function BranchPill({ pane }: { pane: PaneHandle }) {
  usePanesRevision((s) => s.revision);
  const t = useT();
  const tab = pane.tab;
  const kept = useGit((s) => s.byView[tab.id]);
  const branch = tab.branch ?? (kept?.uri === tab.uri ? kept.branch : null);
  if (!branch) return null;
  // A label, not a control: its words are its title, as a tooltip wants something to press.
  return (
    <span role="note" title={t('gitBranch', branch)} aria-label={t('gitBranch', branch)} className="inline-flex h-5.5 max-w-45 shrink-0 items-center gap-1 rounded-full bg-tint-soft px-2 text-[11px] font-semibold text-tint">
      <GitBranchIcon weight="bold" className="size-3 shrink-0" />
      <span className="truncate">{branch}</span>
    </span>
  );
}
