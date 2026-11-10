import { describe, expect, it } from 'vitest';
import { chord, KEYMAPS } from './keymaps';

const key = (code: string, k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  code,
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('chord', () => {
  it('names letters and digits by their place, modifiers in a fixed order', () => {
    expect(chord(key('KeyN', 'N', { metaKey: true, shiftKey: true }))).toBe('Cmd+Shift+N');
    expect(chord(key('Digit1', '!', { ctrlKey: true, altKey: true, metaKey: true }))).toBe('Cmd+Ctrl+Alt+1');
  });

  it('reads punctuation by its place, so Shift+. stays a dot', () => {
    expect(chord(key('Period', '>', { metaKey: true, shiftKey: true }))).toBe('Cmd+Shift+.');
    expect(chord(key('Backslash', '\\', { metaKey: true }))).toBe('Cmd+\\');
  });

  it('names the space bar and keeps other keys as they are', () => {
    expect(chord(key('Space', ' '))).toBe('Space');
    expect(chord(key('ArrowUp', 'ArrowUp', { metaKey: true }))).toBe('Cmd+ArrowUp');
    expect(chord(key('NumpadEnter', 'Enter'))).toBe('Enter');
  });

  it('finds the actions of both keymaps', () => {
    expect(KEYMAPS.mac['Cmd+Shift+.']).toBe('toggleHidden');
    expect(KEYMAPS.windows.F2).toBe('rename');
  });
});
