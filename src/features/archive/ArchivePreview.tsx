// What an archive holds, in the side preview: its top level, listed by the app in a view of its own that closes with it.
import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { errorText } from '@/lib/ui';
import { archiveUri, pathOf } from '@/lib/uri';
import { api, iconUrl, on, pixelRatio, type Row } from '@/services';

/** The most rows shown; the count says how many there are. */
const SHOWN = 200;
let views = 0;

export function ArchivePreview({ row }: { row: Row }) {
  const t = useT();
  const [listing, setListing] = useState<{ rows: Row[]; count: number } | { error: string } | null>(null);

  useEffect(() => {
    const view = `preview-archive-${++views}`;
    let live = true;
    const fail = (error: unknown) => live && setListing({ error: errorText(error) });
    const offChanged = on('view.changed', (d) => {
      if (d.view !== view) return;
      if (!d.count) {
        if (live) setListing({ rows: [], count: 0 });
        return;
      }
      api.view.rows({ view, start: 0, count: Math.min(d.count, SHOWN), generation: d.generation }).then((r) => live && setListing({ rows: r.rows, count: d.count }), fail);
    });
    const offError = on('view.error', (d) => d.view === view && fail(d.error));
    setListing(null);
    api.fs.list({ view, uri: archiveUri(pathOf(row.uri), '') }).catch(fail);
    return () => {
      live = false;
      offChanged();
      offError();
      void api.view.close({ view }).catch(() => undefined);
    };
  }, [row.uri]);

  if (!listing) return <img className="size-32" src={iconUrl(row.icon, 128 * pixelRatio())} alt="" draggable={false} />;
  if ('error' in listing) return <p className="p-4 text-center text-[12px] text-fg-2">{listing.error}</p>;
  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5 self-stretch">
      <p className="px-1 text-[11px] font-semibold text-fg-2">{t('archiveItems', listing.count)}</p>
      <ul aria-label={row.name} className="max-h-[40vh] overflow-y-auto rounded-tile bg-stripe py-1 text-[12px] ring-[0.5px] ring-hair ring-inset">
        {listing.rows.map((r) => (
          <li key={r.name} className="flex h-6 items-center gap-1.5 px-2.5">
            <img className="size-4 flex-none" src={iconUrl(r.icon, 16 * pixelRatio())} alt="" draggable={false} />
            <span className="truncate">{r.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
