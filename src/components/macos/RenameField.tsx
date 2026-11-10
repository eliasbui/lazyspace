import { useLayoutEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

/**
 * A name as a field, in a list or a grid: the part before the extension is selected, Return renames, Escape leaves the name as
 * it was, and leaving the field renames. `draft` is what was typed before the listing changed under the field.
 */
export function RenameField({
  name,
  isDir,
  draft,
  onDraft,
  onDone,
  className,
}: {
  name: string;
  isDir: boolean;
  draft?: string;
  onDraft?: (text: string) => void;
  /** `value` is the new name, or null to leave it; `refocus` is whether the keyboard goes back to the list. */
  onDone: (value: string | null, refocus: boolean) => void;
  className?: string;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement | null>(null);
  const [first] = useState(draft);
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    const dot = !isDir && name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : name.length;
    el.focus();
    if (first != null) el.setSelectionRange(first.length, first.length);
    else el.setSelectionRange(0, dot);
  }, [name, isDir, first]);
  return (
    <input
      ref={input}
      defaultValue={first ?? name}
      spellCheck={false}
      aria-label={t('m.rename')}
      className={cn('h-[20px] min-w-[60px] rounded-[3px] bg-pane px-[3px] dark:bg-background text-fg shadow-[0_0_0_1px_var(--tint),0_0_0_3.5px_var(--tint-soft)] outline-none', className)}
      onChange={(e) => onDraft?.(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onDone(e.currentTarget.value, true);
        else if (e.key === 'Escape') onDone(null, true);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onBlur={(e) => onDone(e.currentTarget.value, false)}
    />
  );
}
