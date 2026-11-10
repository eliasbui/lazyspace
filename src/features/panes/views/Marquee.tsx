import type { Box } from '../pane';

/** The frame a drag beside the items draws to select what it covers. */
export function Marquee({ box }: { box: Box }) {
  return <div className="pointer-events-none absolute z-10 rounded-[3px] border border-tint/75 bg-tint/15" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />;
}
