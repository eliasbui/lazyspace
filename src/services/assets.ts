import { getHost } from './host';

// The pictures the page draws. In the app they come from the `lazy://` protocol (src-tauri/src/protocol.rs); in a
// browser (the mock) they are small inline SVG pictures, so a page can be photographed without the app.

/** Device pixels per point, 1 to 3, as the old page chose it. Multiply a size in points by it for the `px` below. */
export function pixelRatio(): number {
  return Math.min(3, Math.max(1, Math.round(globalThis.devicePixelRatio || 2)));
}

/** The icon `key` names (`Entry.icon`: `ext:png`, `type:public.folder`, `path:/Applications/Mail.app`), `px` pixels wide. */
export function iconUrl(key: string, px: number): string {
  if (getHost().native) return `lazy://icon/${px}/${encodeURIComponent(key)}`;
  return svgUrl(iconSvg(key));
}

/** An SF Symbol. `weight` is a name such as "medium" or "semibold"; the page paints it as a mask in its own colour. */
export function symbolUrl(name: string, px: number, weight?: string): string {
  if (getHost().native) return `lazy://symbol/${px}/${weight ? `${encodeURIComponent(weight)}/` : ''}${encodeURIComponent(name)}`;
  return svgUrl(symbolSvg(name));
}

/** A Quick Look thumbnail of a local file in a folder the app has open; `path` is a path, not a URI. */
export function thumbUrl(path: string, px: number): string {
  if (getHost().native) return `lazy://thumb/${px}/${encodeURIComponent(path)}`;
  return svgUrl(pictureSvg(path));
}

/** The file itself, with ranges, for a preview; `path` is a path, not a URI. */
export function fileUrl(path: string): string {
  if (getHost().native) return `lazy://file/${encodeURIComponent(path)}`;
  return svgUrl(pictureSvg(path));
}

function svgUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function hue(text: string): number {
  let h = 0;
  for (const c of text) h = (h * 31 + (c.codePointAt(0) ?? 0)) % 360;
  return h;
}

const FOLDER =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M6 16a5 5 0 0 1 5-5h14l6 6h22a5 5 0 0 1 5 5v28a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5z" fill="#5aa9f0"/><path d="M6 24a5 5 0 0 1 5-5h42a5 5 0 0 1 5 5v25a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5z" fill="#7cc0f7"/></svg>';
const VOLUME =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="20" width="52" height="26" rx="6" fill="#b9bec6"/><rect x="6" y="20" width="52" height="12" rx="6" fill="#d7dbe0"/><circle cx="49" cy="39" r="3" fill="#6b7280"/></svg>';

function appSvg(key: string): string {
  const h = hue(key);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="13" fill="hsl(${h} 70% 55%)"/><rect x="6" y="6" width="52" height="26" rx="13" fill="hsl(${(h + 30) % 360} 80% 68%)" opacity=".55"/><circle cx="32" cy="32" r="11" fill="none" stroke="#fff" stroke-width="4"/></svg>`;
}

function documentSvg(ext: string): string {
  const label = ext.slice(0, 4).toUpperCase();
  const h = hue(ext);
  const text = label ? `<text x="32" y="48" font-family="sans-serif" font-size="11" font-weight="700" text-anchor="middle" fill="hsl(${h} 60% 42%)">${label}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M14 6h25l13 13v33a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6V12a6 6 0 0 1 6-6z" fill="#fff" stroke="#c4c8ce" stroke-width="2"/><path d="M39 6v13h13z" fill="#e3e6ea"/>${text}</svg>`;
}

function iconSvg(key: string): string {
  if (key.startsWith('ext:')) return documentSvg(key.slice(4));
  if (key.startsWith('path:')) {
    const path = key.slice(5);
    if (path.endsWith('.app')) return appSvg(path);
    if (path === '/' || path.startsWith('/Volumes')) return VOLUME;
    return FOLDER;
  }
  if (key === 'type:public.folder') return FOLDER;
  return documentSvg('');
}

// A photograph stand-in: a sky, a hill and a sun, coloured by the name.
function pictureSvg(path: string): string {
  const h = hue(path);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice"><rect width="160" height="120" fill="hsl(${h} 55% 72%)"/><circle cx="118" cy="34" r="14" fill="hsl(${(h + 40) % 360} 90% 82%)"/><path d="M0 120V80q30-30 62-6t98-14v60z" fill="hsl(${(h + 120) % 360} 40% 38%)"/></svg>`;
}

const GLYPHS: Record<string, string> = {
  'chevron.left': 'M15 5l-7 7 7 7',
  'chevron.right': 'M9 5l7 7-7 7',
  'chevron.down': 'M5 9l7 7 7-7',
  'chevron.up': 'M5 15l7-7 7 7',
  plus: 'M12 5v14M5 12h14',
  xmark: 'M6 6l12 12M18 6L6 18',
  magnifyingglass: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5L20 20',
  trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  house: 'M4 11l8-7 8 7M6 10v10h12V10',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  doc: 'M6 3h8l4 4v14H6zM14 3v4h4',
  'list.bullet': 'M9 7h11M9 12h11M9 17h11M4 7h1M4 12h1M4 17h1',
  ellipsis: 'M6 12h.01M12 12h.01M18 12h.01',
  'arrow.clockwise': 'M19 12a7 7 0 1 1-2.1-5M19 4v4h-4',
};

function symbolSvg(name: string): string {
  const key = Object.keys(GLYPHS).find((k) => name === k || name.startsWith(`${k}.`)) ?? '';
  const path = GLYPHS[key] ?? 'M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14z';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
}
