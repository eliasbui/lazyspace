import { describe, expect, it } from 'vitest';
import { remember } from './closed-tabs';
import { keysOf, matches } from './list';

describe('closed tabs', () => {
  it('keeps the last twenty', () => {
    const many = Array.from({ length: 25 }, (_, i) => `file:///${i}`);
    expect(remember([], many)).toHaveLength(20);
    expect(remember([], many).at(-1)).toBe('file:///24');
  });
});

describe('palette', () => {
  it('matches words without accents, in any order', () => {
    expect(matches('Thư mục mới New Folder newFolder', 'thu muc moi')).toBe(true);
    expect(matches('Thư mục mới New Folder newFolder', 'folder new')).toBe(true);
    expect(matches('Thư mục mới New Folder newFolder', 'trash')).toBe(false);
  });

  it('writes the keys as a person reads them', () => {
    const word = (key: string) => ({ 'key.Alt': 'Option', 'key.ArrowUp': 'Up' })[key] ?? key;
    expect(keysOf('enclosing', { 'Cmd+ArrowUp': 'enclosing', 'Cmd+Alt+C': 'copyPath' }, 'mac', word)).toEqual(['Cmd+Up']);
    expect(keysOf('copyPath', { 'Cmd+Alt+C': 'copyPath' }, 'mac', word)).toEqual(['Cmd+Option+C']);
    expect(keysOf('copyPath', { 'Cmd+Alt+C': 'copyPath' }, 'windows', word)).toEqual(['Cmd+Alt+C']);
  });
});
