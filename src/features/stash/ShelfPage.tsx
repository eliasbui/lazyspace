// The shelf's own window: a compact basket that takes files dropped from anywhere, text, links and pictures from a browser
// or the clipboard, and gives its items back by dragging them out.
import { useCallback, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { ClipboardIcon, TrashIcon, TrayIcon, XIcon } from '@phosphor-icons/react';
import { IconButton } from '@/components/macos/Tip';
import { useT } from '@/i18n';
import { say } from '@/lib/ui';
import { isLocal, pathOf } from '@/lib/uri';
import { cn } from '@/lib/utils';
import { api, iconUrl, on, pixelRatio, thumbUrl, type Entry, type MenuNode, type Uri } from '@/services';
import { choose } from './choose';
import { add, download, isLink, thumbnailed, useStash } from './store';

const hide = () => void api.stash.show({ on: false }).catch(() => undefined);
const fromClipboard = () => void api.stash.addClipboard().catch(say);

/** Text, links and pictures from a browser come as an HTML5 drop; files come through the app, as `drop`. */
async function fromData(data: DataTransfer | null): Promise<void> {
  if (!data) return;
  const files = [...data.files].filter((f) => f.type.startsWith('image/') && f.size < 64 << 20);
  if (!files.length) {
    // Read now: a drop's data is gone once its event is over.
    const url = data
      .getData('text/uri-list')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => /^https?:\/\//.test(line));
    const text = data.getData('text/plain');
    if (url) api.stash.addData({ url }).catch(say);
    else if (text) api.stash.addData({ text }).catch(say);
    return;
  }
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    api.stash.addData({ name: file.name || null, base64: btoa(binary) }).catch(say);
  }
}

function open(item: Entry): void {
  if (item.isDir) api.app.newWindow({ uri: item.uri }).catch(say);
  else api.native.open({ uris: [item.uri] }).catch(say);
}

