import { beforeEach, describe, expect, it } from 'vitest';
import { addRule, fresh, moveRule, numberOf, oneOf, payload, removeRule, setRule, useRules } from './rules';

describe('batch rename rules', () => {
  beforeEach(() => useRules.setState({ rules: [fresh('replace')] }));

  it('sends an empty extension and no case as "keep"', () => {
    expect(payload([{ type: 'ext', set: '', case: null }])).toEqual([{ type: 'ext', set: null, case: null }]);
    expect(payload([{ type: 'ext', set: 'jpg', case: 'lower' }])).toEqual([{ type: 'ext', set: 'jpg', case: 'lower' }]);
    expect(payload([fresh('number')])).toEqual([fresh('number')]);
  });

  it('gives each new rule its own copy of the defaults', () => {
    const a = fresh('replace');
    a.find = 'x';
    expect(fresh('replace').find).toBe('');
  });

  it('adds a Number rule, moves rules and keeps one when the last is removed', () => {
    addRule();
    expect(useRules.getState().rules.map((r) => r.type)).toEqual(['replace', 'number']);
    moveRule(1, -1);
    expect(useRules.getState().rules.map((r) => r.type)).toEqual(['number', 'replace']);
    moveRule(0, -1);
    expect(useRules.getState().rules.map((r) => r.type)).toEqual(['number', 'replace']);
    setRule(1, fresh('case'));
    removeRule(0);
    removeRule(0);
    expect(useRules.getState().rules).toEqual([fresh('replace')]);
  });

  it('reads selects and number fields', () => {
    expect(oneOf(['start', 'end'] as const, 'end')).toBe('end');
    expect(oneOf(['start', 'end'] as const, 'nope')).toBe('start');
    expect(numberOf('12')).toBe(12);
    expect(numberOf('')).toBe(0);
    expect(numberOf('x')).toBe(0);
  });
});
