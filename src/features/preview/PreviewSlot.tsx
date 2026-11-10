// The side preview, on the right of the panes or under them: the selected item of the focused pane as a picture, a film
// or a sound that plays, a PDF, text that can be edited and saved, or its Quick Look thumbnail, with what it is, its size
// and dates, and for a film its size, frame rate, data rate and length. A feature may draw the media of a kind of item
// itself (`registry.preview.register`); the card of what it is stays.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { create } from 'zustand';
import { SidebarSimpleIcon, SquareSplitVerticalIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { IconButton } from '@/components/macos/Tip';
import { useI18n, useT, type WordKey } from '@/i18n';
import { setSetting, useSettings } from '@/lib/app-state';
import { fmtDate, fmtSize } from '@/lib/format';
import { panes, usePanesRevision, type TabView } from '@/lib/panes-api';
import { registry, useRegistry } from '@/lib/registry';
import { errorText, say } from '@/lib/ui';
import { pathOf } from '@/lib/uri';
import { cn } from '@/lib/utils';
import { api, fileUrl, iconUrl, on, pixelRatio, thumbUrl, type PreviewInfo, type Row, type Uri } from '@/services';
import { duration, rate } from './format';

/** The size of the preview for the session: its width on the right, its height below the panes. */
const usePreviewSize = create(() => ({ width: 320, height: 260 }));

type Ready = PreviewInfo | { uri: Uri; error: string };

interface Shown {
  uri: Uri;
  entry: Row | null;
}

interface Text {
  uri: Uri;
  value: string;
  mtime: number | null;
  dirty: boolean;
  readOnly: boolean;
  note: WordKey | null;
  error: string | null;
}

/** The panel, when Settings has it on. */
export function PreviewSlot() {
  const preview = useSettings()?.preview;
  if (!preview?.on) return null;
  return <PreviewPanel bottom={preview.side === 'bottom'} />;
}

/** The one selected row: the row with the cursor when it is selected, else the first selected row that is loaded. */
function selectedRow(tab: TabView): Row | null {
  const lead = tab.rowAt(tab.lead);
  return lead && tab.isSel(lead.name) ? lead : (tab.selectedEntries()[0] ?? null);
}

function PreviewPanel({ bottom }: { bottom: boolean }) {
  const t = useT();
  const { width, height } = usePreviewSize();
  const previews = useRegistry((s) => s.previews);
  usePanesRevision((s) => s.revision);
  const tab = panes.focused()?.tab ?? null;
  const count = tab?.selCount() ?? 0;
  const entry = tab && count === 1 ? selectedRow(tab) : null;
  // The folder itself when nothing is selected; nothing to ask for when several items are.
  const uri = count > 1 ? null : (entry?.uri ?? tab?.uri ?? null);

  const [shown, setShown] = useState<Shown | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [text, setText] = useState<Text | null>(null);
  const [dims, setDims] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  const dirty = !!text?.dirty;
  const dirtyNow = useRef(false);
  dirtyNow.current = dirty;
  const asked = useRef<Uri | null>(null);

  useEffect(() => {
    if (!uri) return;
    const timer = setTimeout(() => {
      // Text with changes not saved stays until it is saved or its changes are dropped.
      if (dirtyNow.current) return;
      asked.current = uri;
      setShown({ uri, entry });
      setReady(null);
      setText(null);
      setDims(null);
      api.preview.info({ uri }).catch(() => undefined);
    }, 90);
    return () => clearTimeout(timer);
    // `entry` is the row of the same render as `uri`; it is asked for again only when the place or the listing changes.
  }, [uri, again]);

  // One listener for the life of the panel: the answer may come before a new one would be in place.
  useEffect(() => on('preview.ready', (d) => d.uri === asked.current && setReady(d)), []);
  useEffect(() => on('view.changed', (d) => d.view === panes.focused()?.tab.id && setAgain((n) => n + 1)), []);

  // Text is read through the app; a small file of a folder that can be written is editable.
  useEffect(() => {
    if (!ready || 'error' in ready || ready.kind !== 'text') return;
    let live = true;
    const writable = !!ready.editable && !!panes.focused()?.tab.capabilities.write;
    api.fs.readText({ uri: ready.uri, max: 1048576 }).then(
      (r) => live && setText({ uri: ready.uri, value: r.text, mtime: r.mtime, dirty: false, readOnly: !writable || r.truncated, note: r.truncated ? 'truncated' : null, error: null }),
      (error: unknown) => live && setText({ uri: ready.uri, value: '', mtime: null, dirty: false, readOnly: true, note: null, error: errorText(error) }),
    );
    return () => {
      live = false;
    };
  }, [ready]);

  // Saved only if the file did not change elsewhere since it was read: the app refuses a write past `mtime`.
  const save = () => {
    if (!text?.dirty) return;
    const saving = text;
    api.fs.writeText({ uri: saving.uri, text: saving.value, mtime: saving.mtime }).then(
      (written) =>
        setText((now) => (now && now.uri === saving.uri ? { ...now, mtime: written.mtime, dirty: now.value !== saving.value, note: now.value === saving.value ? 'saved' : now.note } : now)),
      say,
    );
  };
  const drop = () => {
    dirtyNow.current = false;
    setText(null);
    setAgain((n) => n + 1);
  };

  const many = count > 1 && !dirty;
  const title = many ? t('many', count) : shown ? (shown.entry ? shown.entry.name : registry.places.nameOf(shown.uri)) : '';
  const provider = shown?.entry ? previews.find((p) => shown.entry && p.match(shown.entry)) : undefined;

  let body: ReactNode;
  if (many) body = <Empty>{t('many', count)}</Empty>;
  else if (!shown) body = tab ? null : <Empty>{t('nothing')}</Empty>;
  else if (ready && 'error' in ready) body = <Empty>{ready.error}</Empty>;
  else {
    const media = provider && shown.entry ? <provider.Component row={shown.entry} /> : ready ? <Media info={ready} onDims={setDims} text={text} setText={setText} save={save} drop={drop} /> : shown.entry ? <BigIcon icon={shown.entry.icon} /> : null;
    const kind = provider ? 'other' : ready?.kind;
    body = (
      <>
        {media ? <div className={cn('grid flex-none place-items-center pt-3 pb-1', bottom && 'min-w-0 flex-1 pt-1', kind === 'text' || kind === 'pdf' ? 'min-h-55 flex-1 place-items-stretch' : 'min-h-40')}>{media}</div> : null}
        {ready ? <Facts info={ready} type={shown.entry?.type ?? ''} dims={dims} bottom={bottom} /> : null}
      </>
    );
  }

  const side = () => void setSetting({ preview: { side: bottom ? 'right' : 'bottom' } });
  return (
    <aside
      data-preview={bottom ? 'bottom' : 'right'}
      aria-label={t('preview')}
      className="pane relative flex min-h-0 min-w-0 shrink-0 flex-col rounded-card"
      style={bottom ? { height } : { width }}
    >
      <Grip bottom={bottom} />
      <div className="flex h-9 flex-none items-center justify-between gap-1.5 pr-1.5 pl-3.5">
        <span className="truncate text-[12px] font-semibold">{title}</span>
        <IconButton size="icon-sm" label={t(bottom ? 'moveRight' : 'moveBottom')} icon={bottom ? <SidebarSimpleIcon mirrored /> : <SquareSplitVerticalIcon />} onPress={side} className="text-fg-2" />
      </div>
      <div className={cn('flex min-h-0 flex-1 gap-3 overflow-y-auto px-3.5 pt-1 pb-3.5', bottom ? 'flex-row' : 'flex-col')}>{body}</div>
    </aside>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="m-auto p-6 text-center text-[12px] text-fg-2">{children}</div>;
}

function BigIcon({ icon }: { icon: string }) {
  return <img className="size-32" src={iconUrl(icon, 128 * pixelRatio())} alt="" draggable={false} />;
}

/** A Quick Look thumbnail, or the icon when the system has none. */
function Thumb({ path, icon }: { path: string; icon: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <BigIcon icon={icon} />;
  return <img className="max-h-[52vh] max-w-full rounded-md shadow-sm" src={thumbUrl(path, 512 * pixelRatio())} alt="" draggable={false} onError={() => setFailed(true)} />;
}

function Media({
  info,
  onDims,
  text,
  setText,
  save,
  drop,
}: {
  info: PreviewInfo;
  onDims: (dims: string) => void;
  text: Text | null;
  setText: (update: (text: Text | null) => Text | null) => void;
  save: () => void;
  drop: () => void;
}) {
  const t = useT();
  // An item inside an archive or on a server is shown from its copy on this Mac.
  const path = pathOf(info.local ?? info.uri);
  const src = fileUrl(path);
  switch (info.kind) {
    case 'image':
      return <img className="max-h-[52vh] max-w-full rounded-md shadow-sm" src={src} alt="" draggable={false} onLoad={(e) => onDims(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)} />;
    case 'video':
      return <video className="max-h-[50vh] w-full rounded-lg" src={src} controls preload="metadata" />;
    case 'audio':
      return (
        <div className="flex w-full flex-col items-center gap-2.5">
          <BigIcon icon={info.entry.icon} />
          <audio className="w-full" src={src} controls preload="metadata" />
        </div>
      );
    case 'pdf':
      return <embed className="h-full min-h-90 w-full rounded-lg" src={src} type="application/pdf" />;
    case 'folder':
      return <BigIcon icon={info.entry.icon} />;
    case 'text':
      return (
        <div className="flex h-full min-h-55 flex-col gap-1.5">
          <Textarea
            aria-label={info.entry.name}
            spellCheck={false}
            readOnly={text?.readOnly ?? true}
            value={text?.value ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              setText((now) => (now && !now.readOnly ? { ...now, value, dirty: true, note: 'unsaved' } : now));
            }}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === 's' && e.metaKey) {
                e.preventDefault();
                save();
              }
            }}
            className="min-h-50 flex-1 resize-none rounded-field font-mono text-[12px] leading-normal [field-sizing:fixed] [tab-size:4] md:text-[12px]"
          />
          <div className="flex min-h-7 items-center justify-between gap-2 text-[11px] text-fg-2">
            <span className={cn(text?.error && 'text-bad')}>{text?.error ?? (text?.note ? t(text.note) : '')}</span>
            {text?.dirty ? (
              <span className="flex gap-1.5">
                <Button size="sm" onPress={drop}>
                  {t('dropChanges')}
                </Button>
                <Button size="sm" variant="default" onPress={save}>
                  {t('save')}
                </Button>
              </span>
            ) : null}
          </div>
        </div>
      );
    default:
      return <Thumb key={path} path={path} icon={info.entry.icon} />;
  }
}

