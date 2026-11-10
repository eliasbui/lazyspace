// The panes as the rest of the front end sees them. The panes feature (src/features/panes) implements this and installs
// itself with `installPanes`; every other feature codes against `panes` and the types here, and never imports the feature.
// This is what the old page offered as `Panes`, `pane` and `tab` (ui/parts/03-core-panes.js), as typed members.
import { create } from 'zustand';
import type { Capabilities, Groups, PanesState, Row, Targets, TabColor, Uri, ViewMode, ViewSort } from '@/services';

/** A tab as features read it. The listing lives in Rust; the page keeps the rows it has been given, the selection and the scroll. */
export interface TabView {
  /** The id Rust knows the listing by: the `view` of `fs.list`, `view.rows` and the other view methods. */
  readonly id: string;
  readonly uri: Uri;
  readonly mode: ViewMode;
  readonly sort: ViewSort | null;
  readonly title: string | null;
  readonly color: TabColor | null;
  readonly count: number;
  readonly generation: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly capabilities: Capabilities;
  /** The index of the row with the cursor, or -1. */
  readonly lead: number;
  readonly anchor: number;
  /** Whether the listing has been asked for; a tab restored with the window lists the first time it is shown. */
  readonly requested: boolean;
  readonly groups: Groups;
  /** The free space of the disk the folder is on, if Rust said. */
  readonly free: number | null;
  readonly filter: string;
  /** Letters beside the names, set by the git feature (`M`, `A`, `D`, `R`, `?`, `U`); null for none. */
  readonly marks: Readonly<Record<string, string>> | null;
  readonly branch: string | null;
  /** The places Back and Forward go to, the nearest last. Optional: a pane of a feature's own (the desktop) has none. */
  readonly back?: readonly Uri[];
  readonly forward?: readonly Uri[];
  /** Sets `marks` and `branch` (the git feature) and draws the tab again if it is shown. */
  setGit?(marks: Readonly<Record<string, string>> | null, branch: string | null): void;
  /** Replaces the text that stands for the tab's listing error (a server that is not trusted yet says so in words). */
  setError?(text: string | null): void;
  /** How many items are selected (everything but the exceptions when everything is). */
  selCount(): number;
  isSel(name: string): boolean;
  /** The selection as the methods of the app take it: `{ view, selection }`. */
  selection(): Extract<Targets, { view: string }>;
  /** The selected rows that are loaded. A selection of all of a huge folder goes to Rust as `selection()` instead. */
  selectedEntries(): Row[];
  entry(name: string): Row | null;
  rowAt(index: number): Row | null;
  /** Select these names once the listing has them (after a rename, a copy, a new folder). */
  selectWhenListed(names: string[]): void;
  /** Open the name field on this item once the listing has it. */
  renameWhenListed(name: string): void;
}

export interface NavigateOptions {
  /** Whether the place left goes into the Back stack. Default true. */
  history?: boolean;
  /** Names to select once the listing has them. */
  select?: string[] | null;
}

export interface NewTabOptions {
  background?: boolean;
  at?: number;
}

export interface PaneHandle {
  readonly id: string;
  readonly index: number;
  readonly tab: TabView;
  readonly tabs: readonly TabView[];
  readonly active: number;
  navigate(uri: Uri | null, options?: NavigateOptions): void;
  newTab(uri?: Uri | null, select?: string[] | null, options?: NewTabOptions): void;
  closeTab(index: number): void;
  activate(index: number): void;
  /** Asks for the tab's listing again, where it is and as it is sorted, keeping the selection. */
  refresh(): void;
  sortOf(tab: TabView): ViewSort;
  sortBy(column: string): void;
  groupBy(group: '' | 'kind' | 'date' | 'size'): void;
  /** Where opening a row goes inside: a folder, or a kind a feature opens as one (an archive); null for a file. */
  browsable(row: Row | null | undefined): Uri | null;
  startRename(name: string): void;
  /** The item whose name is a field now (the views draw the field), or null. */
  readonly renaming?: Readonly<{ index: number; name: string; draft?: string }> | null;
  setRenameDraft?(text: string): void;
  /** `value` is the new name, or null to leave it; `refocus` gives the keyboard back to the list. */
  finishRename?(value: string | null, refocus: boolean): void;
  /** Gives the keyboard back to the list of the pane. */
  focusList(): void;
  // The members below are those of the panes feature; a pane of a feature's own (the desktop) may leave them out.
  /** Asks for the rows between `first` and `last` (not included) that are not loaded yet; a view of a feature calls it for what it shows. */
  ensure?(first: number, last: number): void;
  /** Moves the cursor by `delta` rows (Infinity and -Infinity go to the ends), extending the selection when `extend`. */
  move?(delta: number, extend?: boolean): void;
  /** Finds the item whose name starts with what was typed within the last second plus `text`, as typing in Finder does. */
  find?(text: string): void;
  /** Selects row `index`: only it, turned over (Command), or from the anchor (Shift). */
  select?(index: number, how?: 'only' | 'toggle' | 'range'): void;
  /** Narrows the tab to the items whose name holds `text`; "" shows them all again. */
  setFilter?(text: string): void;
  /** The context menu at (x, y) for row `index`, or for the folder itself when null. */
  contextMenu?(x: number, y: number, index: number | null): void;
  /** The places Back (or Forward) goes to as a menu at (x, y), as a right click on the button lists them. */
  stackMenu?(way: 'back' | 'forward', x: number, y: number): void;
}

