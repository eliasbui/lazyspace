// The rules of a batch rename, applied in order by the app (rename.preview, rename.apply). They stay for the next batch
// of the session.
import { create } from 'zustand';
import type { RenameRule } from '@/services';

export type RuleType = RenameRule['type'];
export type RuleOf<K extends RuleType> = Extract<RenameRule, { type: K }>;

export const TYPES: readonly RuleType[] = ['replace', 'insert', 'remove', 'number', 'parent', 'case', 'ext'];

const DEFAULTS: { [K in RuleType]: RuleOf<K> } = {
  replace: { type: 'replace', find: '', with: '', regex: false, caseInsensitive: false, scope: 'name' },
  insert: { type: 'insert', text: '', at: 'end', index: 0 },
  remove: { type: 'remove', from: 0, count: 1, fromEnd: false },
  number: { type: 'number', start: 1, step: 1, pad: 2, at: 'end', sep: ' ' },
  parent: { type: 'parent', at: 'start', sep: ' ' },
  case: { type: 'case', mode: 'lower' },
  ext: { type: 'ext', set: null, case: null },
};

export const fresh = <K extends RuleType>(type: K): RuleOf<K> => ({ ...DEFAULTS[type] });

/** The rules as the app takes them: an empty new extension, or no case for it, means "keep". */
export const payload = (rules: readonly RenameRule[]): RenameRule[] => rules.map((r) => (r.type === 'ext' ? { ...r, set: r.set || null, case: r.case || null } : r));

/** The one of `values` that `value` is, or the first; for what a select or a field gives back. */
export const oneOf = <T extends string>(values: readonly T[], value: string): T => values.find((v) => v === value) ?? values[0];

/** A number typed in a field; what is not one counts as 0. */
export const numberOf = (value: string): number => Number(value) || 0;

export const useRules = create<{ rules: RenameRule[] }>(() => ({ rules: [fresh('replace')] }));

export function setRule(index: number, rule: RenameRule): void {
  useRules.setState((s) => ({ rules: s.rules.map((r, i) => (i === index ? rule : r)) }));
}

export function addRule(): void {
  useRules.setState((s) => ({ rules: [...s.rules, fresh('number')] }));
}

/** Swaps the rule at `index` with the one before (-1) or after (+1) it. */
export function moveRule(index: number, by: -1 | 1): void {
  useRules.setState((s) => {
    const j = index + by;
    if (j < 0 || j >= s.rules.length) return s;
    const rules = [...s.rules];
    [rules[index], rules[j]] = [rules[j], rules[index]];
    return { rules };
  });
}

/** Removes a rule; the last one gone leaves an empty Replace, so there is always one to fill in. */
export function removeRule(index: number): void {
  useRules.setState((s) => {
    const rules = s.rules.filter((_, i) => i !== index);
    return { rules: rules.length ? rules : [fresh('replace')] };
  });
}
