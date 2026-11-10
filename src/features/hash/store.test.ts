import { describe, expect, it } from 'vitest';
import type { HashResult } from '@/services';
import { matchOf, normalHash } from './store';

const result = (name: string, md5: string, sha256: string): HashResult => ({
  uri: `file:///tmp/${name}`,
  name,
  size: 1,
  hashes: { md5, sha1: 'a1', sha224: 'a224', sha256, sha384: 'a384', sha512: 'a512', crc32: 'c32' },
});

describe('hash compare', () => {
  it('reads a pasted hash without case, spaces, colons or dashes', () => {
    expect(normalHash(' AB:CD-ef 12 ')).toBe('abcdef12');
  });

  it('finds the algorithm and the file a hash belongs to', () => {
    const results = [result('a.txt', 'm1', 's1'), result('b.txt', 'm2', 's2')];
    expect(matchOf(results, 's2')).toEqual(['SHA-256', 'b.txt']);
    expect(matchOf(results, 'm1')).toEqual(['MD5', 'a.txt']);
    expect(matchOf(results, 'zz')).toBeNull();
  });
});
