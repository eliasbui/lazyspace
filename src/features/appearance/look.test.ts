import { describe, expect, it } from 'vitest';
import { fontValue, stepIconSize } from './look';

describe('appearance', () => {
  it('steps the icon size within the sizes there are', () => {
    expect(stepIconSize(64, 1)).toBe(96);
    expect(stepIconSize(64, -1)).toBe(48);
    expect(stepIconSize(128, 1)).toBe(128);
    expect(stepIconSize(48, -1)).toBe(48);
  });

  it('writes a design keyword bare and a family quoted', () => {
    expect(fontValue('ui-rounded')).toBe('ui-rounded, -apple-system, BlinkMacSystemFont, system-ui, sans-serif');
    expect(fontValue('Avenir "Next"')).toBe('"Avenir \\"Next\\"", -apple-system, BlinkMacSystemFont, system-ui, sans-serif');
  });
});
