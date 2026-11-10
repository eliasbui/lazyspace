// The notes of disks and devices: cards in the corner of the window, of the same glass as the toasts, each about one
// thing (`key`), so a newer note of the same thing takes its place. They are toasts of sonner with a body of our own.
import type { ComponentType } from 'react';
import { CameraIcon, DeviceMobileIcon, DeviceMobileSpeakerIcon, DeviceTabletIcon, XIcon, type IconProps } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { IconButton } from '@/components/macos/Tip';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { VolumeNote } from '@/services';

export type DeviceSymbol = 'iphone' | 'ipad' | 'camera' | 'phone.other';

const SYMBOLS: Record<DeviceSymbol, ComponentType<IconProps>> = {
  iphone: DeviceMobileIcon,
  ipad: DeviceTabletIcon,
  camera: CameraIcon,
  'phone.other': DeviceMobileSpeakerIcon,
};

export interface NoteAction {
  label: string;
  primary?: boolean;
  run: () => void;
}

export interface NoteRow {
  img: string;
  title: string;
  text?: string;
  action: NoteAction | null;
}

export interface NoteBase {
  symbol?: DeviceSymbol;
  img?: string;
  title: string;
  text?: string;
  bad?: boolean;
  actions?: NoteAction[];
  rows?: NoteRow[];
  /** How long it stays, in ms, unless the pointer is on it; 0 until it is closed (an eject refused, waiting for an answer). */
  life?: number;
  /** The disk image a note of its apps is about, to draw it again once one of them is installed. */
  volume?: VolumeNote;
}

interface Shown {
  base: NoteBase;
  busy: boolean;
}

/** The notes shown, the oldest first. */
const notes = new Map<string, Shown>();
const MAX = 4;

// Sonner tells of a toast gone after it went, maybe once a newer note of the same thing has taken its key.
const forget = (key: string, shown: Shown): void => {
  if (notes.get(key) === shown) notes.delete(key);
};

function paint(key: string, shown: Shown, view: { text?: string; bad?: boolean } = {}): void {
  const note = { ...shown.base, ...view };
  // shortcut: sonner restarts the timer only when the duration changes, so a newer note of the same thing with the same life keeps the time left.
  toast.custom(() => <Note note={note} busy={shown.busy} onClose={() => close(key)} />, {
    id: key,
    duration: shown.busy || !note.life ? Infinity : note.life,
    onDismiss: () => forget(key, shown),
    onAutoClose: () => forget(key, shown),
  });
}

/** Shows a note about `key`, or puts this one in the place of the one about it. */
export function note(key: string, base: NoteBase): void {
  const fresh = !notes.has(key);
  const shown = { base, busy: false };
  // A note of the same thing keeps its place; a new one makes the oldest go past the most shown.
  notes.set(key, shown);
  if (fresh) for (const old of [...notes.keys()].slice(0, Math.max(0, notes.size - MAX))) close(old);
  paint(key, shown);
}

export function close(key: string): void {
  notes.delete(key);
  toast.dismiss(key);
}

export const volumeOf = (key: string): VolumeNote | undefined => notes.get(key)?.base.volume;

/** The note waits for what it asked for, its buttons off and a word of what goes on; it stays until that is over. */
export function busy(key: string, text?: string): void {
  const shown = notes.get(key);
  if (!shown) return;
  shown.busy = true;
  paint(key, shown, { text: text ?? shown.base.text, bad: false });
}

/** A failure stays until it is read and closed. */
export function failed(key: string, error: string): void {
  const shown = notes.get(key);
  if (!shown) return;
  shown.busy = false;
  shown.base = { ...shown.base, life: 0 };
  paint(key, shown, { text: error, bad: true });
}

function Note({ note, busy, onClose }: { note: NoteBase; busy: boolean; onClose: () => void }) {
  const t = useT();
  const Glyph = note.symbol ? SYMBOLS[note.symbol] : null;
  const button = (a: NoteAction) => (
    <Button size="sm" variant={a.primary ? 'default' : 'outline'} isDisabled={busy} onPress={a.run}>
      {a.label}
    </Button>
  );
  return (
    <div className="group glass-pop relative grid w-(--width) grid-cols-[36px_minmax(0,1fr)] items-start gap-x-3 rounded-pop py-3 pr-3.5 pl-3 text-fg">
      <span className="row-span-4 grid size-9 place-items-center text-fg-2">{note.img ? <img src={note.img} alt="" className="size-9" /> : Glyph ? <Glyph className="size-7" /> : null}</span>
      <b className="truncate pr-5 text-[13px] leading-snug font-semibold">{note.title}</b>
      {note.text ? <p className={cn('mt-0.5 text-[12px] leading-snug [overflow-wrap:anywhere]', note.bad ? 'text-bad' : 'text-fg-2')}>{note.text}</p> : null}
      {note.rows?.length ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {note.rows.map((r) => (
            <div key={r.title} className="flex items-center gap-2 text-[12px]">
              <img src={r.img} alt="" className="size-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {r.title}
                {r.text ? <small className="block truncate text-[11px] text-fg-2">{r.text}</small> : null}
              </span>
              {r.action ? button(r.action) : null}
            </div>
          ))}
        </div>
      ) : null}
      {note.actions?.length ? <div className="mt-2.5 flex flex-wrap gap-1.5">{note.actions.map((a) => <span key={a.label}>{button(a)}</span>)}</div> : null}
      <IconButton label={t('dev.close')} icon={<XIcon />} size="icon-xs" variant="secondary" onPress={onClose} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
    </div>
  );
}
