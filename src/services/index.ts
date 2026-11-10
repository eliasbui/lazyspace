// The only door of the page to the host: the UI imports from '@/services' and nowhere else.
export * as api from './api';
export { call, on, onAny, messageOf } from './client';
export { getHost } from './host';
export type { Host } from './host';
export { iconUrl, symbolUrl, thumbUrl, fileUrl, pixelRatio } from './assets';
export type * from './protocol';
