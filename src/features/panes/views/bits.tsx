// What a row and a cell of icons share: the picture of an item, its Finder tags, its letter of git, and the field that
// renames it in place.
import { useLayoutEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { Row } from '@/services';
import type { Pane } from '../pane';
import { entryIcon, entryThumb } from '../places';

/** The item's thumbnail when Quick Look makes one, else its icon; a thumbnail that fails gives way to the icon. */
export function Picture({ entry, points, className, thumbClass }: { entry: Row; points: number; className?: string; thumbClass?: string }) {
  const thumb = entryThumb(entry, points);
  const [failed, setFailed] = useState<string | null>(null);
  const useThumb = !!thumb && failed !== thumb;
  return (
    <img
      data-hit
      src={useThumb ? thumb : entryIcon(entry, points)}
      alt=""
      draggable={false}
      className={cn('flex-none object-contain', useThumb && thumbClass, className)}
      style={{ maxWidth: points, maxHeight: points }}
      onError={useThumb ? () => setFailed(thumb) : undefined}
    />
  );
}

// Finder's tag numbers: 1 grey, 2 green, 3 purple, 4 blue, 5 yellow, 6 red, 7 orange; 0 has no colour of its own.
const TAG_COLOURS = ['bg-transparent ring-fg-2', 'bg-mark-gray', 'bg-mark-green', 'bg-mark-purple', 'bg-mark-blue', 'bg-mark-yellow', 'bg-mark-red', 'bg-mark-orange'];

/** Finder's tags of an item as dots of their colours, after its name as Finder draws them. */
export function TagDots({ entry, className }: { entry: Row; className?: string }) {
  if (!entry.tags?.length) return null;
  return (
    <span className={cn('inline-flex flex-none align-middle', className)}>
      {entry.tags.slice(0, 3).map(([name, colour], k) => (
        <i key={`${name}:${k}`} title={name} className={cn('size-[9px] rounded-full ring-1 ring-pane', k > 0 && '-ml-[3px]', TAG_COLOURS[Number(colour) || 0])} />
      ))}
    </span>
  );
}

const MARK_TONES: Record<string, string> = {
  M: 'bg-warn/15 text-warn',
  A: 'bg-good/15 text-good',
  '?': 'bg-good/15 text-good',
  D: 'bg-bad/15 text-bad',
  R: 'bg-tint/15 text-tint',
  U: 'bg-bad text-primary-foreground',
};

/** The letter git gives an item, as the editors write them: a new file U, a conflict C. */
export function GitMark({ mark, strong }: { mark: string | undefined; strong: boolean }) {
  if (!mark) return null;
  return (
    <em className={cn('ml-auto flex-none rounded-[4px] px-[5px] font-mono text-[10px] leading-[16px] font-semibold not-italic', strong ? 'bg-primary-foreground/20 text-primary-foreground' : (MARK_TONES[mark] ?? 'bg-field text-fg-2'))}>
      {{ '?': 'U', U: 'C' }[mark] ?? mark}
    </em>
  );
}

/** The name as a field with the part before the extension selected: Return renames, Escape leaves it as it was. */
export function RenameField({ pane, entry, className }: { pane: Pane; entry: Row; className?: string }) {
  const t = useT();
  const input = useRef<HTMLInputElement | null>(null);
  const [draft] = useState(pane.renaming?.draft);
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    const name = entry.name;
    const dot = !entry.isDir && name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : name.length;
    el.focus();
    if (draft != null) el.setSelectionRange(draft.length, draft.length);
    else el.setSelectionRange(0, dot);
  }, [entry, draft]);
  return (
    <input
      ref={input}
      defaultValue={draft ?? entry.name}
      spellCheck={false}
      aria-label={t('m.rename')}
      className={cn('h-[20px] min-w-[60px] rounded-[3px] bg-pane px-[3px] dark:bg-background text-fg shadow-[0_0_0_1px_var(--tint),0_0_0_3.5px_var(--tint-soft)] outline-none', className)}
      onChange={(e) => {
        if (pane.renaming) pane.renaming.draft = e.currentTarget.value;
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') pane.finishRename(e.currentTarget.value, true);
        else if (e.key === 'Escape') pane.finishRename(null, true);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onBlur={(e) => pane.finishRename(e.currentTarget.value, false)}
    />
  );
}
