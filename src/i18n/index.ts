// The words of the window in both languages. Keys are typed: Vietnamese and English must hold exactly the same ones, which
// the two `satisfies` below check at compile time and src/architecture.test.ts at run time.
import { create } from 'zustand';
import { en, vi } from './words';

export type Lang = 'vi' | 'en';
export type WordKey = keyof typeof vi;

export const dictionaries = {
  vi: vi satisfies Record<keyof typeof en, string>,
  en: en satisfies Record<keyof typeof vi, string>,
} as const;

interface I18nState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const useI18n = create<I18nState>((set) => ({ lang: 'vi', setLang: (lang) => set({ lang }) }));

/** Whether `key` is one the dictionaries hold; for a key that is built at run time. */
export function isWordKey(key: string): key is WordKey {
  return key in dictionaries.vi;
}

/** The words for `key` in `lang`, with `{0}`, `{1}` replaced by `args`. */
export function translate(lang: Lang, key: WordKey, args: readonly (string | number)[] = []): string {
  const text: string = dictionaries[lang][key];
  return args.length ? text.replace(/\{(\d+)\}/g, (whole, n: string) => String(args[Number(n)] ?? whole)) : text;
}

/** The words in the language now; use `useT` in a component so it draws again when the language changes. */
export function t(key: WordKey, ...args: (string | number)[]): string {
  return translate(useI18n.getState().lang, key, args);
}

/** A `t` that makes its component follow the language. */
export function useT(): (key: WordKey, ...args: (string | number)[]) => string {
  const lang = useI18n((s) => s.lang);
  return (key, ...args) => translate(lang, key, args);
}

export function setLanguage(lang: string): void {
  useI18n.getState().setLang(lang === 'en' ? 'en' : 'vi');
}
