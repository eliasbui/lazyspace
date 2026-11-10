// Full Disk Access, asked for once (the old page's parts/18-access.js). Without it macOS asks, folder by folder, whether
// LazySpace may read the Desktop, Documents and Downloads, external and network drives; with it nothing more is asked, and
// as every build is signed with the same certificate it holds across updates. macOS never offers it in a dialog of its
// own: the window explains it once and opens the pane in System Settings.
//
// The reduce-transparency, increase-contrast and reduce-motion classes of the root come from `app.hello` (paintRoot in
// src/lib/app-state.ts); this feature has nothing to add to them.
import { t } from '@/i18n';
import { registry } from '@/lib/registry';
import { confirm, say, toast } from '@/lib/ui';
import { api, on } from '@/services';

// "Later" is the page's own memory: the host's settings refuse a key they do not know (protocol.ts, Settings).
const LATER = 'lazyspace.fullDiskLater';

function putOff(): void {
  try {
    localStorage.setItem(LATER, '1');
  } catch {
    // A page without storage asks again next time, which is what the old page did.
  }
}

function putOffBefore(): boolean {
  try {
    return localStorage.getItem(LATER) === '1';
  } catch {
    return false;
  }
}

// A host that cannot tell is taken as granted, so the question never comes without a reason.
const granted = (): Promise<boolean> => api.native.fullDisk().then(
  (d) => d.granted,
  () => true,
);

let waiting = false;

/** Explains Full Disk Access and opens its pane; asked at the start until it is given or put off. */
async function ask(): Promise<void> {
  if (await granted()) return toast(t('fullDiskDone'));
  if (!(await confirm(t('fullDiskTitle'), t('fullDiskText'), t('fullDiskOpen')))) return putOff();
  await api.native.openFullDisk().catch(say);
  waiting = true;
}

export function register(): void {
  registry.actions.set('fullDiskAccess', () => ask());
  // Back from System Settings: macOS gives the access to the next launch of the app.
  window.addEventListener('focus', () => {
    if (!waiting) return;
    waiting = false;
    void granted().then((yes) => toast(t(yes ? 'fullDiskDone' : 'fullDiskReopen')));
  });
  on('app.hello', (hello) => {
    if (hello.windowRole !== 'main' || putOffBefore()) return;
    // After the window has drawn, so the question comes over a window that is there.
    setTimeout(() => {
      void granted().then((yes) => {
        if (!yes) void ask();
      });
    }, 1500);
  });
}
