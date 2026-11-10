import type { ReactNode } from 'react';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-[520px]', lg: 'sm:max-w-[760px]', xl: 'sm:max-w-[960px]' } as const;

/**
 * The frame of every sheet a feature opens: a title, a body, and the buttons. It is a modal of glass over the window.
 * `dismissable` false is a sheet that waits for an answer (a question of a job): Escape and a click beside it do nothing.
 */
export function SheetFrame({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  dismissable = true,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof widths;
  dismissable?: boolean;
  className?: string;
}) {
  return (
    <Dialog isOpen={open} onOpenChange={(next) => !next && onClose()} isDismissable={dismissable} isKeyboardDismissDisabled={!dismissable} showCloseButton={false} className={cn(widths[size], 'rounded-panel p-0', className)}>
      <div className="flex max-h-[min(80vh,720px)] flex-col">
        {title ? (
          <DialogHeader className="px-5 pt-4 pb-2">
            <DialogTitle className="text-[15px] font-semibold">{title}</DialogTitle>
          </DialogHeader>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">{children}</div>
        {footer ? <DialogFooter className="mx-0 mb-0 rounded-b-panel border-hair bg-transparent px-5 py-3">{footer}</DialogFooter> : null}
      </div>
    </Dialog>
  );
}
