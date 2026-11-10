// The places of the tabs closed lately, for Reopen Closed Tab (the panes tell `tabClosed` when one closes).

/** The last places closed, the newest last; at most `max`. */
export function remember(stack: string[], closed: string[], max = 20): string[] {
  return [...stack, ...closed].slice(-max);
}
