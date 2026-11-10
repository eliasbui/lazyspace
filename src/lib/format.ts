// Sizes, dates and counts as Finder writes them.
import { t, useI18n, type Lang } from '@/i18n';

const locale = (lang: Lang): string => (lang === 'vi' ? 'vi-VN' : 'en-US');

const dateFormats = new Map<string, { time: Intl.DateTimeFormat; day: Intl.DateTimeFormat }>();

/** A date in seconds since 1970: "Today, 09:41", "Yesterday, 18:02", or the day. */
export function fmtDate(seconds: number | null | undefined, now: Date = new Date()): string {
  if (!seconds) return '--';
  const key = locale(useI18n.getState().lang);
  let f = dateFormats.get(key);
  if (!f) {
    f = {
      time: new Intl.DateTimeFormat(key, { hour: '2-digit', minute: '2-digit' }),
      day: new Intl.DateTimeFormat(key, { day: 'numeric', month: 'short', year: 'numeric' }),
    };
    dateFormats.set(key, f);
  }
  const d = new Date(seconds * 1000);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const diff = (start.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86400000;
  const day = diff === 0 ? t('today') : diff === 1 ? t('yesterday') : f.day.format(d);
  return `${day}, ${f.time.format(d)}`;
}

/** Sizes as Finder writes them: in thousands, one decimal under ten. */
export function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null) return '--';
  if (bytes < 1000) return t('bytes', bytes);
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value.toLocaleString(locale(useI18n.getState().lang), { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

/** The device pixel ratio the pictures are asked at, 1 to 3. */
export const pixelRatio = (): number => Math.min(3, Math.max(1, Math.round(typeof window === 'undefined' ? 2 : window.devicePixelRatio || 2)));

/** A text folded for matching: lower case, without Vietnamese accents, so "thu muc moi" finds "Thư mục mới". */
export const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
