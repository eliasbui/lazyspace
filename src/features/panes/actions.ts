// The actions of the core (the old page's `Panes.actions`), by the names the keymaps, the menus and the toolbar use. A
// feature's actions (registry.actions) come after these.
import { t } from '@/i18n';
import { useApp, setSetting } from '@/lib/app-state';
import { sidebar } from '@/lib/sidebar-api';
import { confirm, say, toast } from '@/lib/ui';
import { archiveUri, fileUri, pathOf, withPath } from '@/lib/uri';
import { api, type Uri, type ViewMode } from '@/services';
import type { Preset } from './layout';
import type { Pane } from './pane';

/** What the actions ask of the panes. */
export interface ActionHost {
  readonly MAX_PANES: number;
  setLayout(layout: Preset): void;
  splitWith(from: Pane, i: number, target: Pane, side: 'left' | 'right' | 'top' | 'bottom'): Pane | null;
  splitNew(pane: Pane, side: 'right' | 'bottom'): void;
  closePane(pane: Pane): void;
  cycle(step: number): void;
  setMode(pane: Pane, mode: ViewMode): void;
  updateCut(): void;
}

export type Action = (pane: Pane) => void | Promise<void>;

const places = () => useApp.getState().places;

/** The selection plays out, then goes (`fs.trash` or `fs.delete`); it comes back into sight if that fails. */
async function goOut(pane: Pane, method: 'trash' | 'delete'): Promise<void> {
  // The selection is taken before the motion, which a click during it must not change.
  const selection = pane.tab.selection();
  const out = pane.leave(pane.tab.selectedEntries().map((e) => e.name));
  await out.done;
  await api.fs[method](selection).catch((error: unknown) => {
    out.back();
    say(error);
  });
}

const go = (pane: Pane, uri: Uri | null | undefined): void => {
  if (uri) pane.navigate(uri);
};

