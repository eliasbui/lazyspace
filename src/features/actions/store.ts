import { create } from 'zustand';
import { say } from '@/lib/ui';
import { api, type UserAction } from '@/services';

/** The commands of the user's own, as Settings edits them (the incomplete ones too, until they are finished). */
export const useUserActions = create<{ list: UserAction[] }>(() => ({ list: [] }));

export function loadActions(): Promise<void> {
  return api.actions.list().then(
    (list) => useUserActions.setState({ list }),
    () => undefined,
  );
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Saves the commands a moment after the last change; one without a name or a line is kept here and not saved. */
export function saveSoon(): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const ready = useUserActions.getState().list.filter((a) => a.name.trim() && a.command.trim());
    api.actions.save({ actions: ready }).catch(say);
  }, 400);
}

export function editAction(index: number, patch: Partial<UserAction>): void {
  useUserActions.setState((s) => ({ list: s.list.map((a, i) => (i === index ? { ...a, ...patch } : a)) }));
  saveSoon();
}
