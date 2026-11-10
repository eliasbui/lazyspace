import type { ReactNode } from 'react';
import { InfoIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type ButtonProps = React.ComponentProps<typeof Button>;

/** A symbol button whose words are its tooltip and its accessible name: a button never repeats its own name in text. */
export function IconButton({ label, icon, className, size = 'icon', variant = 'ghost', ...props }: Omit<ButtonProps, 'children' | 'aria-label'> & { label: string; icon: ReactNode }) {
  const button = (
    <Button aria-label={label} size={size} variant={variant} className={className} {...props}>
      {icon}
    </Button>
  );
  // A disabled button is not focusable, so React Aria warns when a tooltip trigger wraps it; it needs no tooltip either.
  if (props.isDisabled) return button;
  return (
    <TooltipTrigger>
      {button}
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}

/** The words of something that has no room for them, as a tooltip on whatever is passed. */
export function Tip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <TooltipTrigger>
      {children}
      <Tooltip>{text}</Tooltip>
    </TooltipTrigger>
  );
}

/** The "i" beside a name: what a row would say in words, kept out of the way until it is asked for. */
export function InfoTip({ text, label, className }: { text: string; label: string; className?: string }) {
  return (
    <PopoverTrigger>
      <Button aria-label={label} variant="ghost" size="icon-xs" className={cn('text-fg-3 hover:text-fg-2', className)}>
        <InfoIcon weight="regular" />
      </Button>
      <Popover placement="bottom start" className="w-64 text-[12px] leading-snug text-fg-2">
        {text}
      </Popover>
    </PopoverTrigger>
  );
}
