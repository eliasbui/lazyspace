import { describe, expect, it } from 'vitest';
import { folders } from './viewer';

describe('reveal', () => {
  it('groups items by their folder, in the order met', () => {
    const out = folders(['file:///Users/me/a.txt', 'file:///Users/me/Pictures', 'file:///Users/me/b%20c.txt', 'file:///etc']);
    expect([...out.entries()]).toEqual([
      ['file:///Users/me', ['a.txt', 'Pictures', 'b c.txt']],
      ['file:///', ['etc']],
    ]);
  });

  it('opens the top of a disk as itself', () => {
    expect([...folders(['file:///']).entries()]).toEqual([['file:///', []]]);
  });
});
