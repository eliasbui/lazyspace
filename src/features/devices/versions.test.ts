import { describe, expect, it } from 'vitest';
import { compareVersions } from './versions';

describe('compareVersions', () => {
  it('compares numbers as numbers', () => {
    expect(compareVersions('1.10', '1.9')).toBe(1);
    expect(compareVersions('1.9', '1.10')).toBe(-1);
    expect(compareVersions('2.0', '2.0')).toBe(0);
  });

  it('takes a missing part as 0', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.1', '1.2')).toBe(1);
  });

  it('compares words as words', () => {
    expect(compareVersions('1.0 beta', '1.0 alpha')).toBe(1);
  });
});