export function ShelfPage() {
  const t = useT();
  const hasLanes = useStash((s) => s.hasLanes);
  const [items, setItems] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<Uri>>(() => new Set());
  const [over, setOver] = useState(false);

  const load = useCallback(() => {
    api.stash.items().then(
      (list) => {
        setItems(list);
        setSelected((sel) => new Set([...sel].filter((uri) => list.some((i) => i.uri === uri))));
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    // The window is clear around the basket.
    document.documentElement.classList.add('shelf-mode');
    load();
    const dragover = (e: DragEvent) => {
      e.preventDefault();
      setOver(true);
    };
    const dragleave = () => setOver(false);
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      void fromData(e.dataTransfer);
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
      if (e.key === 'v' && e.metaKey) fromClipboard();
    };
    document.addEventListener('dragover', dragover);
    document.addEventListener('dragleave', dragleave);
    document.addEventListener('drop', drop);
    document.addEventListener('keydown', keydown);
    const stops = [
      on('stash.changed', load),
      // Files dropped on the shelf's window go on the shelf.
      on('drop', (d) => add(d.uris)),
      on('drop.over', () => setOver(true)),
      on('drop.leave', () => setOver(false)),
    ];
    return () => {
      document.documentElement.classList.remove('shelf-mode');
      document.removeEventListener('dragover', dragover);
      document.removeEventListener('dragleave', dragleave);
      document.removeEventListener('drop', drop);
      document.removeEventListener('keydown', keydown);
      for (const stop of stops) stop();
    };
  }, [load]);

  /** The selection once `item` is pressed: it joins with Command, or becomes the selection, unless it is in it already. */
  const pick = (item: Entry, keep: boolean): ReadonlySet<Uri> => {
    if (selected.has(item.uri)) return selected;
    const next = new Set(keep ? [...selected, item.uri] : [item.uri]);
    setSelected(next);
    return next;
  };

  const press = (e: ReactMouseEvent, item: Entry) => {
    if (e.button !== 0) return;
    // Dragging an item out takes the selection with it.
    api.drag.arm({ uris: [...pick(item, e.metaKey)] }).catch(() => undefined);
  };

  const menu = async (item: Entry, x: number, y: number) => {
    const uris = [...pick(item, false)];
    const items: MenuNode[] = [
      { id: 'open', label: t('openItem'), icon: 'arrow.up.forward.app' },
      { id: 'reveal', label: t('revealFinder'), icon: 'macwindow' },
      { id: 'revealHere', label: t('revealHere'), icon: 'folder' },
      ...(hasLanes && uris.some(isLink) ? [{ id: 'lanes', label: t('downloadLanes'), icon: 'arrow.down.circle' }] : []),
      { separator: true },
      { id: 'remove', label: t('stashRemove'), icon: 'tray.and.arrow.up' },
    ];
    const choice = await choose(items, x, y);
    if (choice === 'open') api.native.open({ uris }).catch(say);
    else if (choice === 'reveal') api.native.reveal({ uris }).catch(say);
    // The shelf has no panes: the app shows the items in a main window, opening one if none is open.
    else if (choice === 'revealHere') {
      const local = uris.filter(isLocal);
      if (local.length) api.viewer.reveal({ uris: local }).catch(say);
    } else if (choice === 'lanes') download(uris);
    else if (choice === 'remove') api.stash.remove({ uris }).catch(say);
  };

  const key = (e: ReactKeyboardEvent, item: Entry) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      for (const one of items.filter((i) => selected.has(i.uri) || i.uri === item.uri)) open(one);
    } else if (e.key === ' ') {
      e.preventDefault();
      const next = new Set(selected);
      if (!next.delete(item.uri)) next.add(item.uri);
      setSelected(next);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      api.stash.remove({ uris: [...new Set([...selected, item.uri])] }).catch(say);
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      void menu(item, r.left + r.width / 2, r.bottom);
    }
  };

  return (
    <div className={cn('glass-pop fixed inset-1.5 flex flex-col overflow-hidden rounded-panel', over && 'outline-2 -outline-offset-2 outline-tint')}>
      <div data-drag className="flex h-10 flex-none items-center justify-between pr-2 pl-3.5">
        <span className="text-[13px] font-bold">
          {t('stash')}
          {items.length ? <span className="ml-1.5 text-[11px] font-semibold text-fg-2">{items.length}</span> : null}
        </span>
        <span className="flex gap-0.5">
          <IconButton size="icon-sm" className="text-fg-2" label={t('stashPaste')} icon={<ClipboardIcon />} onPress={fromClipboard} />
          <IconButton size="icon-sm" className="text-fg-2" label={t('stashClear')} icon={<TrashIcon />} onPress={() => void api.stash.clear().catch(say)} />
          <IconButton size="icon-sm" className="text-fg-2" label={t('stashClose')} icon={<XIcon />} onPress={hide} />
        </span>
      </div>
      <div
        role="listbox"
        aria-label={t('stash')}
        aria-multiselectable="true"
        onClick={(e) => e.target === e.currentTarget && setSelected(new Set())}
        className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(76px,1fr))] content-start gap-1 overflow-y-auto px-2.5 pt-1 pb-3"
      >
        {items.length ? (
          items.map((item) => (
            <div
              key={item.uri}
              role="option"
              aria-selected={selected.has(item.uri)}
              tabIndex={0}
              onMouseDown={(e) => press(e, item)}
              onDoubleClick={() => open(item)}
              onContextMenu={(e) => {
                e.preventDefault();
                void menu(item, e.clientX, e.clientY);
              }}
              onKeyDown={(e) => key(e, item)}
              className="flex flex-col items-center gap-1 rounded-tile px-0.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-tint-soft"
            >
              <Picture item={item} />
              <span className="line-clamp-2 w-full text-center text-[11px] leading-tight break-words">{item.name}</span>
            </div>
          ))
        ) : (
          <div className="col-span-full flex flex-col items-center gap-2 px-6 pt-16 text-center text-[12px] leading-normal text-fg-2">
            <TrayIcon className="size-8 text-fg-3" />
            <p>{t('stashEmpty')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Picture({ item }: { item: Entry }) {
  const [failed, setFailed] = useState(false);
  const px = 48 * pixelRatio();
  if (thumbnailed(item) && !failed) return <img className="size-12 rounded-sm object-contain shadow-sm" src={thumbUrl(pathOf(item.uri), px)} alt="" draggable={false} onError={() => setFailed(true)} />;
  return <img className="size-12 object-contain" src={iconUrl(item.icon, px)} alt="" draggable={false} />;
}
