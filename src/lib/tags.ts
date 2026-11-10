// Finder's colour tags (src-tauri/src/native/tags.rs): a tag is written with Finder's English name of its colour, and
// numbered 1 to 7 by it; any other tag keeps the name it was given.
import { t, type WordKey } from '@/i18n';

export const TAG_NAMES = ['', 'Gray', 'Green', 'Purple', 'Blue', 'Yellow', 'Red', 'Orange'] as const;
/** The colours in the order Finder lists them. */
export const TAG_ORDER = [6, 7, 5, 2, 4, 3, 1] as const;

const WORDS: Record<number, WordKey> = { 1: 'tag.1', 2: 'tag.2', 3: 'tag.3', 4: 'tag.4', 5: 'tag.5', 6: 'tag.6', 7: 'tag.7' };

/** The class that paints a dot in a tag's colour; 0 is a tag of no colour, drawn as a ring. */
export const TAG_DOT: Record<number, string> = {
  0: 'ring-1 ring-fg-3 ring-inset',
  1: 'bg-tag-1',
  2: 'bg-tag-2',
  3: 'bg-tag-3',
  4: 'bg-tag-4',
  5: 'bg-tag-5',
  6: 'bg-tag-6',
  7: 'bg-tag-7',
};

/** The colour a tag's name stands for, or -1 for a tag that is not one of Finder's colours. */
export const tagColour = (name: string): number => TAG_NAMES.findIndex((n, i) => i > 0 && n.toLowerCase() === name.toLowerCase());

export const tagWord = (colour: number): WordKey => WORDS[colour] ?? 'tag.1';

/** A tag's name as the user's language says it: Finder's colours by their colour, any other as it was named. */
export const tagLabel = (name: string): string => (tagColour(name) > 0 ? t(tagWord(tagColour(name))) : name);
