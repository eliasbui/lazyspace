import { describe, expect, it } from 'vitest';
import { duration, rate } from './format';

describe('preview format', () => {
  it('writes a length as a clock', () => {
    expect(duration(0)).toBe('0:00');
    expect(duration(245.4)).toBe('4:05');
    expect(duration(3729)).toBe('1:02:09');
  });

  it('writes a data rate in Mbit/s from a million and in kbit/s below', () => {
    expect(rate(4_230_000, 'en')).toBe('4.2 Mbit/s');
    expect(rate(4_230_000, 'vi')).toBe('4,2 Mbit/s');
    expect(rate(320_400, 'en')).toBe('320 kbit/s');
  });
});
