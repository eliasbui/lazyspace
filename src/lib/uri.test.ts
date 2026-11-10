import { describe, expect, it } from 'vitest';
import { archiveUri, authorityOf, fileUri, nameOf, parentOf, pathOf, samePlace, schemeOf, withPath } from './uri';

describe('uri helpers', () => {
  it('reads the path, name and scheme of a place', () => {
    expect(pathOf('file:///Users/me/a%20b.txt')).toBe('/Users/me/a b.txt');
    expect(nameOf('file:///Users/me/a%20b.txt')).toBe('a b.txt');
    expect(nameOf('file:///')).toBe('/');
    expect(schemeOf('sftp://u@h/p')).toBe('sftp');
    expect(authorityOf('s3://conn%201/bucket/key')).toBe('conn 1');
  });

  it('compares places by scheme, authority and path', () => {
    expect(samePlace('file:///a/b', 'file:///a/b')).toBe(true);
    expect(samePlace('file:///a/b', 'file:///a/c')).toBe(false);
    expect(samePlace('sftp://h1/a', 'sftp://h2/a')).toBe(false);
    expect(samePlace(null, 'file:///a')).toBe(false);
  });

  it('builds places and parents', () => {
    expect(fileUri('/Users/me/a b')).toBe('file:///Users/me/a%20b');
    expect(archiveUri('/x/a.zip', 'dir/b')).toBe('archive:///x/a.zip!/dir/b');
    expect(archiveUri('/x/a.zip', '')).toBe('archive:///x/a.zip!');
    expect(withPath('sftp://u@h/p', '/q')).toBe('sftp://u@h/q');
    expect(parentOf('file:///a/b')).toBe('file:///a');
    expect(parentOf('file:///a')).toBe('file:///');
    expect(parentOf('file:///')).toBeNull();
  });
});