export function makeActions(host: ActionHost): Record<string, Action> {
  const split = (pane: Pane, side: 'right' | 'bottom') => (pane.tabs.length > 1 ? void host.splitWith(pane, pane.active, pane, side) : host.splitNew(pane, side));
  const actions: Record<string, Action> = {
    open(pane) {
      const entries = pane.tab.selectedEntries();
      if (!entries.length) return;
      // A kind a feature opens as a folder (an archive) is browsed into; the rest the system opens.
      const into = entries.map((e) => pane.browsable(e)).filter((u): u is Uri => !!u);
      const files = entries.filter((e) => !pane.browsable(e));
      if (into.length === 1 && !files.length) return pane.navigate(into[0] ?? null);
      for (const uri of into) pane.newTab(uri);
      if (files.length) api.native.open({ uris: files.map((f) => f.uri) }).catch(say);
    },
    openInNewTab(pane) {
      for (const e of pane.tab.selectedEntries().filter((e) => e.isDir)) pane.newTab(e.uri);
    },
    quickLook(pane) {
      const tab = pane.tab;
      if (!tab.selCount()) return;
      const lead = tab.rows.get(tab.lead);
      const index = Math.max(0, tab.selectedEntries().findIndex((e) => e === lead));
      api.native.quicklook({ ...tab.selection(), index }).catch(say);
    },
    duplicate(pane) {
      const tab = pane.tab;
      const uris = tab.selectedEntries().map((e) => e.uri);
      if (uris.length && tab.capabilities.write) api.fs.copy({ from: uris, to: tab.uri, mode: 'copy' }).catch(say);
    },
    getInfo(pane) {
      api.native.getInfo(pane.tab.selCount() ? pane.tab.selection() : { uris: [pane.tab.uri] }).catch(say);
    },
    reveal(pane) {
      api.native.reveal(pane.tab.selCount() ? pane.tab.selection() : { uris: [pane.tab.uri] }).catch(say);
    },
    copyPath(pane) {
      const entries = pane.tab.selectedEntries();
      const text = (entries.length ? entries.map((e) => pathOf(e.uri)) : [pathOf(pane.tab.uri)]).join('\n');
      api.clipboard.text({ text }).then(() => toast(t('pathCopied')), say);
    },
    nextPane: () => host.cycle(1),
    previousPane: () => host.cycle(-1),
    layoutSingle: () => host.setLayout('single'),
    layoutH2: () => host.setLayout('h2'),
    layoutV2: () => host.setLayout('v2'),
    layoutH3: () => host.setLayout('h3'),
    layoutL1R2: () => host.setLayout('l1r2'),
    layoutGrid: () => host.setLayout('grid'),
    layoutH4: () => host.setLayout('h4'),
    layoutG6: () => host.setLayout('g6'),
    splitRight: (pane) => split(pane, 'right'),
    splitDown: (pane) => split(pane, 'bottom'),
    closePane: (pane) => host.closePane(pane),
    back(pane) {
      const tab = pane.tab;
      const to = tab.back.pop();
      if (!to) return;
      tab.forward.push(tab.uri);
      pane.navigate(to, { history: false, select: pane.childOf(to) });
    },
    forward(pane) {
      const tab = pane.tab;
      const to = tab.forward.pop();
      if (!to) return;
      tab.back.push(tab.uri);
      pane.navigate(to, { history: false });
    },
    enclosing(pane) {
      const uri = pane.tab.uri;
      const path = pathOf(uri);
      if (uri.startsWith('archive://')) {
        const cut = path.indexOf('!');
        const archive = path.slice(0, cut);
        const inside = path.slice(cut + 1).replace(/^\/|\/$/g, '');
        if (!inside) return pane.navigate(fileUri(archive.slice(0, archive.lastIndexOf('/')) || '/'), { select: [archive.split('/').pop() ?? ''] });
        const up = inside.includes('/') ? inside.slice(0, inside.lastIndexOf('/')) : '';
        return pane.navigate(archiveUri(archive, up), { select: [inside.split('/').pop() ?? ''] });
      }
      if (path === '/') return;
      pane.navigate(withPath(uri, path.slice(0, path.lastIndexOf('/')) || '/'), { select: [path.split('/').pop() ?? ''] });
    },
    refresh: (pane) => pane.refresh(),
    rename(pane) {
      const tab = pane.tab;
      if (tab.selCount() !== 1 || tab.all) return;
      const [name] = tab.sel;
      if (name) pane.startRename(name);
    },
    trash(pane) {
      const tab = pane.tab;
      if (!tab.selCount()) return;
      if (!tab.capabilities.trash) return actions.delete?.(pane);
      return goOut(pane, 'trash');
    },
    async delete(pane) {
      const n = pane.tab.selCount();
      if (!n) return;
      if (await confirm(t('deleteTitle', n), t('deleteText'), t('deleteNow'))) await goOut(pane, 'delete');
    },
    newFolder(pane) {
      const tab = pane.tab;
      if (!tab.capabilities.write) return;
      api.fs.mkdir({ uri: tab.uri }).then((entry) => {
        tab.pendingRename = entry.name;
        if (pane.tab === tab) pane.refresh();
      }, say);
    },
    selectAll: (pane) => pane.selectAll(),
    selectNone: (pane) => pane.clearSelection(),
    // Everything not selected becomes selected and the other way round, without loading a huge folder's rows.
    invertSelection(pane) {
      const tab = pane.tab;
      if (tab.all) {
        const kept = [...tab.except];
        tab.clearSel();
        for (const name of kept) tab.sel.add(name);
      } else {
        const except = [...tab.sel];
        tab.clearSel();
        tab.all = true;
        for (const name of except) tab.except.add(name);
      }
      pane.selectionChanged();
    },
    // Each selected folder, or the pane's own when none is, in a window of its own.
    openInNewWindow(pane) {
      const folders = pane.tab.selectedEntries().filter((e) => e.isDir);
      for (const uri of (folders.length ? folders.map((e) => e.uri) : [pane.tab.uri]).slice(0, 8)) api.app.newWindow({ uri }).catch(say);
    },
    copy(pane) {
      if (!pane.tab.selCount()) return;
      pane.flashSelected();
      api.clipboard.copy(pane.tab.selection()).then(() => host.updateCut(), say);
    },
    cut(pane) {
      if (!pane.tab.selCount()) return;
      pane.flashSelected();
      api.clipboard.cut(pane.tab.selection()).then(() => host.updateCut(), say);
    },
    paste(pane) {
      api.clipboard.paste({ to: pane.tab.uri }).catch(say);
    },
    undo() {
      api.fs.undo().catch(say);
    },
    toggleHidden() {
      void setSetting({ show_hidden: !useApp.getState().settings?.show_hidden });
    },
    viewList: (pane) => host.setMode(pane, 'list'),
    viewIcons: (pane) => host.setMode(pane, 'icons'),
    viewColumns: (pane) => host.setMode(pane, 'columns'),
    viewGallery: (pane) => host.setMode(pane, 'gallery'),
    newTab: (pane) => pane.newTab(),
    closeTab: (pane) => pane.closeTab(pane.active),
    editAddress: (pane) => pane.editAddress(),
    // The filter of the pane, in its path bar.
    find: (pane) => pane.openFilter(),
    deselect: (pane) => pane.clearSelection(),
    toggleSidebar: () => sidebar.toggle(),
    home: (pane) => go(pane, places()?.home),
    desktop: (pane) => go(pane, places()?.desktop),
    downloads: (pane) => go(pane, places()?.downloads),
    applications: (pane) => go(pane, places()?.applications),
  };
  return actions;
}