/** What the item is, as a card of label and value lines like the Get Info window of macOS. */
function Facts({ info, type, dims, bottom }: { info: PreviewInfo; type: string; dims: string | null; bottom: boolean }) {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const e = info.entry;
  const folder = info.kind === 'folder';
  const lines: Array<[WordKey, string | null]> = [
    ['pv.kind', info.type || type],
    ['pv.size', folder ? null : fmtSize(e.size)],
    ['pv.items', folder && info.items != null ? String(info.items) : null],
    ['pv.created', fmtDate(e.ctime)],
    ['pv.modified', fmtDate(e.mtime)],
  ];
  const media = info.media;
  if (info.kind === 'video') {
    if (media?.video) lines.push(['pv.dims', `${media.video.width} × ${media.video.height}`], ['pv.fps', `${media.video.fps} fps`], ['pv.rate', rate(media.video.dataRate, lang)]);
    if (media?.duration) lines.push(['pv.duration', duration(media.duration)]);
    if (media?.audio) lines.push(['pv.audio', rate(media.audio.dataRate, lang)]);
  } else if (info.kind === 'audio') {
    if (media?.duration) lines.push(['pv.duration', duration(media.duration)]);
    if (media?.audio) lines.push(['pv.rate', rate(media.audio.dataRate, lang)]);
  } else if (info.kind === 'image' && dims) lines.push(['pv.dims', dims]);
  return (
    <dl className={cn('grid flex-none grid-cols-[auto_1fr] content-start rounded-tile bg-stripe px-3 text-[12px] ring-[0.5px] ring-hair ring-inset', bottom && 'w-70')}>
      {lines
        .filter((line): line is [WordKey, string] => line[1] != null && line[1] !== '')
        .map(([label, value]) => (
          <div key={label} className="col-span-2 grid grid-cols-subgrid border-t-[0.5px] border-hair first:border-t-0">
            <dt className="py-1.5 pr-3 whitespace-nowrap text-fg-2">{t(label)}</dt>
            <dd className="py-1.5 text-right font-medium wrap-anywhere select-text">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

/** The edge of the preview, dragged (or moved with the arrow keys) to make it wider or taller. */
function Grip({ bottom }: { bottom: boolean }) {
  const t = useT();
  const { width, height } = usePreviewSize();
  const value = bottom ? height : width;
  const [min, max] = bottom ? [140, 600] : [220, 720];
  const set = (next: number) => {
    const size = Math.min(max, Math.max(min, next));
    usePreviewSize.setState(bottom ? { height: size } : { width: size });
  };
  const down = (e: ReactPointerEvent) => {
    e.preventDefault();
    const start = bottom ? e.clientY : e.clientX;
    const move = (m: PointerEvent) => set(value - ((bottom ? m.clientY : m.clientX) - start));
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  const key = (e: KeyboardEvent) => {
    const grow = bottom ? 'ArrowUp' : 'ArrowLeft';
    const shrink = bottom ? 'ArrowDown' : 'ArrowRight';
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    set(value + (e.key === grow ? 16 : -16));
  };
  return (
    <div
      role="separator"
      aria-orientation={bottom ? 'horizontal' : 'vertical'}
      aria-label={t('preview')}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={down}
      onKeyDown={key}
      className={cn('absolute z-10 rounded-full outline-none focus-visible:bg-tint-soft', bottom ? 'inset-x-3 -top-1.5 h-2 cursor-row-resize' : 'inset-y-3 -left-1.5 w-2 cursor-col-resize')}
    />
  );
}
