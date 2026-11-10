import type { ReactNode } from 'react';
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { cn } from '@/lib/utils';

export interface SegmentOption<V extends string> {
  value: V;
  label?: string;
  icon?: ReactNode;
  /** Words for a segment that shows only a symbol. */
  title?: string;
}

/** One choice out of a few, as a segmented control: the chosen segment is raised like a lit pebble. */
export function Segmented<V extends string>({ value, options, onChange, label, className }: { value: V; options: SegmentOption<V>[]; onChange: (value: V) => void; label: string; className?: string }) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (typeof next === 'string') onChange(next as V);
      }}
      className={cn('inline-flex h-7 items-center gap-0.5 rounded-full bg-field p-0.5', className)}
    >
      {options.map((o) => (
        <ToggleButton
          key={o.value}
          id={o.value}
          aria-label={o.title ?? o.label}
          className="flex h-6 min-w-8 items-center justify-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-fg-2 transition-all duration-200 outline-none data-focus-visible:ring-2 data-focus-visible:ring-ring data-selected:gl data-selected:text-fg"
        >
          {o.icon}
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
