// The path bar as a field: type a path or a part of one, with the places gone to before that hold it offered first (those
// typed before them) and the folders that complete it after; Enter goes there, and the place is kept in the history as
// typed. Down with nothing offered lists the history; Shift-Delete takes the offered place out of it.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ClockCounterClockwiseIcon, FolderIcon } from '@phosphor-icons/react';
import { useT } from '@/i18n';
import { useApp } from '@/lib/app-state';
import { toast } from '@/lib/ui';
import { fileUri, isLocal, pathOf, samePlace } from '@/lib/uri';
import { cn } from '@/lib/utils';
import { api, type HistoryPlace, type Uri } from '@/services';
import type { Pane } from '../pane';
import { placeLabel } from '../places';

interface Offer {
  label: string;
  /** A place from the history goes at once; a folder that completes the path goes into the field to type on. */
  uri?: Uri;
  value?: string;
}

export function AddressField({ pane }: { pane: Pane }) {
  const t = useT();
  const listId = useId();
  const tab = pane.tab;
  const input = useRef<HTMLInputElement | null>(null);
  const history = useRef<HistoryPlace[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closed = useRef(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [at, setAt] = useState(-1);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    api.history
      .list()
      .then((h) => (history.current = h))
      .catch(() => undefined);
    return () => clearTimeout(timer.current);
  }, []);

  const past = (text: string): Offer[] => {
    const folded = text.toLowerCase();
    return history.current
      .filter((p) => !samePlace(p.uri, tab.uri) && (!folded || placeLabel(p.uri).toLowerCase().includes(folded) || pathOf(p.uri).toLowerCase().includes(folded)))
      .sort((a, b) => Number(b.typed) - Number(a.typed))
      .slice(0, folded ? 6 : 20)
      .map((p) => ({ label: placeLabel(p.uri), uri: p.uri }));
  };

  const show = (list: Offer[], index = -1) => {
    setOffers(list);
    setAt(index);
  };

  const suggest = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const text = input.current?.value.trim() ?? '';
      const before = past(text);
      const local = text.startsWith('/') || text.startsWith('~');
      void (local ? api.fs.complete({ text }).then((d) => d.items, () => []) : Promise.resolve([] as string[])).then((folders) => {
        if (closed.current || (input.current?.value.trim() ?? '') !== text) return;
        const known = new Set(before.filter((b) => b.uri && isLocal(b.uri)).map((b) => `${pathOf(b.uri ?? '')}/`));
        show([...before, ...folders.filter((f) => !known.has(f)).map((f) => ({ label: f, value: f }))]);
      });
    }, 60);
  };

  const done = (go: boolean, uri?: Uri) => {
    if (closed.current) return;
    closed.current = true;
    clearTimeout(timer.current);
    const value = input.current?.value.trim() ?? '';
    pane.editingAddress = false;
    pane.touch();
    if (!go) return pane.focusList();
    if (uri) return pane.goTyped(uri);
    if (!value) return;
    const home = useApp.getState().places?.home;
    const homePath = home ? pathOf(home) : '';
    const path = value === '~' ? homePath : value.startsWith('~/') ? homePath + value.slice(1) : value;
    if (path.startsWith('/')) pane.goTyped(fileUri(path.replace(/\/+$/, '') || '/'));
    else if (/^[a-z0-9+-]+:\/\//.test(path)) pane.goTyped(path);
    else toast(t('notAPath'));
  };

  const take = (offer: Offer) => {
    if (offer.uri) return done(true, offer.uri);
    if (input.current && offer.value != null) input.current.value = offer.value;
    input.current?.focus();
    suggest();
  };

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const offer = offers[at];
    if (e.key === 'Enter') {
      if (offer?.uri) return done(true, offer.uri);
      if (offer?.value != null && input.current) input.current.value = offer.value;
      done(true);
    } else if (e.key === 'Escape') done(false);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!offers.length && e.key === 'ArrowDown') {
        const list = past('');
        return show(list, list.length ? 0 : -1);
      }
      if (offers.length) setAt((at + (e.key === 'ArrowDown' ? 1 : -1) + offers.length) % offers.length);
    } else if (e.key === 'Tab' && offers.length) {
      e.preventDefault();
      const first = offers[Math.max(0, at)];
      if (!first) return;
      if (first.uri && input.current) {
        input.current.value = isLocal(first.uri) ? pathOf(first.uri) : first.uri;
        suggest();
      } else take(first);
    } else if (e.key === 'Delete' && e.shiftKey && offer?.uri) {
      e.preventDefault();
      const gone = offer.uri;
      history.current = history.current.filter((p) => p.uri !== gone);
      api.history.remove({ uri: gone }).catch(() => undefined);
      const left = offers.filter((_, k) => k !== at);
      show(left, Math.min(at, left.length - 1));
    }
  };

  const box = pane.boxEl?.getBoundingClientRect();
  return (
    <>
      <input
        ref={input}
        defaultValue={isLocal(tab.uri) ? pathOf(tab.uri) : tab.uri}
        spellCheck={false}
        autoComplete="off"
        role="combobox"
        aria-label={t('cmd.editAddress')}
        aria-expanded={offers.length > 0}
        aria-controls={listId}
        aria-activedescendant={at >= 0 ? `${listId}-${at}` : undefined}
        className="h-[26px] min-w-0 flex-1 bg-transparent px-[6px] text-[12px] text-fg outline-none"
        onChange={suggest}
        onKeyDown={keys}
        onBlur={() => setTimeout(() => done(false), 120)}
      />
      {offers.length && box
        ? createPortal(
            <div
              id={listId}
              role="listbox"
              className="fixed z-50 max-h-[320px] min-w-[280px] animate-pop-in overflow-y-auto rounded-[12px] p-[5px] glass-pop"
              style={{ left: box.left, top: box.bottom + 4, width: box.width }}
              onMouseDown={(e) => e.preventDefault()}
            >
              {offers.map((offer, i) => (
                <div
                  key={`${offer.uri ?? offer.value}:${i}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === at}
                  className={cn('flex h-[26px] items-center gap-[8px] rounded-[6px] px-[9px] text-[12px] whitespace-nowrap', i === at ? 'bg-tint text-primary-foreground' : 'hover:bg-hover')}
                  onMouseDown={() => take(offer)}
                >
                  {offer.uri ? <ClockCounterClockwiseIcon className={cn('size-[14px] flex-none', i !== at && 'text-fg-2')} /> : <FolderIcon className={cn('size-[14px] flex-none', i !== at && 'text-fg-2')} />}
                  <span className="truncate">{offer.label}</span>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
