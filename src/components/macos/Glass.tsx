import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A pane of glass that floats: the sidebar, the toolbar capsules, a panel over the content. */
export function GlassPanel({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('glass rounded-panel', className)} {...props} />;
}

/** A group of controls in the toolbar, as macOS 26 groups them: one capsule of glass. */
export function Capsule({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('glass flex h-9 items-center gap-0.5 rounded-full px-1', className)} {...props} />;
}

/** Content: a pane a little lighter than the window, with a hairline. Never glass. */
export function ContentPane({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('pane rounded-card', className)} {...props} />;
}

/** A small label that states a state; the only other colour besides the accent. */
export function Pill({ tone = 'neutral', className, ...props }: ComponentProps<'span'> & { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'tint' }) {
  const tones = {
    neutral: 'bg-field text-fg-2',
    good: 'bg-good/15 text-good',
    warn: 'bg-warn/15 text-warn',
    bad: 'bg-bad/15 text-bad',
    tint: 'bg-tint-soft text-tint',
  } as const;
  return <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium', tones[tone], className)} {...props} />;
}
