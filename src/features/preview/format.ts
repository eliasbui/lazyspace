// The numbers of a film or a sound as the preview writes them.
import type { Lang } from '@/i18n';

/** A length in seconds as a clock: "4:05", "1:02:09". */
export function duration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** A data rate in bits per second: "4.2 Mbit/s" from a million up, "320 kbit/s" below. */
export function rate(bits: number, lang: Lang): string {
  if (bits >= 1e6) return `${(bits / 1e6).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 1 })} Mbit/s`;
  return `${Math.round(bits / 1e3)} kbit/s`;
}
