// The Enhanced Archiver: an archive opens as a folder (read only), "Extract Here" and "Extract To" take it out beside it
// or anywhere, items inside it are extracted where you choose, and "Compress" makes a zip, 7z or tar archive. An archive
// that wants a password asks for it. The side preview lists what an archive holds.
import { t } from '@/i18n';
import { panes } from '@/lib/panes-api';
import { openSheet, registry, type MenuCtx } from '@/lib/registry';
import { prompt, say } from '@/lib/ui';
import { archiveUri, fileUri, isLocal, nameOf, pathOf } from '@/lib/uri';
import { api, on, type Uri } from '@/services';
import { ArchivePreview } from './ArchivePreview';
import { compressBatch, CompressSheet, type CompressProps } from './CompressSheet';
import { inArchive, isArchive } from './kinds';

const PASSWORD = 'LZ-PASSWORD:';

const chooseFolder = (): Promise<Uri | null> => api.settings.chooseFolder({ prompt: t('chooseExtractFolder') }).then((path) => (path ? fileUri(path) : null));

function extract(ctx: MenuCtx, to: Uri | null): void {
  const uris = ctx.entries.filter(isArchive).map((e) => e.uri);
  if (uris.length) api.archive.extract({ uris, to }).catch(say);
}

/** A folder of an archive that wants a password: ask, then list it again. */
async function askPassword(view: string, error: string): Promise<void> {
  if (!error.startsWith(PASSWORD)) return;
  const found = panes.findTab(view);
  if (!found || !inArchive(found.tab.uri)) return;
  const { pane } = found;
  const uri = found.tab.uri;
  const password = await prompt(t('archivePasswordTitle'), { text: error.slice(PASSWORD.length), secret: true, ok: t('ok') });
  if (password == null) return;
  api.archive.password({ uri, password }).then(() => pane.refresh(), say);
}

export function register(): void {
  // The top of an archive is called by the archive's name, without the "!" its address ends in.
  registry.places.name('archive', (uri) => nameOf(uri).replace(/!$/, ''));
  registry.vfs.opener((row) => (isArchive(row) ? archiveUri(pathOf(row.uri), '') : null));
  registry.preview.register({ id: 'archive', match: isArchive, Component: ArchivePreview });
  registry.sheets.register<CompressProps | undefined>({ id: 'compressSheet', Component: CompressSheet });
  on('view.error', (d) => void askPassword(d.view, d.error));

  const archives = (c: MenuCtx) => c.count > 0 && c.entries.some(isArchive);
  registry.menu.add({ id: 'extractHere', label: 'extractHere', icon: 'archivebox', group: 45, order: 1, when: archives, run: (c) => extract(c, null) });
  registry.menu.add({
    id: 'extractTo',
    label: 'extractTo',
    icon: 'archivebox.circle',
    group: 45,
    order: 2,
    when: archives,
    run: async (c) => {
      const to = await chooseFolder().catch((error: unknown) => void say(error));
      if (to) extract(c, to);
    },
  });
  registry.menu.add({
    id: 'compress',
    label: 'compress',
    icon: 'shippingbox',
    group: 45,
    order: 3,
    when: (c) => c.count > 0 && isLocal(c.tab.uri),
    run: (c) => {
      const batch = compressBatch(c.tab, c.entries, c.count);
      if (batch) openSheet<CompressProps>('compressSheet', batch);
    },
  });
  registry.menu.add({
    id: 'extractSelected',
    label: 'extractSelected',
    icon: 'square.and.arrow.down',
    group: 45,
    order: 4,
    when: (c) => c.count > 0 && inArchive(c.tab.uri),
    run: async (c) => {
      const to = await chooseFolder().catch((error: unknown) => void say(error));
      if (to) api.fs.copy({ from: c.entries.map((e) => e.uri), to, mode: 'copy' }).catch(say);
    },
  });
}
