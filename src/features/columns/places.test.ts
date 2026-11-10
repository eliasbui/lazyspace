import { describe, expect, it } from 'vitest';
import { above } from './places';

const home = 'file:///Users/me';

describe('the folders of the column view', () => {
  it('starts from the home folder for a folder in it', () => {
    expect(above('file:///Users/me/Documents/Work', home)).toEqual(['file:///Users/me', 'file:///Users/me/Documents']);
    expect(above(home, home)).toEqual([]);
  });

  it('starts from the disk elsewhere', () => {
    expect(above('file:///Applications/Utilities', home)).toEqual(['file:///', 'file:///Applications']);
    expect(above('file:///', home)).toEqual([]);
  });

  it('starts from the top of an archive', () => {
    expect(above('archive:///Users/me/a.zip!/x/y', home)).toEqual(['archive:///Users/me/a.zip!', 'archive:///Users/me/a.zip!/x']);
  });

  it('has none for a search', () => {
    expect(above('search://q%3Da/Users/me', home)).toEqual([]);
  });
});
