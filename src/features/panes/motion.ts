// The motion of items: they come in, slide to their new places, go out, take what is dropped on them. With the Web
// Animations API, which the stylesheet's reduced-motion rule does not reach, so Reduce Motion is asked here.
const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)';

const still = (): boolean =>
  document.documentElement.classList.contains('reduce-motion') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

function play(el: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (!el || still() || typeof el.animate !== 'function') return null;
  return el.animate(frames, { easing: SPRING, ...options });
}

const accent = (el: Element): string => getComputedStyle(el).getPropertyValue('--tint').trim() || 'currentColor';

export const Motion = {
  /** From where it was drawn (`dx`, `dy` away) to where it is now. */
  slide: (el: Element, dx: number, dy: number) => play(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 320 }),
  /** In, with a ring of the accent colour that fades after it. */
  arrive: (el: Element) => {
    const ring = `inset 0 0 0 2px ${accent(el)}`;
    return play(
      el,
      [
        { opacity: 0, transform: 'translateY(-6px) scale(0.97)', boxShadow: ring },
        { opacity: 1, transform: 'none', boxShadow: ring, offset: 0.45 },
        { boxShadow: 'inset 0 0 0 2px transparent' },
      ],
      { duration: 900 },
    );
  },
  /** Out of sight before the item itself goes; `fill` keeps it so until the listing without it is drawn. */
  leave: (el: Element, i: number) =>
    play(el, [{ opacity: 1 }, { opacity: 0, transform: 'translateX(-14px) scale(0.96)' }], { duration: 200, delay: Math.min(i, 12) * 14, fill: 'forwards' }),
  /** A folder, tab or place that took a drop. */
  take: (el: Element) => play(el, [{ transform: 'none' }, { transform: 'scale(1.045)', offset: 0.35 }, { transform: 'none' }], { duration: 420 }),
  /** Items copied or cut, as a short flash of the selection. */
  flash: (el: Element) => play(el, [{ filter: 'brightness(1)' }, { filter: 'brightness(1.6)', offset: 0.3 }, { filter: 'brightness(1)' }], { duration: 380, easing: 'ease-out' }),
};
