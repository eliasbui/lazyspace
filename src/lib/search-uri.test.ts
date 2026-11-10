import { describe, expect, it } from 'vitest';
import { isSearch, searchFolder, searchQuery, searchUri } from './search-uri';

describe('search URIs', () => {
  it('keeps the words, the filters and the folder through a round trip', () => {
    const uri = searchUri({ q: 'a&b=c d', kind: 'image', content: '1', tag: '', from: '/Users/me' }, '/Users/me/My Files');
    expect(isSearch(uri)).toBe(true);
    expect(searchQuery(uri)).toEqual({ q: 'a&b=c d', kind: 'image', content: '1', from: '/Users/me' });
    expect(searchFolder(uri)).toBe('/Users/me/My Files');
  });

  it('searches the whole Mac without a folder', () => {
    const uri = searchUri({ tag: 'Red' }, '');
    expect(searchFolder(uri)).toBe('/');
    expect(searchQuery(uri)).toEqual({ tag: 'Red' });
  });

  it('tells a search from another place', () => {
    expect(isSearch('file:///Users/me')).toBe(false);
    expect(isSearch(null)).toBe(false);
  });
});