/** What the panes tell. */
export interface PaneEvents {
  /** The pane drew its tab again (a new listing, another tab, another mode). */
  render: { pane: PaneHandle };
  /** The selection or the focused pane changed. */
  selection: { pane: PaneHandle };
  /** A tab was closed in a pane that keeps others (Reopen Closed Tab remembers its place). */
  tabClosed: { pane: PaneHandle; uri: Uri };
  /** A press on a row, for the features that start a drag. */
  pointerdown: { pane: PaneHandle; event: PointerEvent | MouseEvent; index: number };
}

export interface DropTarget {
  uri?: Uri;
  quick?: boolean;
  /** The element that lights up for the drop, if the feature wants to know. */
  element?: Element;
}

export interface PanesApi {
  /** Builds the panes from the layout the window had (`app.hello.layout`), or one pane at `uri` or at home. */
  start(saved: PanesState | null, uri?: Uri | null): void;
  /** Replaces the panes of the window by those of `saved` (a workspace). */
  load(saved: PanesState): void;
  /** The window as `panes.state` and workspaces keep it. */
  state(): PanesState;
  saveSoon(): void;
  readonly MAX_PANES: number;
  focused(): PaneHandle | null;
  current(): TabView | null;
  all(): readonly PaneHandle[];
  findTab(view: string): { pane: PaneHandle; tab: TabView } | null;
  focus(pane: PaneHandle): void;
  /** Opens a place in the focused pane. */
  open(uri: Uri, options?: NavigateOptions): void;
  setLayout(layout: string): void;
  closePane(pane: PaneHandle): void;
  moveTab(from: PaneHandle, index: number, to: PaneHandle, at: number): void;
  /** Runs the named action (the keymap, the menus and the commands all go through it) on a pane (the focused one by default). */
  action(name: string, pane?: PaneHandle | null): boolean;
  /** Items cut and not pasted yet, by URI; they are drawn faded. */
  readonly cut: ReadonlySet<string>;
  on<K extends keyof PaneEvents>(event: K, handler: (detail: PaneEvents[K]) => void): () => void;
  emit<K extends keyof PaneEvents>(event: K, detail: PaneEvents[K]): void;
  /** A feature that takes drops itself (the desktop moves its icons where they are dropped) returns true from it. */
  setDropHandler(handler: ((drop: { x: number; y: number; uris: Uri[]; mode: 'copy' | 'move' | 'auto' }, target: DropTarget) => boolean) | null): void;
}

let implementation: PanesApi | null = null;

/** Called once by the panes feature when it starts. */
export function installPanes(api: PanesApi): void {
  implementation = api;
}

function installed(): PanesApi {
  if (!implementation) throw new Error('The panes are not started yet');
  return implementation;
}

/** The panes. Every member forwards to what the panes feature installed. */
export const panes: PanesApi = {
  start: (saved, uri) => installed().start(saved, uri),
  load: (saved) => installed().load(saved),
  state: () => installed().state(),
  saveSoon: () => installed().saveSoon(),
  get MAX_PANES() {
    return implementation?.MAX_PANES ?? 6;
  },
  focused: () => implementation?.focused() ?? null,
  current: () => implementation?.current() ?? null,
  all: () => implementation?.all() ?? [],
  findTab: (view) => implementation?.findTab(view) ?? null,
  focus: (pane) => installed().focus(pane),
  open: (uri, options) => installed().open(uri, options),
  setLayout: (layout) => installed().setLayout(layout),
  closePane: (pane) => installed().closePane(pane),
  moveTab: (from, index, to, at) => installed().moveTab(from, index, to, at),
  action: (name, pane) => implementation?.action(name, pane) ?? false,
  get cut() {
    return implementation?.cut ?? new Set<string>();
  },
  on: (event, handler) => installed().on(event, handler),
  emit: (event, detail) => implementation?.emit(event, detail),
  setDropHandler: (handler) => installed().setDropHandler(handler),
};

/**
 * A number that goes up whenever anything a component may show of the panes changes (a tab navigates, the selection
 * moves, a pane is focused, a listing arrives). A component calls `usePanesRevision()` and then reads `panes`.
 */
export const usePanesRevision = create<{ revision: number }>(() => ({ revision: 0 }));

/** Called by the panes feature after a change. */
export function bumpPanes(): void {
  usePanesRevision.setState((s) => ({ revision: s.revision + 1 }));
}
