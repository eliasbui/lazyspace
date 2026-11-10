// The commands of the palette, in the order the old page listed them, each with its group. The words are `cmd.<id>` and
// `cmdGroup.<group>`.
import { translate, type WordKey } from '@/i18n';
import { fold } from '@/lib/format';
import type { KeymapName } from '@/services';

export type CommandGroup = 'go' | 'file' | 'panes' | 'view' | 'tools';

type Strip<K> = K extends `cmd.${infer Id}` ? Id : never;
/** The name of an action that has a word `cmd.<name>`. */
export type CommandId = Strip<WordKey>;

export const COMMANDS: ReadonlyArray<readonly [id: CommandId, group: CommandGroup]> = [
  ['home', 'go'],
  ['desktop', 'go'],
  ['documents', 'go'],
  ['downloads', 'go'],
  ['applications', 'go'],
  ['back', 'go'],
  ['forward', 'go'],
  ['enclosing', 'go'],
  ['editAddress', 'go'],
  ['connectServer', 'go'],
  ['open', 'file'],
  ['quickLook', 'file'],
  ['rename', 'file'],
  ['batchRename', 'file'],
  ['duplicate', 'file'],
  ['newFolder', 'file'],
  ['newFile', 'file'],
  ['copy', 'file'],
  ['cut', 'file'],
  ['paste', 'file'],
  ['pasteMove', 'file'],
  ['copyToOther', 'file'],
  ['moveToOther', 'file'],
  ['trash', 'file'],
  ['delete', 'file'],
  ['undo', 'file'],
  ['getInfo', 'file'],
  ['eject', 'file'],
  ['reveal', 'file'],
  ['revealHere', 'file'],
  ['copyPath', 'file'],
  ['selectAll', 'file'],
  ['selectNone', 'file'],
  ['invertSelection', 'file'],
  ['hash', 'file'],
  ['newTab', 'panes'],
  ['closeTab', 'panes'],
  ['reopenTab', 'panes'],
  ['openInNewWindow', 'panes'],
  ['nextTab', 'panes'],
  ['previousTab', 'panes'],
  ['nextPane', 'panes'],
  ['previousPane', 'panes'],
  ['openInOther', 'panes'],
  ['swapPanes', 'panes'],
  ['layoutSingle', 'panes'],
  ['layoutH2', 'panes'],
  ['layoutV2', 'panes'],
  ['layoutH3', 'panes'],
  ['layoutL1R2', 'panes'],
  ['layoutGrid', 'panes'],
  ['layoutH4', 'panes'],
  ['layoutG6', 'panes'],
  ['splitRight', 'panes'],
  ['splitDown', 'panes'],
  ['closePane', 'panes'],
  ['pinQuick', 'panes'],
  ['saveWorkspace', 'panes'],
  ['viewList', 'view'],
  ['viewIcons', 'view'],
  ['iconsBigger', 'view'],
  ['iconsSmaller', 'view'],
  ['toggleHidden', 'view'],
  ['toggleSidebar', 'view'],
  ['fullDiskAccess', 'tools'],
  ['togglePreview', 'view'],
  ['refresh', 'view'],
  ['find', 'view'],
  ['compareFolders', 'tools'],
  ['diskMap', 'tools'],
  ['findTwins', 'tools'],
  ['toggleShelf', 'tools'],
  ['openTerminal', 'tools'],
  ['openEditor', 'tools'],
  ['settings', 'tools'],
  ['palette', 'tools'],
];

export const GROUPS: readonly CommandGroup[] = ['go', 'file', 'panes', 'view', 'tools'];

/** The actions the panes core has of its own (the old page's 03-core-panes.js); the rest are in the registry once their feature is. */
export const CORE_ACTIONS: ReadonlySet<string> = new Set([
  'open', 'openInNewTab', 'quickLook', 'duplicate', 'getInfo', 'reveal', 'copyPath', 'nextPane', 'previousPane', 'layoutSingle', 'layoutH2', 'layoutV2',
  'layoutH3', 'layoutL1R2', 'layoutGrid', 'layoutH4', 'layoutG6', 'splitRight', 'splitDown', 'closePane', 'back', 'forward', 'enclosing', 'rename', 'trash',
  'delete', 'newFolder', 'selectAll', 'selectNone', 'invertSelection', 'openInNewWindow', 'copy', 'cut', 'paste', 'undo', 'toggleHidden', 'viewList',
  'viewIcons', 'viewColumns', 'viewGallery', 'newTab', 'closeTab', 'editAddress', 'find', 'deselect', 'toggleSidebar', 'home', 'desktop', 'downloads',
  'applications',
]);

/** The word of a command, which every command of the list has. */
export const wordOf = (id: CommandId): WordKey => `cmd.${id}`;

/** What a command is found by: its words in both languages, and its id. */
export const searchText = (id: CommandId): string => `${translate('vi', wordOf(id))} ${translate('en', wordOf(id))} ${id}`;

/** Whether every word typed is in `text`, accents and case aside, so "thu muc moi" finds "Thư mục mới". */
export function matches(text: string, typed: string): boolean {
  const words = fold(typed.trim()).split(/\s+/).filter(Boolean);
  const hay = fold(text);
  return words.every((w) => hay.includes(w));
}

/** The chords of `action` as a person reads them (Option for Alt on a Mac, the names of the arrows), two at most. */
export function keysOf(action: string, map: Record<string, string>, keymap: KeymapName, word: (key: WordKey) => string): string[] {
  const mac = keymap === 'mac';
  const names: Record<string, WordKey | undefined> = {
    ArrowUp: 'key.ArrowUp',
    ArrowDown: 'key.ArrowDown',
    ArrowLeft: 'key.ArrowLeft',
    ArrowRight: 'key.ArrowRight',
    Backspace: mac ? 'key.Backspace' : undefined,
    Alt: mac ? 'key.Alt' : undefined,
  };
  return Object.entries(map)
    .filter(([, name]) => name === action)
    .map(([chord]) =>
      chord
        .split('+')
        .map((k) => {
          const key = names[k];
          return key ? word(key) : k;
        })
        .join('+'),
    )
    .slice(0, 2);
}
