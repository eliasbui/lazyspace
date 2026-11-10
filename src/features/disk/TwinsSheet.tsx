import { useEffect, useId, type ReactNode } from 'react';
import { SheetFrame } from '@/components/macos/SheetFrame';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { fmtSize } from '@/lib/format';
import type { SheetProps } from '@/lib/registry';
import { nameOf, pathOf } from '@/lib/uri';
import { iconUrl, pixelRatio, type Uri } from '@/services';
import { defaultFolder, findTwins, pickExtra, togglePicked, trashPicked, useDisk } from './store';

/** A path as the window writes it: under the home folder from `~`. */
function tilde(uri: Uri, home: Uri | undefined): string {
  const path = pathOf(uri);
  const root = home ? pathOf(home) : null;
  return root && (path === root || path.startsWith(`${root}/`)) ? `~${path.slice(root.length)}` : path;
}

/** The files of a folder that are the same, by groups, to tick and move to the Trash. */
export function TwinsSheet({ close }: SheetProps<undefined>) {
  const t = useT();
  const home = useApp((s) => s.places?.home);
  const twinsOf = useDisk((s) => s.twinsOf);
  const folder = useDisk((s) => s.twinsFolder);
  const groups = useDisk((s) => s.groups);
  const picked = useDisk((s) => s.picked);

  // Opened with nothing asked (a sheet opened by its id), it looks in the focused pane's folder.
  useEffect(() => {
    const uri = useDisk.getState().twinsOf ? null : defaultFolder();
    if (uri) findTwins(uri);
  }, []);

  const where = folder ?? twinsOf;
  const free = (groups ?? []).reduce((sum, g) => sum + g.size * (g.uris.length - 1), 0);
  const ticked = new Set(picked);

  return (
    <SheetFrame
      open
      onClose={close}
      size="lg"
      title={t('twinsTitle', where ? nameOf(where) : '')}
      footer={
        <>
          <Button className="mr-auto" isDisabled={!groups?.length} onPress={() => pickExtra(true)}>
            {t('pickExtra')}
          </Button>
          <Button isDisabled={!picked.length} onPress={() => pickExtra(false)}>
            {t('pickNone')}
          </Button>
          <Button variant="destructive" isDisabled={!picked.length} onPress={trashPicked}>
            {t('trashPicked', picked.length)}
          </Button>
          <Button variant="default" onPress={close}>
            {t('done')}
          </Button>
        </>
      }
    >
      <p className="flex items-center gap-2 pb-3 text-[13px] text-fg-2" aria-live="polite">
        {groups ? null : <Spinner aria-label={t('finding')} className="size-3.5" />}
        {groups ? (groups.length ? t('twinsSum', groups.length, fmtSize(free)) : t('twinsNone')) : t('finding')}
      </p>
      <div className="flex flex-col gap-3 pb-2">
        {(groups ?? []).map((g) => (
          <section key={g.uris[0]} className="pane overflow-hidden rounded-card">
            <h3 className="border-b border-hair px-3 py-1.5 text-[11px] font-semibold text-fg-2 tabular-nums">{t('twinsGroup', fmtSize(g.size), g.uris.length, fmtSize(g.size * (g.uris.length - 1)))}</h3>
            <ul className="flex flex-col py-1">
              {g.uris.map((uri) => (
                <li key={uri}>
                  <Check checked={ticked.has(uri)} onChange={(on) => togglePicked(uri, on)}>
                    <img src={iconUrl(`path:${pathOf(uri)}`, 16 * pixelRatio())} alt="" className="size-4 shrink-0" />
                    <span className="truncate">{tilde(uri, home)}</span>
                  </Check>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </SheetFrame>
  );
}

/** A box to tick with its words beside it; a press on the words ticks it too. */
function Check({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex h-7 items-center gap-2 px-3 hover:bg-hover">
      <Checkbox isSelected={checked} onChange={onChange} aria-labelledby={id} />
      <span id={id} onClick={() => onChange(!checked)} className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
        {children}
      </span>
    </div>
  );
}
