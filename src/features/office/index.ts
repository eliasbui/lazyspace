// Word, Excel and PowerPoint in the context menu of their documents, when they are on this Mac (ui/parts/81-office.js).
// A document in the folder of OneDrive's app (or of another cloud's app) opened there is edited in place: Office saves it
// where it is, and the cloud's app sends each change up, so co-workers see it as on the web.
import { t, type WordKey } from '@/i18n';
import { registry, type MenuCtx } from '@/lib/registry';
import { say, toast } from '@/lib/ui';
import { isLocal } from '@/lib/uri';
import { api, on, type Methods } from '@/services';

type OfficeApps = Methods['native.office_apps']['result'];
type AppKey = keyof OfficeApps;

const APPS: ReadonlyArray<[app: AppKey, label: WordKey, exts: readonly string[]]> = [
  ['word', 'openInWord', ['doc', 'docx', 'docm', 'dot', 'dotx', 'rtf', 'odt']],
  ['excel', 'openInExcel', ['xls', 'xlsx', 'xlsm', 'xlsb', 'xlt', 'xltx', 'csv', 'ods']],
  ['powerpoint', 'openInPowerPoint', ['ppt', 'pptx', 'pptm', 'pot', 'potx', 'pps', 'ppsx', 'odp']],
];

let paths: OfficeApps = { word: null, excel: null, powerpoint: null };
const load = () =>
  api.native.officeApps().then(
    (found) => void (paths = found),
    () => undefined,
  );

const ext = (name: string): string => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '');

/** The one app every selected file opens in, with the app's path, or null. */
function appOf(ctx: MenuCtx): { label: WordKey; path: string } | null {
  if (!ctx.count || !ctx.entries.length || ctx.entries.some((e) => e.isDir || !isLocal(e.uri))) return null;
  const found = APPS.find(([, , exts]) => ctx.entries.every((e) => exts.includes(ext(e.name))));
  const path = found ? paths[found[0]] : null;
  return found && path ? { label: found[1], path } : null;
}

const inCloud = (ctx: MenuCtx): boolean => ctx.entries.every((e) => /\/Library\/CloudStorage\//.test(decodeURIComponent(e.uri)));

export function register(): void {
  on('app.hello', () => void load());
  // An app installed while LazySpace runs is found when the window comes forward.
  window.addEventListener('focus', () => void load());

  registry.menu.add({
    id: 'openInOffice',
    label: (ctx) => t(appOf(ctx)?.label ?? 'openInWord'),
    icon: 'doc.richtext',
    group: 10,
    order: 1.5,
    when: (ctx) => !!appOf(ctx),
    run: (ctx) => {
      const app = appOf(ctx);
      if (!app) return;
      api.native
        .openWith({ uris: ctx.entries.map((e) => e.uri), app: app.path })
        .then(() => inCloud(ctx) && toast(t('officeSyncs')))
        .catch(say);
    },
  });
}
