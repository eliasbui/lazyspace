import type { Language } from '../protocol';

let language: Language = 'vi';

export function setLanguage(next: Language): void {
  language = next;
}

/** The text in the language of the settings, as the host's `tr`. */
export function tr(vi: string, en: string): string {
  return language === 'en' ? en : vi;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A small deterministic generator, so the mock shows the same files on every load. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** A hex string of `length` characters, always the same for the same text and salt. */
export function hexOf(text: string, length: number): string {
  let out = '';
  for (let i = 0; out.length < length; i++) out += hashOf(`${text}:${i}`).toString(16).padStart(8, '0');
  return out.slice(0, length);
}

/** Compares names as Finder does: case aside, and runs of digits by their value. */
export function natural(a: string, b: string): number {
  const x = a.toLowerCase().match(/\d+|\D+/g) ?? [];
  const y = b.toLowerCase().match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const p = x[i] ?? '';
    const q = y[i] ?? '';
    if (/^\d/.test(p) && /^\d/.test(q)) {
      const d = Number(p) - Number(q);
      if (d !== 0) return d;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return x.length - y.length;
}

/** The text of a name as comparisons use it: lower case, composed. */
export function fold(text: string): string {
  return text.normalize('NFC').toLowerCase();
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A copy through JSON, which is what the wire does to an answer or an event. */
export function wire<T>(value: T): T {
  return value === undefined ? (null as T) : (JSON.parse(JSON.stringify(value)) as T);
}
