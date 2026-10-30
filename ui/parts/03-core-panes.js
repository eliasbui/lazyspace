// The panes of the window, each with its tabs, its path bar, its columns and its rows. The rows live in Rust
// (src/views.rs): a pane draws only what is on screen and asks for those rows by range and generation.
words({
  vi: {
    colName: "Tên", colModified: "Ngày sửa đổi", colSize: "Kích thước", colKind: "Loại", loading: "Đang tải...", emptyFolder: "Thư mục trống",
    colCreated: "Ngày tạo", colExt: "Đuôi", colWhere: "Vị trí", columnsMenu: "Cột hiện trong danh sách",
    groupNone: "Không nhóm", groupKind: "Nhóm theo loại", groupDate: "Nhóm theo ngày sửa", groupSize: "Nhóm theo kích thước",
    noMatch: "Không có mục nào khớp", newTab: "Tab mới", closeTab: "Đóng tab", filterPane: "Lọc", openPrivacy: "Mở Quyền riêng tư",
    duplicateTab: "Nhân bản tab", tabToWindow: "Chuyển tab sang cửa sổ mới", tabToOtherPane: "Chuyển tab sang khung bên kia",
    closeOtherTabs: "Đóng các tab khác", closeTabsRight: "Đóng các tab bên phải", enclosingFolder: "Lên thư mục cha", refresh: "Tải lại",
    recentPlaces: "Nơi đã đến gần đây", noHistory: "Chưa có nơi nào", clearHistory: "Xóa lịch sử đường dẫn", noSubfolders: "Không có thư mục con",
    hiddenCrumbs: "Các thư mục phía trên",
  },
  en: {
    colName: "Name", colModified: "Date Modified", colSize: "Size", colKind: "Kind", loading: "Loading...", emptyFolder: "This folder is empty",
    colCreated: "Date Created", colExt: "Extension", colWhere: "Where", columnsMenu: "Columns of the List",
    groupNone: "No Groups", groupKind: "Group by Kind", groupDate: "Group by Date Modified", groupSize: "Group by Size",
    noMatch: "Nothing matches", newTab: "New Tab", closeTab: "Close Tab", filterPane: "Filter", openPrivacy: "Open Privacy Settings",
    duplicateTab: "Duplicate Tab", tabToWindow: "Move Tab to New Window", tabToOtherPane: "Move Tab to Other Pane",
    closeOtherTabs: "Close Other Tabs", closeTabsRight: "Close Tabs to the Right", enclosingFolder: "Enclosing Folder", refresh: "Refresh",
    recentPlaces: "Recent Places", noHistory: "No places yet", clearHistory: "Clear Path History", noSubfolders: "No folders inside",
    hiddenCrumbs: "Folders Above",
  },
});

// The height of a row and the side of an icon and of its cell, which follow the text and icon sizes of Settings.
let ROW_H = 24;
let ICON = 64;
let CELL_W = 108;
let CELL_H = 118;
function setMetrics(s) {
  ROW_H = { small: 22, medium: 24, large: 28 }[s?.text_size] || 24;
  ICON = [48, 64, 96, 128].includes(s?.icon_size) ? s.icon_size : 64;
  CELL_W = ICON + 44;
  CELL_H = ICON + 54;
}
// Before the panes start, so the first frame is drawn at the sizes of Settings.
on("app.hello", (d) => setMetrics(d.settings));
// The columns of the list view: the name, then those Settings lists (`columns`), in its order. Each has the width it
// starts at; a narrow pane shows those that fit, from the first. Search results add the folder of each item.
const COLUMNS = {
  name: { word: "colName" },
  mtime: { word: "colModified", width: 160 },
  ctime: { word: "colCreated", width: 160 },
  size: { word: "colSize", width: 86, num: true },
  kind: { word: "colKind", width: 150 },
  ext: { word: "colExt", width: 72 },
  where: { word: "colWhere", width: 220 },
};
const COLUMN_KEYS = ["mtime", "ctime", "size", "kind", "ext", "where"];
// The groups a list can be shown in, as Finder's "Use Groups", with the words of their menu.
const GROUPS = [
  ["", "groupNone"],
  ["kind", "groupKind"],
  ["date", "groupDate"],
  ["size", "groupSize"],
];
const fileUri = (path) => `file://${path.split("/").map(encodeURIComponent).join("/")}`;
// A path with every byte but the unreserved ones encoded, `!` included, as the app's own URIs are.
const encodePath = (path) => path.split("/").map((p) => encodeURIComponent(p).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
// The place `inside` in the archive at `path` (archive:///path/a.zip!/inside).
const archiveUri = (path, inside) => `archive://${encodePath(path)}!/${encodePath(inside)}`.replace(/\/$/, "");
// The place at `path` where `uri` is: on the same disk, server or connection.
const withPath = (uri, path) => uri.replace(/^([a-z0-9+-]+:\/\/[^/]*).*$/, "$1") + encodePath(path);

let tabSeq = 1;

class Tab {
  constructor(uri, mode) {
    this.id = `w${S.window.id}t${tabSeq++}`;
    this.uri = uri;
    this.back = [];
    this.forward = [];
    this.mode = mode || S.settings.view_mode || "list";
    this.sort = null;
    this.reset();
  }

  reset() {
    this.generation = 0;
    this.count = 0;
    this.rows = new Map();
    this.byName = new Map();
    this.sel = new Set();
    this.all = false;
    this.except = new Set();
    this.anchor = -1;
    this.lead = -1;
    this.loading = true;
    this.error = null;
    this.capabilities = {};
    this.groups = [];
    this.free = null;
    this.filter = "";
    this.pendingSelect = null;
    this.pendingRename = null;
  }

  isSel(name) {
    return this.all ? !this.except.has(name) : this.sel.has(name);
  }
  selCount() {
    return this.all ? this.count - this.except.size : this.sel.size;
  }
  clearSel() {
    this.sel.clear();
    this.all = false;
    this.except.clear();
  }
  // The selection as the methods of the app take it.
  selection() {
    return { view: this.id, selection: this.all ? { all: true, except: [...this.except] } : { names: [...this.sel] } };
  }
  // The selected rows that are loaded; a selection of everything in a huge folder goes to Rust as `selection` instead.
  selectedEntries() {
    return [...this.rows.values()].filter((e) => this.isSel(e.name));
  }
  entry(name) {
    const index = this.byName.get(name);
    return index == null ? null : this.rows.get(index);
  }
}

class Pane {
  constructor(index) {
    this.index = index;
    this.tabs = [];
    this.active = 0;
    this.cols = Object.fromEntries(COLUMN_KEYS.map((key) => [key, COLUMNS[key].width]));
    this.pool = new Map();
    this.fetching = false;
    this.renaming = null;
    this.el = document.createElement("section");
    this.el.className = "pane";
    this.el.dataset.pane = `p${index}`;
    this.el.innerHTML = `
      <div class="tabs"><div class="tab-strip"></div><button class="tab-add" data-tt="newTab">${icon("plus")}</button></div>
      <div class="pathbar">
        <button class="nav" data-act="back" data-tt="back">${icon("chevron.left")}</button>
        <button class="nav" data-act="forward" data-tt="forward">${icon("chevron.right")}</button>
        <button class="nav" data-act="up" data-tt="enclosingFolder">${icon("up")}</button>
        <div class="address-box">
          <div class="crumbs"></div>
          <button class="tool" data-act="history" data-tt="recentPlaces">${icon("history")}</button>
        </div>
        <button class="nav" data-act="refresh" data-tt="refresh">${icon("refresh")}</button>
        <button class="nav" data-act="filter" data-tt="filterPane">${icon("search")}</button>
      </div>
      <div class="head"></div>
      <div class="list" tabindex="0"><div class="sizer"></div><div class="message" hidden></div></div>
      <div class="status"></div>
      <div class="pane-overlay"></div>`;
    const q = (s) => this.el.querySelector(s);
    this.tabsEl = q(".tabs");
    this.tabStrip = q(".tab-strip");
    this.path = q(".pathbar");
    this.box = q(".address-box");
    this.crumbs = q(".crumbs");
    this.head = q(".head");
    this.list = q(".list");
    this.sizer = q(".sizer");
    this.message = q(".message");
    this.status = q(".status");
    this.overlay = q(".pane-overlay");
    this.applyCols();
    this.bind();
    applyLang();
  }

  get tab() {
    return this.tabs[this.active];
  }

  bind() {
    this.list.addEventListener("scroll", () => this.renderSoon());
    new ResizeObserver(() => this.renderSoon()).observe(this.list);
    this.el.addEventListener("mousedown", () => Panes.focus(this), true);
    this.list.addEventListener("mousedown", (e) => this.pointer(e));
    this.list.addEventListener("dblclick", (e) => {
      const i = this.indexAt(e);
      if (i == null) return;
      // Command and a double click open a folder in a new tab, as in Finder.
      const into = e.metaKey && this.browsable(this.tab.rows.get(i));
      if (into) {
        this.selectOnly(i);
        this.newTab(into);
      } else Panes.action("open", this);
    });
    // The middle button opens a folder in a tab behind this one, as in File Explorer and a browser.
    this.list.addEventListener("auxclick", (e) => {
      const i = e.button === 1 ? this.indexAt(e) : null;
      const into = i == null ? null : this.browsable(this.tab.rows.get(i));
      if (into) this.newTab(into, null, { background: true, at: this.active + 1 });
    });
    this.list.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      Panes.emit("contextmenu", { pane: this, event: e, index: this.indexAt(e) });
    });
    this.path.addEventListener("click", (e) => {
      const button = e.target.closest("[data-act]");
      const act = button?.dataset.act;
      if (act === "back" || act === "forward" || act === "refresh") return Panes.action(act, this);
      if (act === "up") return Panes.action("enclosing", this);
      if (act === "filter") return Toolbar.openSearch();
      if (act === "history") return this.historyMenu(button);
      const sep = e.target.closest(".sep");
      if (sep) return sep.classList.contains("more") ? this.aboveMenu(sep) : this.foldersMenu(sep);
      const crumb = e.target.closest(".crumb");
      if (crumb) return this.navigate(crumb.dataset.uri, { select: this.childOf(crumb.dataset.uri) });
      // Anywhere else in the box, the path becomes a field to type in.
      if (e.target.closest(".address-box") && !e.target.closest(".address")) this.editAddress();
    });
    this.path.addEventListener("auxclick", (e) => {
      const crumb = e.button === 1 && e.target.closest(".crumb");
      if (crumb) this.newTab(crumb.dataset.uri, null, { background: true, at: this.active + 1 });
    });
    // Back and forward held or right-clicked list where they go, as Finder's do.
    this.path.addEventListener("contextmenu", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act !== "back" && act !== "forward") return;
      e.preventDefault();
      Panes.stackMenu(this, act, e.clientX, e.clientY);
    });
    new ResizeObserver(() => this.fitCrumbs()).observe(this.box);
    this.head.addEventListener("click", (e) => {
      const col = e.target.closest("[data-col]");
      if (col && !e.target.classList.contains("grip")) this.sortBy(col.dataset.col);
    });
    // Right-clicked, the header lists the columns to show or hide, as Finder's and File Explorer's do.
    this.head.addEventListener("contextmenu", async (e) => {
      e.preventDefault();
      const chosen = this.wantedColumns().filter((c) => c !== "where" || (S.settings.columns || []).includes("where"));
      const group = this.sortOf(this.tab).group || "";
      const id = await LZ.choose(
        [
          ...COLUMN_KEYS.map((key) => ({ id: key, label: t(COLUMNS[key].word), checked: chosen.includes(key) })),
          { separator: true },
          ...GROUPS.map(([g, word]) => ({ id: `group:${g}`, label: t(word), checked: group === g })),
        ],
        e.clientX,
        e.clientY,
      );
      if (!id) return;
      if (id.startsWith("group:")) return this.groupBy(id.slice(6));
      const now = chosen.includes(id) ? chosen.filter((c) => c !== id) : COLUMN_KEYS.filter((c) => c === id || chosen.includes(c));
      setSetting({ columns: now });
    });
    this.head.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("grip")) this.resizeColumn(e, e.target.dataset.grip);
    });
    // The tabs: a click shows one and a drag moves it, here or to another pane; its button or the middle button
    // closes it; a double click on the empty bar or the button after the tabs opens a new one.
    this.tabsEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const x = e.target.closest(".x");
      const tab = e.target.closest(".tab");
      if (x) this.closeTab(Number(x.dataset.i));
      else if (e.target.closest(".tab-add")) this.newTab();
      else if (tab) {
        this.activate(Number(tab.dataset.i));
        this.dragTab(e, Number(tab.dataset.i));
      }
    });
    this.tabsEl.addEventListener("auxclick", (e) => {
      const tab = e.button === 1 && e.target.closest(".tab");
      if (tab) this.closeTab(Number(tab.dataset.i));
    });
    this.tabsEl.addEventListener("dblclick", (e) => {
      if (!e.target.closest(".tab, .tab-add")) this.newTab();
    });
    this.tabsEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const tab = e.target.closest(".tab");
      if (tab) this.tabMenu(Number(tab.dataset.i), e.clientX, e.clientY);
    });
  }

  // Where opening `entry` goes inside: a folder, or a kind a feature opens as one (an archive); null for a file.
  browsable(entry) {
    if (!entry) return null;
    return entry.isDir ? entry.uri : LZ.vfs.browse(entry);
  }

  // The name of the folder in `uri` the tab came out of, to select it there (going up selects where you were).
  childOf(uri) {
    const here = pathOf(this.tab.uri);
    const there = pathOf(uri).replace(/\/$/, "");
    if (!here.startsWith(`${there}/`)) return null;
    return [here.slice(there.length + 1).split("/")[0]];
  }

  // Opens `uri` in the tab: into history unless it comes from it, then the listing is asked for.
  navigate(uri, { history = true, select = null } = {}) {
    const tab = this.tab;
    if (!uri) return;
    if (history && tab.uri && !samePlace(tab.uri, uri)) {
      tab.back.push(tab.uri);
      tab.forward = [];
    }
    // Search results keep the order of their matches, the best first, until a column is chosen; a folder never does.
    if (schemeOf(uri) === "search" && schemeOf(tab.uri) !== "search") tab.sort = { by: "none", desc: false, foldersFirst: false };
    else if (schemeOf(uri) !== "search" && tab.sort?.by === "none") tab.sort = null;
    tab.uri = uri;
    tab.reset();
    tab.pendingSelect = select;
    this.cancelRename();
    this.list.scrollTop = 0;
    this.renderAll();
    $("searchInput").value = "";
    this.list_();
    Panes.changed(this);
  }

  // Asks for the tab's listing again, where it is and as it is sorted, keeping the selection.
  refresh() {
    this.list_();
  }

  list_() {
    const tab = this.tab;
    tab.requested = true;
    tab.showHidden = !!S.settings.show_hidden;
    call("fs.list", { view: tab.id, uri: tab.uri, sort: this.sortOf(tab), showHidden: !!S.settings.show_hidden }).catch((error) => {
      tab.loading = false;
      tab.error = String(error);
      this.renderAll();
    });
  }

  sortOf(tab) {
    return tab.sort || S.settings.sort || { by: "name", desc: false, foldersFirst: true };
  }

  sortBy(column) {
    const tab = this.tab;
    const sort = { ...this.sortOf(tab) };
    const by = column === "kind" ? "kind" : column;
    sort.desc = sort.by === by ? !sort.desc : by === "mtime" || by === "size";
    sort.by = by;
    tab.sort = sort;
    call("view.sort", { view: tab.id, sort })
      .then((d) => this.regenerate(d.generation, undefined, d.groups))
      .catch(say);
    setSetting({ sort });
    this.renderHead();
    Panes.saveSoon();
  }

  // Shows the list in groups of a kind ("kind", "date", "size"), or in none (""), as Finder's "Use Groups"; the next
  // folders opened take it too.
  groupBy(group) {
    const tab = this.tab;
    const sort = { ...this.sortOf(tab), group };
    tab.sort = sort;
    call("view.sort", { view: tab.id, sort })
      .then((d) => this.regenerate(d.generation, undefined, d.groups))
      .catch(say);
    setSetting({ sort: { group } });
    Panes.saveSoon();
  }

  // The headers of groups are lines of their own in a list: the line a row is drawn on, and what is drawn on a line
  // (the index of a row, or -1 - g for the header of group g).
  grouped() {
    return this.tab?.mode === "list" && this.tab.groups?.length ? this.tab.groups : null;
  }
  lineOf(i) {
    let headers = 0;
    for (const [start] of this.grouped() || []) {
      if (start > i) break;
      headers++;
    }
    return i + headers;
  }
  atLine(line) {
    const groups = this.grouped() || [];
    for (let g = 0; g < groups.length; g++) {
      const header = groups[g][0] + g;
      if (line === header) return -1 - g;
      if (line < header) return line - g;
    }
    return line - groups.length;
  }

  // A new generation of the same listing (sorted or filtered again): the rows go and come back in the new order, in
  // their groups when it has them.
  regenerate(generation, count, groups) {
    const tab = this.tab;
    tab.generation = generation;
    if (count != null) tab.count = count;
    if (groups) tab.groups = groups;
    tab.rows = new Map();
    tab.byName = new Map();
    this.renderAll();
  }

  // The columns this tab shows: those of Settings, the folder of each item first in search results.
  wantedColumns() {
    const chosen = (Array.isArray(S.settings.columns) ? S.settings.columns : ["mtime", "size", "kind"]).filter((c) => COLUMNS[c]);
    return schemeOf(this.tab?.uri) === "search" && !chosen.includes("where") ? ["where", ...chosen] : chosen;
  }

  // The columns a pane of this width shows, as QSpace drops columns in a narrow pane: the name keeps at least 180
  // points, and the others come in their order while they fit.
  shownColumns() {
    // A column of the column view, and the strip of a gallery, show the name alone.
    if (this.tab?.mode === "columns" || this.tab?.mode === "gallery") return ["name"];
    const width = (this.list.clientWidth || 800) - 16;
    const out = ["name"];
    let used = 180;
    for (const key of this.wantedColumns()) {
      used += this.cols[key] ?? COLUMNS[key].width;
      if (used > width) break;
      out.push(key);
    }
    return out;
  }

  applyCols() {
    this.columns = this.shownColumns();
    const widths = this.columns.slice(1).map((c) => `${this.cols[c] ?? COLUMNS[c].width}px`).join(" ");
    this.el.style.setProperty("--cols", `minmax(${this.columns.length > 2 ? 140 : 110}px, 1fr) ${widths}`);
  }

  resizeColumn(e, column) {
    e.preventDefault();
    const startX = e.clientX;
    const start = this.cols[column];
    const move = (m) => {
      this.cols[column] = Math.min(400, Math.max(50, start - (m.clientX - startX)));
      this.applyCols();
    };
    const up = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
      Panes.saveSoon();
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  }

  // Everything that depends on the tab: the tabs strip, the path bar, the columns, the rows and the status.
  renderAll() {
    this.renderTabs();
    this.renderPath();
    this.renderHead();
    this.pool.forEach((el) => el.remove());
    this.pool.clear();
    this.render();
    Panes.emit("render", { pane: this });
  }

  // The tab bar: shown with one tab too unless Settings says otherwise, each tab with the icon of its folder, the
  // button for a new tab after the last.
  renderTabs() {
    const shown = this.tabs.length > 1 || S.settings.always_tabs !== false;
    this.tabsEl.hidden = !shown;
    if (!shown) return;
    this.tabStrip.innerHTML = this.tabs
      .map((tab, i) => {
        const key = tab.uri && isLocal(tab.uri) ? `path:${pathOf(tab.uri)}` : "type:public.folder";
        const where = tab.uri ? (isLocal(tab.uri) ? pathOf(tab.uri) : placeName(tab.uri)) : "";
        return `<div class="tab${i === this.active ? " on" : ""}" data-i="${i}" title="${esc(where)}"><img src="lazy://icon/${16 * pixelRatio()}/${encodeURIComponent(key)}" alt="" draggable="false"><span>${esc(tab.uri ? placeName(tab.uri) : t("newTab"))}</span><button class="x" data-i="${i}" title="${esc(t("closeTab"))}">${icon("xmark")}</button></div>`;
      })
      .join("");
    // The tab shown stays in sight when there are more tabs than room; only the bar scrolls, never the window.
    const on = this.tabStrip.querySelector(".tab.on");
    const strip = this.tabStrip;
    if (on && on.offsetLeft < strip.scrollLeft) strip.scrollLeft = on.offsetLeft;
    else if (on && on.offsetLeft + on.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = on.offsetLeft + on.offsetWidth - strip.clientWidth;
  }

  // The path bar: a crumb for each folder from the top, each followed by the button of its menu of folders, as File
  // Explorer has them; the crumbs that do not fit give way from the top to a button that lists them.
  renderPath() {
    const tab = this.tab;
    this.path.querySelector('[data-act="back"]').disabled = !tab.back.length;
    this.path.querySelector('[data-act="forward"]').disabled = !tab.forward.length;
    this.path.querySelector('[data-act="up"]').disabled = !tab.uri || pathOf(tab.uri) === "/";
    if (this.crumbs.querySelector(".address")) return;
    // A place of a feature (the shelf, a server) has crumbs of its own.
    const own = placeCrumbs[schemeOf(tab.uri)];
    const items = own ? own(tab.uri) : this.diskCrumbs(tab.uri || "");
    this.crumbs.innerHTML =
      `<button class="sep more" hidden title="${esc(t("hiddenCrumbs"))}">${icon("chevron.left.2")}</button>` +
      items
        .map(([uri, name, iconKey], i) => {
          const img = iconKey ? `<img src="lazy://icon/${16 * pixelRatio()}/${encodeURIComponent(iconKey)}" alt="" draggable="false">` : "";
          const here = i === items.length - 1 ? " here" : "";
          return `<button class="crumb${here}" data-i="${i}" data-uri="${esc(uri)}">${img}<span>${esc(name)}</span></button><button class="sep" data-i="${i}" data-of="${esc(uri)}">${icon("triangle.right")}</button>`;
        })
        .join("");
    this.fitCrumbs();
  }

  // Hides crumbs from the top, never the last, until the rest fit.
  fitCrumbs() {
    if (this.crumbs.querySelector(".address")) return;
    const crumbs = [...this.crumbs.querySelectorAll(".crumb")];
    const more = this.crumbs.querySelector(".more");
    if (!more) return;
    for (const el of this.crumbs.children) el.hidden = el === more;
    let gone = 0;
    while (this.crumbs.scrollWidth > this.crumbs.clientWidth + 1 && gone < crumbs.length - 1) {
      crumbs[gone].hidden = true;
      crumbs[gone].nextElementSibling.hidden = true;
      more.hidden = false;
      gone++;
    }
  }

  // The folders in the crumb before `sep`, the one the path goes through checked; the one chosen opens.
  async foldersMenu(sep) {
    const next = this.crumbs.querySelector(`.crumb[data-i="${Number(sep.dataset.i) + 1}"]`)?.dataset.uri;
    sep.classList.add("open");
    const found = await call("fs.subfolders", { uri: sep.dataset.of }).catch((error) => (say(error), null));
    if (!found) return sep.classList.remove("open");
    const r = sep.getBoundingClientRect();
    const choices = found.items.map((f, i) => ({ id: String(i), label: f.name, icon: "folder", checked: samePlace(f.uri, next) }));
    const id = await LZ.choose(choices.length ? choices : [{ id: "none", label: t("noSubfolders"), enabled: false }], r.left, r.bottom + 4);
    sep.classList.remove("open");
    const folder = id == null ? null : found.items[Number(id)];
    if (folder) this.navigate(folder.uri);
  }

  // The crumbs hidden for lack of room, nearest first.
  async aboveMenu(more) {
    const hidden = [...this.crumbs.querySelectorAll(".crumb[hidden]")].reverse();
    const r = more.getBoundingClientRect();
    const id = await LZ.choose(hidden.map((c, i) => ({ id: String(i), label: c.textContent, icon: "folder" })), r.left, r.bottom + 4);
    if (id != null) this.navigate(hidden[Number(id)].dataset.uri);
  }

  // The places gone to lately in any tab or window, newest first, kept by the app (src/features/history.rs).
  async historyMenu() {
    const places = await call("history.list").catch(() => []);
    const list = places.filter((p) => !samePlace(p.uri, this.tab.uri)).slice(0, 20);
    const choices = list.map((p, i) => ({ id: String(i), label: placeLabel(p.uri), icon: isLocal(p.uri) ? "folder" : "network" }));
    if (choices.length) choices.push({ separator: true }, { id: "clear", label: t("clearHistory"), icon: "trash" });
    else choices.push({ id: "none", label: t("noHistory"), enabled: false });
    const r = this.box.getBoundingClientRect();
    const id = await LZ.choose(choices, r.left, r.bottom + 4);
    if (id === "clear") call("history.clear").catch(say);
    else if (id != null && list[Number(id)]) this.navigate(list[Number(id)].uri);
  }

  // The crumbs of a place on this Mac, from the home folder or the disk, and of an archive and the folders inside it:
  // [uri, name, icon] from the top down.
  diskCrumbs(uri) {
    const inArchive = uri.startsWith("archive://");
    const full = pathOf(uri);
    const cut = inArchive ? full.indexOf("!") : -1;
    const path = cut >= 0 ? full.slice(0, cut) : full;
    const home = S.places.home ? pathOf(S.places.home) : null;
    const crumbs = [];
    if (home && (path === home || path.startsWith(`${home}/`))) {
      crumbs.push([home, nameOf(S.places.home), true]);
      let at = home;
      for (const part of path.slice(home.length).split("/").filter(Boolean)) crumbs.push([(at = `${at}/${part}`), part]);
    } else {
      crumbs.push(["/", "Macintosh HD", true]);
      let at = "";
      for (const part of path.split("/").filter(Boolean)) crumbs.push([(at = `${at}/${part}`), part]);
    }
    const items = crumbs.map(([p, name, first]) => [fileUri(p), name, first ? `path:${p}` : null]);
    if (cut >= 0) {
      // The archive's crumb opens its top; each folder inside it opens that folder.
      items[items.length - 1][0] = archiveUri(path, "");
      items[items.length - 1][2] = `path:${path}`;
      let at = "";
      for (const part of full.slice(cut + 1).split("/").filter(Boolean)) items.push([archiveUri(path, (at = at ? `${at}/${part}` : part)), part, null]);
    }
    return items;
  }

  renderHead() {
    const sort = this.sortOf(this.tab);
    const shown = this.columns || this.shownColumns();
    this.head.innerHTML = shown
      .map((key) => {
        const sorted = sort.by === key;
        const arrow = sorted ? icon(sort.desc ? "chevron.down" : "chevron.up") : "";
        const grip = key === "name" ? "" : `<i class="grip" data-grip="${key}"></i>`;
        return `<button class="col${COLUMNS[key].num ? " num" : ""}${sorted ? " sorted" : ""}" data-col="${key}">${grip}<span>${esc(t(COLUMNS[key].word))}</span>${arrow}</button>`;
      })
      .join("");
  }

  renderSoon() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  // Draws the rows on screen, reusing the elements of rows still on screen, and asks for rows not loaded yet.
  render() {
    const tab = this.tab;
    if (!tab) return;
    // A gallery's strip is drawn as icons in one line that scrolls sideways (ui/parts/25-columns.js has its stage).
    const gallery = tab.mode === "gallery";
    const icons = tab.mode === "icons" || gallery;
    this.el.classList.toggle("grid-view", icons);
    this.el.classList.toggle("mode-columns", tab.mode === "columns");
    this.el.classList.toggle("mode-gallery", gallery);
    this.head.hidden = icons || tab.mode === "columns";
    const showMessage = tab.error || (!tab.loading && tab.count === 0) || (tab.loading && !tab.generation);
    this.message.hidden = !showMessage;
    if (tab.error) {
      this.message.innerHTML = `<p>${esc(String(tab.error).replace(/^LZ-[A-Z]+:/, ""))}</p>`;
    } else if (showMessage) {
      this.message.innerHTML = `<p>${esc(tab.loading ? t("loading") : tab.filter ? t("noMatch") : t("emptyFolder"))}</p>`;
    }
    const width = this.list.clientWidth - 16;
    const height = this.list.clientHeight;
    if (!icons && this.shownColumns().join() !== (this.columns || []).join()) {
      this.applyCols();
      this.renderHead();
    }
    const per = gallery ? Math.max(1, tab.count) : icons ? Math.max(1, Math.floor(width / CELL_W)) : 1;
    const rowH = icons ? CELL_H : ROW_H;
    this.per = per;
    this.rowH = rowH;
    const groups = this.grouped();
    const lines = Math.ceil(tab.count / per) + (groups ? groups.length : 0);
    // A pane that places its icons itself (the desktop) draws all of them where it says, in a list that does not scroll.
    const placed = icons && !!this.placeAt;
    this.sizer.style.height = gallery || placed ? `${height}px` : `${lines * rowH + (icons ? 8 : 0)}px`;
    this.sizer.style.width = gallery ? `${tab.count * CELL_W + 8}px` : "";
    const firstLine = placed ? 0 : Math.max(0, Math.floor(this.list.scrollTop / rowH) - 2);
    const lastLine = placed ? lines : Math.ceil((this.list.scrollTop + height) / rowH) + 2;
    const first = gallery ? Math.max(0, Math.floor(this.list.scrollLeft / CELL_W) - 2) : firstLine * per;
    const last = gallery ? Math.min(tab.count, Math.ceil((this.list.scrollLeft + this.list.clientWidth) / CELL_W) + 2) : Math.min(tab.count, lastLine * per);
    const wanted = new Set();
    if (groups) {
      for (let line = firstLine; line < lastLine; line++) {
        const at = this.atLine(line);
        if (at < tab.count || !showMessage) wanted.add(at);
      }
    } else {
      for (let i = first; i < last; i++) wanted.add(i);
      // The stripes go on below the last row, down the empty part of the list, as in Finder.
      if (!icons && tab.mode !== "columns" && !showMessage) for (let i = Math.max(tab.count, first); i < lastLine; i++) wanted.add(i);
    }
    for (const [i, el] of this.pool) {
      if (!wanted.has(i)) {
        el.remove();
        this.pool.delete(i);
      }
    }
    for (const i of wanted) {
      let el = this.pool.get(i);
      if (!el) {
        el = document.createElement("div");
        this.pool.set(i, el);
        this.sizer.appendChild(el);
      }
      if (i < 0) this.paintHeader(el, -1 - i, groups);
      else this.paint(el, i, tab, icons, per);
    }
    if (groups) {
      const rows = [...wanted].filter((i) => i >= 0 && i < tab.count);
      if (rows.length) this.ensure(Math.min(...rows), Math.max(...rows) + 1);
    } else this.ensure(first, last);
    this.renderStatus();
  }

  // The header of group `g`: its name on a line of its own, as Finder heads its groups.
  paintHeader(el, g, groups) {
    const [start, label] = groups[g];
    const key = `head|${this.tab.generation}|${start}|${label}`;
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    delete el.dataset.index;
    el.className = "group-head";
    el.style.top = `${(start + g) * ROW_H}px`;
    el.textContent = label;
  }

  paint(el, i, tab, icons, per) {
    const e = tab.rows.get(i);
    if (icons) {
      const at = this.placeAt?.(i, e) ?? (tab.mode === "gallery" ? { left: i * CELL_W + 4, top: 6 } : null);
      el.style.left = `${at ? at.left : (i % per) * CELL_W + Math.max(0, (this.list.clientWidth - 16 - per * CELL_W) / 2)}px`;
      el.style.top = `${at ? at.top : Math.floor(i / per) * CELL_H + 6}px`;
    }
    const sel = !!e && tab.isSel(e.name);
    const cut = !!e && Panes.cut.has(e.uri);
    // A feature may mark items with a letter (git's state, ui/parts/31-git.js), shown after the name.
    const mark = e && tab.marks?.[e.name];
    const key = `${tab.generation}|${icons}|${per}|${(this.columns || []).join()}|${e ? e.name : ""}|${sel}|${cut}|${e?.dirSize ?? ""}|${e?.tags?.join() ?? ""}|${mark || ""}`;
    if (el.dataset.key === key || (this.renaming && this.renaming.index === i)) return;
    el.dataset.key = key;
    el.dataset.index = i;
    if (icons) {
      el.className = `cell-icon${sel ? " sel" : ""}${cut ? " cut" : ""}`;
      if (!e) {
        el.innerHTML = "";
        return;
      }
      const thumb = thumbUrl(e, ICON);
      const fallback = iconUrl(e, ICON);
      const img = thumb ? thumbImg(thumb, fallback, "thumb") : `<img src="${esc(fallback)}" draggable="false" alt="">`;
      el.innerHTML = `<div class="pic">${img}</div><div class="label">${tagDots(e)}${esc(e.name)}</div>`;
      return;
    }
    el.className = `row${i % 2 ? " odd" : ""}${sel ? " sel" : ""}${cut ? " cut" : ""}${e?.hidden ? " hidden-item" : ""}`;
    el.style.top = `${(this.grouped() ? this.lineOf(i) : i) * ROW_H}px`;
    if (!e) {
      el.innerHTML = "";
      return;
    }
    const size = e.isDir || e.kind === "app" || e.kind === "package" ? (e.dirSize != null ? fmtSize(e.dirSize) : "--") : fmtSize(e.size);
    const thumb = thumbUrl(e, 16);
    const fallback = iconUrl(e, 16);
    const img = thumb ? thumbImg(thumb, fallback) : `<img src="${esc(fallback)}" draggable="false" alt="">`;
    const where = () => {
      const folder = e.uri.slice(0, e.uri.lastIndexOf("/")) || e.uri;
      return `<div class="cell" title="${esc(pathOf(folder))}">${esc(placeLabel(folder))}</div>`;
    };
    const cells = {
      mtime: () => `<div class="cell">${fmtDate(e.mtime)}</div>`,
      ctime: () => `<div class="cell">${fmtDate(e.ctime)}</div>`,
      size: () => `<div class="cell num">${size}</div>`,
      kind: () => `<div class="cell">${esc(e.type || "")}</div>`,
      ext: () => `<div class="cell">${esc(e.ext ? e.ext.toUpperCase() : "--")}</div>`,
      where,
    };
    // In the column view a folder shows the arrow of the column it opens.
    const opens = tab.mode === "columns" && (e.isDir || LZ.vfs.browse(e)) ? icon("chevron.right") : "";
    // As the editors write them: a new file U, a conflict C.
    const badge = mark ? `<em class="mark mark-${mark === "?" ? "new" : mark}">${esc({ "?": "U", U: "C" }[mark] || mark)}</em>` : "";
    el.innerHTML = `<div class="cell name">${img}<span>${esc(e.name)}</span>${tagDots(e)}${badge}${opens}</div>${(this.columns || []).slice(1).map((c) => cells[c]()).join("")}`;
  }

  // Asks for the rows between `first` and `last` that are not loaded, a little beyond them, one request at a time.
  ensure(first, last) {
    const tab = this.tab;
    if (this.fetching || !tab.generation) return;
    let start = -1;
    for (let i = first; i < last; i++) {
      if (!tab.rows.has(i)) {
        start = i;
        break;
      }
    }
    if (start < 0) return;
    const from = Math.max(0, start - 30);
    const count = Math.min(500, last - from + 60);
    this.fetching = true;
    const generation = tab.generation;
    call("view.rows", { view: tab.id, start: from, count, generation })
      .then((d) => {
        if (this.tab !== tab || d.generation !== tab.generation) return;
        d.rows.forEach((row, k) => {
          tab.rows.set(from + k, row);
          tab.byName.set(row.name, from + k);
        });
        this.afterRows(tab);
      })
      .catch((error) => {
        if (error !== "stale") console.warn(error);
      })
      .finally(() => {
        this.fetching = false;
        this.renderSoon();
      });
  }

  // Rows came: a selection or a rename that waited for its item takes place.
  afterRows(tab) {
    if (tab.pendingSelect) {
      const names = tab.pendingSelect.filter((n) => tab.byName.has(n));
      if (names.length) {
        tab.pendingSelect = null;
        tab.clearSel();
        names.forEach((n) => tab.sel.add(n));
        tab.anchor = tab.lead = tab.byName.get(names[0]);
        this.scrollTo(tab.lead);
        Panes.selectionChanged(this);
      }
    }
    if (tab.pendingRename && tab.byName.has(tab.pendingRename)) {
      const name = tab.pendingRename;
      tab.pendingRename = null;
      tab.clearSel();
      tab.sel.add(name);
      tab.anchor = tab.lead = tab.byName.get(name);
      this.scrollTo(tab.lead);
      requestAnimationFrame(() => this.startRename(name));
    }
  }

  // A selection or rename that waits for an item not loaded yet: its index is asked for, then rows around it.
  seek(names) {
    const tab = this.tab;
    call("view.index_of", { view: tab.id, name: names[0] })
      .then((d) => {
        if (d.index == null || this.tab !== tab) return;
        this.scrollTo(d.index);
        this.renderSoon();
      })
      .catch(() => {});
  }

  renderStatus() {
    const tab = this.tab;
    const parts = [tab.selCount() ? t("selectedOf", tab.selCount(), tab.count) : t("items", tab.count)];
    // What the selected files weigh, as File Explorer says it; a folder counts once its size is worked out. Only the
    // names picked one by one are added up, so drawing a frame never walks a huge folder.
    if (!tab.all && tab.sel.size && tab.sel.size <= 5000) {
      let bytes = 0;
      for (const name of tab.sel) {
        const e = tab.entry(name);
        bytes += (e && (e.isDir || e.kind === "app" || e.kind === "package" ? e.dirSize : e.size)) || 0;
      }
      if (bytes) parts.push(fmtSize(bytes));
    }
    if (tab.free != null) parts.push(t("available", fmtSize(tab.free)));
    this.status.textContent = tab.loading && !tab.generation ? "" : parts.join(", ");
  }

  indexAt(e) {
    const el = e.target.closest("[data-index]");
    if (!el) return null;
    const i = Number(el.dataset.index);
    return i < this.tab.count && this.tab.rows.has(i) ? i : null;
  }

  // Clicks in the list: select one, add with Command, a range with Shift; a click on nothing clears the selection.
  // A press beside the items (on nothing, or in a row away from its icon and name, as in Finder) draws a frame that
  // selects what it covers.
  pointer(e) {
    if (e.button !== 0 && e.button !== 2) return;
    if (e.target.classList.contains("rename")) return;
    this.list.focus({ preventScroll: true });
    const tab = this.tab;
    const i = this.indexAt(e);
    const onItem = i != null && (tab.mode === "icons" || tab.mode === "gallery" || !!e.target.closest(".name img, .name span"));
    const onScrollbar = e.target === this.list && e.offsetX >= this.list.clientWidth;
    if (e.button === 0 && !e.ctrlKey && !onItem && !onScrollbar) {
      if (i == null && !e.metaKey && !e.shiftKey) {
        tab.clearSel();
        this.render();
        Panes.selectionChanged(this);
      }
      return this.marquee(e, i);
    }
    if (i == null) return;
    const name = tab.rows.get(i).name;
    if (e.button === 2) {
      if (!tab.isSel(name)) this.selectOnly(i);
      return;
    }
    if (e.shiftKey && tab.anchor >= 0) {
      this.selectRange(tab.anchor, i);
    } else if (e.metaKey) {
      if (tab.all) {
        tab.except.has(name) ? tab.except.delete(name) : tab.except.add(name);
      } else {
        tab.sel.has(name) ? tab.sel.delete(name) : tab.sel.add(name);
      }
      tab.anchor = tab.lead = i;
      this.render();
    } else if (!tab.isSel(name) || tab.selCount() === 1) {
      this.selectOnly(i);
      // A click on the name of the only selected item, held still, would rename it in Finder; Enter does it here.
    }
    Panes.emit("pointerdown", { pane: this, event: e, index: i });
  }

  // The frame drawn from a press beside the items: what it covers is selected as it grows, added to what was selected
  // with Shift, turned over with Command; near the top or bottom edge the list scrolls on. Let go without moving, it
  // is a click on the row it began in.
  marquee(down, row) {
    const tab = this.tab;
    const start = this.contentPoint(down);
    const before = { all: tab.all, sel: new Set(tab.sel), except: new Set(tab.except) };
    let box = null;
    let at = down;
    let scrolling = 0;
    const update = () => {
      const p = this.contentPoint(at);
      const r = { left: Math.min(start.x, p.x), top: Math.min(start.y, p.y), right: Math.max(start.x, p.x), bottom: Math.max(start.y, p.y) };
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
      const hit = this.indicesIn(r);
      tab.all = before.all && (down.metaKey || down.shiftKey);
      tab.sel = down.metaKey || down.shiftKey ? new Set(before.sel) : new Set();
      tab.except = tab.all ? new Set(before.except) : new Set();
      for (const i of hit) {
        const name = tab.rows.get(i)?.name;
        if (name == null) continue;
        const was = tab.isSel(name);
        const want = down.metaKey ? !before.sel.has(name) && !(before.all && !before.except.has(name)) : true;
        if (want === was) continue;
        if (tab.all) want ? tab.except.delete(name) : tab.except.add(name);
        else want ? tab.sel.add(name) : tab.sel.delete(name);
      }
      if (hit.length) {
        tab.anchor = hit[0];
        tab.lead = hit[hit.length - 1];
        this.ensure(hit[0], hit[hit.length - 1] + 1);
      }
      this.render();
      this.renderStatus();
    };
    const edge = () => {
      const r = this.list.getBoundingClientRect();
      const dy = at.clientY < r.top + 12 ? at.clientY - r.top - 12 : at.clientY > r.bottom - 12 ? at.clientY - r.bottom + 12 : 0;
      if (dy && box) {
        this.list.scrollTop += Math.max(-28, Math.min(28, dy));
        update();
      }
      scrolling = dy ? requestAnimationFrame(edge) : 0;
    };
    const move = (m) => {
      if (!box && Math.hypot(m.clientX - down.clientX, m.clientY - down.clientY) < 4) return;
      if (!box) {
        box = document.createElement("div");
        box.className = "marquee";
        this.sizer.appendChild(box);
      }
      at = m;
      update();
      if (!scrolling) scrolling = requestAnimationFrame(edge);
    };
    const up = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
      cancelAnimationFrame(scrolling);
      if (box) {
        box.remove();
        Panes.selectionChanged(this);
        return;
      }
      // A click in a row away from its name: the row, as a click on its name would choose it.
      if (row == null || !tab.rows.has(row)) return;
      if (down.shiftKey && tab.anchor >= 0) this.selectRange(tab.anchor, row);
      else if (down.metaKey) {
        const name = tab.rows.get(row).name;
        if (tab.all) tab.except.has(name) ? tab.except.delete(name) : tab.except.add(name);
        else tab.sel.has(name) ? tab.sel.delete(name) : tab.sel.add(name);
        tab.anchor = tab.lead = row;
        this.render();
        Panes.selectionChanged(this);
      } else this.selectOnly(row);
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  }

  // A point of the window in the coordinates of the rows, which scroll with the list.
  contentPoint(e) {
    const r = this.sizer.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // The indices of the items a frame `r` (in row coordinates) covers: whole rows in a list, the cells of icons.
  indicesIn(r) {
    const tab = this.tab;
    const out = [];
    if (tab.mode !== "icons" && tab.mode !== "gallery") {
      for (let line = Math.max(0, Math.floor(r.top / ROW_H)); line <= Math.floor(r.bottom / ROW_H); line++) {
        const i = this.grouped() ? this.atLine(line) : line;
        if (i >= 0 && i < tab.count) out.push(i);
      }
      return out;
    }
    const side = ICON + 40;
    const covers = (left, top) => left < r.right && left + side > r.left && top < r.bottom && top + side > r.top;
    if (tab.mode === "gallery") {
      for (let i = Math.max(0, Math.floor(r.left / CELL_W) - 1); i < Math.min(tab.count, Math.ceil(r.right / CELL_W) + 1); i++) if (covers(i * CELL_W + 4, 6)) out.push(i);
      return out;
    }
    if (this.placeAt) {
      for (const [i, e] of tab.rows) if (covers(this.placeAt(i, e).left, this.placeAt(i, e).top)) out.push(i);
      return out.sort((a, b) => a - b);
    }
    const per = this.per || 1;
    const offset = Math.max(0, (this.list.clientWidth - 16 - per * CELL_W) / 2);
    const lastLine = Math.floor((r.bottom - 6) / CELL_H);
    for (let line = Math.max(0, Math.floor((r.top - 6 - side) / CELL_H)); line <= lastLine; line++) {
      for (let c = 0; c < per; c++) {
        const i = line * per + c;
        if (i >= tab.count) break;
        if (covers(c * CELL_W + offset, line * CELL_H + 6)) out.push(i);
      }
    }
    return out;
  }

  selectOnly(i) {
    const tab = this.tab;
    const e = tab.rows.get(i);
    tab.clearSel();
    if (e) tab.sel.add(e.name);
    tab.anchor = tab.lead = i;
    this.render();
    Panes.selectionChanged(this);
  }

  // Selects from `a` to `b`, asking for the rows in between that are not loaded.
  async selectRange(a, b) {
    const tab = this.tab;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    for (let start = lo; start <= hi; start += 500) {
      const missing = [...Array(Math.min(500, hi - start + 1)).keys()].some((k) => !tab.rows.has(start + k));
      if (!missing) continue;
      const d = await call("view.rows", { view: tab.id, start, count: 500, generation: tab.generation }).catch(() => null);
      if (!d) return;
      d.rows.forEach((row, k) => {
        tab.rows.set(start + k, row);
        tab.byName.set(row.name, start + k);
      });
    }
    tab.all = false;
    tab.except.clear();
    tab.sel.clear();
    for (let i = lo; i <= hi; i++) {
      const e = tab.rows.get(i);
      if (e) tab.sel.add(e.name);
    }
    tab.lead = b;
    this.render();
    Panes.selectionChanged(this);
  }

  selectAll() {
    const tab = this.tab;
    tab.all = true;
    tab.except.clear();
    tab.sel.clear();
    this.render();
    Panes.selectionChanged(this);
  }

  // Moves the cursor by `delta` rows (or to the start or end), extending the selection with Shift.
  move(delta, extend) {
    const tab = this.tab;
    if (!tab.count) return;
    let i = tab.lead < 0 ? (delta > 0 ? 0 : tab.count - 1) : tab.lead + delta;
    i = Math.max(0, Math.min(tab.count - 1, i));
    this.scrollTo(i);
    const go = () => {
      if (!tab.rows.has(i)) return;
      if (extend && tab.anchor >= 0) this.selectRange(tab.anchor, i);
      else this.selectOnly(i);
    };
    if (tab.rows.has(i)) go();
    else {
      this.ensure(i, i + 1);
      setTimeout(go, 60);
    }
  }

  scrollTo(i) {
    if (this.tab?.mode === "gallery") {
      const left = i * CELL_W;
      if (left < this.list.scrollLeft) this.list.scrollLeft = left;
      else if (left + CELL_W > this.list.scrollLeft + this.list.clientWidth) this.list.scrollLeft = left + CELL_W - this.list.clientWidth;
      return;
    }
    const line = this.grouped() ? this.lineOf(i) : Math.floor(i / (this.per || 1));
    const top = line * (this.rowH || ROW_H);
    const bottom = top + (this.rowH || ROW_H);
    if (top < this.list.scrollTop) this.list.scrollTop = top;
    else if (bottom > this.list.scrollTop + this.list.clientHeight) this.list.scrollTop = bottom - this.list.clientHeight;
  }

  // Typing a name finds it, as in Finder; what is typed within a second adds up.
  find(char) {
    const tab = this.tab;
    clearTimeout(this.findTimer);
    this.typed = (this.typed || "") + char;
    this.findTimer = setTimeout(() => (this.typed = ""), 1000);
    call("view.find", { view: tab.id, prefix: this.typed })
      .then((d) => {
        if (d.index == null) return;
        this.scrollTo(d.index);
        if (tab.rows.has(d.index)) this.selectOnly(d.index);
        else {
          this.ensure(d.index, d.index + 1);
          setTimeout(() => tab.rows.has(d.index) && this.selectOnly(d.index), 80);
        }
      })
      .catch(() => {});
  }

  // Renames in place: the name becomes a field with the part before the extension selected.
  startRename(name) {
    const tab = this.tab;
    const i = tab.byName.get(name);
    if (i == null || !tab.capabilities.rename) return;
    this.scrollTo(i);
    this.render();
    const el = this.pool.get(i);
    const label = el?.querySelector(tab.mode === "icons" ? ".label" : ".name span");
    if (!label) return;
    this.renaming = { index: i, name };
    const input = document.createElement("input");
    input.className = "rename";
    input.value = name;
    input.spellcheck = false;
    label.replaceWith(input);
    const entry = tab.rows.get(i);
    const dot = entry && !entry.isDir && name.lastIndexOf(".") > 0 ? name.lastIndexOf(".") : name.length;
    input.focus();
    input.setSelectionRange(0, dot);
    const finish = (commit) => {
      if (!this.renaming) return;
      const value = input.value.trim();
      this.renaming = null;
      el.dataset.key = "";
      this.list.focus({ preventScroll: true });
      if (!commit || !value || value === name) {
        this.render();
        return;
      }
      call("fs.rename", { uri: entry.uri, name: value })
        .then(() => {
          tab.pendingSelect = [value];
          this.refresh();
        })
        .catch((error) => {
          say(error);
          this.render();
        });
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }

  cancelRename() {
    this.renaming = null;
  }

  // The path bar as a field: type a path or a part of one, with the places gone to before that hold it offered first
  // (those typed before them) and the folders that complete it after; Enter goes there, and the place is kept in the
  // history as typed. Down with nothing offered lists the history; Shift-Delete takes the offered place out of it.
  editAddress() {
    if (this.crumbs.querySelector(".address")) return;
    const input = document.createElement("input");
    input.className = "address";
    input.spellcheck = false;
    // A place on this Mac as its path; any other as its URI, which the field takes back as it is.
    input.value = isLocal(this.tab.uri) ? pathOf(this.tab.uri) : this.tab.uri || "";
    this.crumbs.innerHTML = "";
    this.crumbs.appendChild(input);
    this.box.classList.add("editing");
    input.focus();
    input.select();
    let list = null;
    let items = [];
    let at = -1;
    let history = [];
    call("history.list")
      .then((h) => (history = h))
      .catch(() => {});
    const close = () => {
      list?.remove();
      list = null;
    };
    const show = () => {
      if (!items.length) return close();
      if (!list) {
        list = document.createElement("div");
        list.className = "suggest";
        document.body.appendChild(list);
        list.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const div = e.target.closest("[data-i]");
          if (div) take(items[Number(div.dataset.i)]);
        });
      }
      const r = this.box.getBoundingClientRect();
      list.style.left = `${r.left}px`;
      list.style.top = `${r.bottom + 4}px`;
      list.style.width = `${r.width}px`;
      list.innerHTML = items.map((it, i) => `<div data-i="${i}" class="${i === at ? "on" : ""}">${icon(it.uri ? "history" : "folder")}<span>${esc(it.label)}</span></div>`).join("");
    };
    const past = (text) => {
      const folded = text.toLowerCase();
      return history
        .filter((p) => !samePlace(p.uri, this.tab.uri) && (!folded || placeLabel(p.uri).toLowerCase().includes(folded) || pathOf(p.uri).toLowerCase().includes(folded)))
        .sort((a, b) => b.typed - a.typed)
        .slice(0, folded ? 6 : 20)
        .map((p) => ({ label: placeLabel(p.uri), uri: p.uri }));
    };
    let timer;
    const suggest = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const text = input.value.trim();
        const before = past(text);
        const local = text.startsWith("/") || text.startsWith("~");
        const folders = local ? ((await call("fs.complete", { text }).catch(() => null))?.items ?? []) : [];
        if (!input.isConnected || input.value.trim() !== text) return;
        const known = new Set(before.filter((b) => isLocal(b.uri)).map((b) => `${pathOf(b.uri)}/`));
        items = [...before, ...folders.filter((f) => !known.has(f)).map((f) => ({ label: f, value: f }))];
        at = -1;
        show();
      }, 60);
    };
    // A place from the history goes at once; a folder that completes the path goes into the field to type on.
    const take = (item) => {
      if (item.uri) return done(true, item.uri);
      input.value = item.value;
      input.focus();
      suggest();
    };
    const done = (go, uri) => {
      clearTimeout(timer);
      close();
      const value = input.value.trim();
      input.remove();
      this.box.classList.remove("editing");
      this.renderPath();
      if (!go) return;
      if (uri) return this.goTyped(uri);
      if (!value) return;
      const home = S.places.home ? pathOf(S.places.home) : "";
      const path = value === "~" ? home : value.startsWith("~/") ? home + value.slice(1) : value;
      if (path.startsWith("/")) this.goTyped(fileUri(path.replace(/\/+$/, "") || "/"));
      else if (/^[a-z0-9+-]+:\/\//.test(path)) this.goTyped(path);
      else say(t("notAPath"));
    };
    input.addEventListener("input", suggest);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        if (at >= 0 && items[at]?.uri) return done(true, items[at].uri);
        if (at >= 0) input.value = items[at].value;
        done(true);
      } else if (e.key === "Escape") done(false);
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!items.length && e.key === "ArrowDown") {
          items = past("");
          at = items.length ? 0 : -1;
          return show();
        }
        if (!items.length) return;
        at = (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        show();
      } else if (e.key === "Tab" && items.length) {
        e.preventDefault();
        const item = items[Math.max(0, at)];
        if (item.uri) {
          input.value = isLocal(item.uri) ? pathOf(item.uri) : item.uri;
          suggest();
        } else take(item);
      } else if (e.key === "Delete" && e.shiftKey && items[at]?.uri) {
        e.preventDefault();
        const gone = items[at].uri;
        history = history.filter((p) => p.uri !== gone);
        call("history.remove", { uri: gone }).catch(() => {});
        items.splice(at, 1);
        at = Math.min(at, items.length - 1);
        show();
      }
    });
    input.addEventListener("blur", () => setTimeout(() => input.isConnected && done(false), 120));
  }

  // Goes to a place the user typed or picked in the path bar; the history keeps it as typed once it opens.
  goTyped(uri) {
    this.tab.typed = uri;
    this.navigate(uri);
  }

  // Tabs: a new one opens where the current one is, or at `uri` with the names of `select` selected once listed. It
  // goes at the end, or `at`; one opened in the background lists when it is first shown.
  newTab(uri, select = null, { background = false, at = this.tabs.length } = {}) {
    const from = this.tab?.uri;
    const tab = new Tab(null, this.tab?.mode);
    this.tabs.splice(at, 0, tab);
    if (background) {
      tab.uri = uri || from || S.places.home;
      if (at <= this.active) this.active++;
      this.renderTabs();
      Panes.saveSoon();
      return;
    }
    this.active = at;
    this.navigate(uri || from || S.places.home, { history: false, select });
  }

  // Drags tab `i` along the bar, or to the bar of another pane: a line shows where it would go.
  dragTab(down, i) {
    const el = this.tabStrip.children[i];
    if (!el) return;
    const caret = document.createElement("div");
    caret.className = "tab-caret";
    let moving = false;
    let target = null;
    const move = (m) => {
      if (!moving && Math.hypot(m.clientX - down.clientX, m.clientY - down.clientY) < 5) return;
      moving = true;
      el.classList.add("lifted");
      el.style.transform = `translateX(${m.clientX - down.clientX}px)`;
      target = Panes.tabDropAt(m.clientX, m.clientY, el);
      if (!target) return caret.remove();
      target.pane.tabsEl.appendChild(caret);
      caret.style.left = `${target.x}px`;
    };
    const up = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
      caret.remove();
      el.classList.remove("lifted");
      el.style.transform = "";
      if (moving && target) Panes.moveTab(this, i, target.pane, target.index);
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  }

  // The menu of tab `i`, as File Explorer and the browsers have it.
  async tabMenu(i, x, y) {
    const n = this.tabs.length;
    const other = Panes.all().find((p) => p !== this);
    const id = await LZ.choose(
      [
        { id: "new", label: t("newTab"), icon: "plus" },
        { id: "duplicate", label: t("duplicateTab"), icon: "plus.square.on.square" },
        { id: "window", label: t("tabToWindow"), icon: "macwindow.badge.plus" },
        ...(other ? [{ id: "other", label: t("tabToOtherPane"), icon: "arrow.right.square" }] : []),
        { separator: true },
        { id: "close", label: t("closeTab"), icon: "xmark", enabled: n > 1 },
        { id: "others", label: t("closeOtherTabs"), enabled: n > 1 },
        { id: "right", label: t("closeTabsRight"), enabled: i < n - 1 },
        { separator: true },
        { id: "reopen", label: t("cmd.reopenTab"), icon: "arrow.uturn.backward" },
      ],
      x,
      y,
    );
    const tab = this.tabs[i];
    if (!tab) return;
    if (id === "new") this.newTab();
    else if (id === "duplicate") this.newTab(tab.uri, null, { at: i + 1 });
    else if (id === "window") {
      call("app.new_window", { uri: tab.uri }).catch(say);
      if (n > 1) this.closeTab(i);
    } else if (id === "other") Panes.moveTab(this, i, other, other.tabs.length);
    else if (id === "close") this.closeTab(i);
    else if (id === "others") {
      for (let k = n - 1; k >= 0; k--) if (k !== i) this.closeTab(k);
    } else if (id === "right") {
      for (let k = n - 1; k > i; k--) this.closeTab(k);
    } else if (id === "reopen") Panes.action("reopenTab", this);
  }

  activate(i) {
    if (i === this.active || !this.tabs[i]) return;
    this.cancelRename();
    this.active = i;
    const tab = this.tab;
    // A tab restored with the window lists the first time it is shown.
    if (!tab.requested) {
      const uri = tab.uri;
      tab.uri = null;
      this.navigate(uri, { history: false });
    } else {
      this.renderAll();
      Panes.changed(this);
    }
  }

  closeTab(i) {
    if (this.tabs.length < 2) return;
    const [tab] = this.tabs.splice(i, 1);
    call("view.close", { view: tab.id }).catch(() => {});
    if (this.active >= this.tabs.length) this.active = this.tabs.length - 1;
    else if (i < this.active) this.active--;
    this.renderAll();
    Panes.changed(this);
  }
}

const Panes = (() => {
  const grid = $("paneGrid");
  const panes = [];
  let focused = null;
  let saveTimer;
  const listeners = {};
  const cut = new Set();

  function emit(name, detail) {
    for (const fn of listeners[name] || []) fn(detail);
  }

  function addPane(tabs) {
    const pane = new Pane(panes.length);
    panes.push(pane);
    grid.appendChild(pane.el);
    for (const saved of tabs) {
      const tab = new Tab(saved.uri, saved.mode);
      tab.sort = saved.sort || null;
      pane.tabs.push(tab);
    }
    return pane;
  }

  function focus(pane) {
    if (focused === pane) return;
    focused?.el.classList.remove("focus");
    focused = pane;
    pane.el.classList.add("focus");
    Toolbar.update();
    Sidebar.mark();
    emit("selection", { pane });
  }

  // The tab of the focused pane.
  const current = () => focused?.tab;

  function findTab(id) {
    for (const pane of panes) {
      const tab = pane.tabs.find((t) => t.id === id);
      if (tab) return [pane, tab];
    }
    return null;
  }

  // The pane's place changed: the window's title, the sidebar and the toolbar follow, and the layout is kept.
  function changed(pane) {
    if (pane === focused) {
      Toolbar.update();
      Sidebar.mark();
    }
    saveSoon();
  }

  function selectionChanged(pane) {
    pane.renderStatus();
    emit("selection", { pane });
  }

  // The window as layout.json and workspaces keep it.
  function state() {
    return {
      layout: grid.dataset.layout,
      focus: panes.indexOf(focused),
      sidebarWidth: Sidebar.width(),
      sidebarHidden: $("app").classList.contains("no-sidebar"),
      panes: panes.map((p) => ({ active: p.active, cols: p.cols, tabs: p.tabs.map((tab) => ({ uri: tab.uri, mode: tab.mode, sort: tab.sort })) })),
    };
  }

  function saveSoon() {
    if (S.window.role !== "main") return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => call("panes.state", { state: state() }).catch(() => {}), 500);
  }

  // Replaces the panes of the window by those of `saved` (a workspace).
  function load(saved) {
    for (const pane of panes) {
      for (const tab of pane.tabs) call("view.close", { view: tab.id }).catch(() => {});
      pane.el.remove();
    }
    panes.length = 0;
    focused = null;
    $("app").classList.remove("no-sidebar");
    start(saved);
    saveSoon();
  }

  // Builds the panes from the layout the window had (layout.json), or one pane at home.
  function start(saved, uri) {
    const home = S.places.home || "file:///";
    const layouts = Array.isArray(saved?.panes) && saved.panes.length ? saved.panes.slice(0, 4) : [{ tabs: [{ uri: home }] }];
    if (saved?.sidebarWidth) $("app").style.setProperty("--side-w", saved.sidebarWidth);
    if (saved?.sidebarHidden) $("app").classList.add("no-sidebar");
    grid.dataset.layout = LAYOUTS[saved?.layout] ? saved.layout : "single";
    for (const p of layouts) {
      const tabs = (Array.isArray(p.tabs) ? p.tabs : []).filter((t) => typeof t?.uri === "string").slice(0, 20);
      const pane = addPane(tabs.length ? tabs : [{ uri: home }]);
      pane.active = Math.min(Math.max(0, p.active | 0), pane.tabs.length - 1);
      if (p.cols) Object.assign(pane.cols, p.cols);
      pane.applyCols();
    }
    // A layout with more panes than were saved gets panes at home.
    while (panes.length < LAYOUTS[grid.dataset.layout]) addPane([{ uri: home }]);
    while (panes.length > LAYOUTS[grid.dataset.layout]) panes.pop().el.remove();
    $("app").classList.toggle("multi", panes.length > 1);
    paintLayoutButton();
    if (uri) panes[0].tab.uri = uri;
    api.sizesOn = !!S.settings.folder_sizes;
    focus(panes[Math.min(Math.max(0, saved?.focus | 0), panes.length - 1)]);
    for (const pane of panes) {
      const tab = pane.tab;
      const target = tab.uri;
      tab.uri = null;
      pane.navigate(target, { history: false });
    }
    // Every other tab lists when it is first shown.
    focused.list.focus({ preventScroll: true });
  }

  // Changes the number and arrangement of panes; a new pane opens where the focused one is, a pane that goes closes
  // its tabs.
  function setLayout(layout) {
    const n = LAYOUTS[layout];
    if (!n) return;
    grid.dataset.layout = layout;
    $("app").classList.toggle("multi", n > 1);
    while (panes.length < n) {
      const pane = addPane([{ uri: focused?.tab?.uri || S.places.home }]);
      const uri = pane.tab.uri;
      pane.tab.uri = null;
      pane.navigate(uri, { history: false });
    }
    while (panes.length > n) {
      const pane = panes.pop();
      for (const tab of pane.tabs) call("view.close", { view: tab.id }).catch(() => {});
      pane.el.remove();
      if (focused === pane) {
        focused = null;
        focus(panes[panes.length - 1]);
      }
    }
    panes.forEach((p, i) => {
      p.index = i;
      p.el.dataset.pane = `p${i}`;
      p.renderSoon();
    });
    paintLayoutButton();
    saveSoon();
  }

  function paintLayoutButton() {
    const layout = grid.dataset.layout;
    if (!api.layoutButton) return;
    api.layoutButton.dataset.sym = `layout.${layout === "h3" ? "h2" : layout === "l1r2" ? "grid" : layout}`;
    api.layoutButton.innerHTML = icon(api.layoutButton.dataset.sym);
  }

  // Moves the focus to the next pane (or the previous one), as Tab does in QSpace.
  function cycle(step) {
    if (panes.length < 2) return;
    const next = panes[(panes.indexOf(focused) + step + panes.length) % panes.length];
    focus(next);
    next.list.focus({ preventScroll: true });
  }

  // Where a tab dragged to (x, y) would go: the pane whose tab bar is under the point, the index among its tabs (the
  // dragged one, `el`, left out) and where the line that shows it goes in that bar.
  function tabDropAt(x, y, el) {
    for (const pane of panes) {
      if (pane.tabsEl.hidden) continue;
      const bar = pane.tabsEl.getBoundingClientRect();
      if (x < bar.left || x > bar.right || y < bar.top - 14 || y > bar.bottom + 14) continue;
      const others = [...pane.tabStrip.children].filter((t) => t !== el);
      let index = others.findIndex((t) => {
        const r = t.getBoundingClientRect();
        return x < r.left + r.width / 2;
      });
      if (index < 0) index = others.length;
      const edge = others[index] ? others[index].getBoundingClientRect().left - 3 : (others[others.length - 1]?.getBoundingClientRect().right ?? bar.left + 8) + 1;
      return { pane, index, x: edge - bar.left };
    }
    return null;
  }

  // Moves tab `i` of `from` to `index` among the tabs of `to`, where it shows. The last tab of a pane is copied, so no
  // pane is left without one.
  function moveTab(from, i, to, index) {
    const tab = from.tabs[i];
    if (!tab) return;
    if (from === to) {
      from.tabs.splice(i, 1);
      from.tabs.splice(index, 0, tab);
      from.active = index;
      from.renderTabs();
      return saveSoon();
    }
    if (from.tabs.length < 2) return to.newTab(tab.uri, null, { at: index });
    from.tabs.splice(i, 1);
    const left = i < from.active ? from.active - 1 : Math.min(from.active, from.tabs.length - 1);
    from.active = -1;
    from.activate(left);
    to.tabs.splice(index, 0, tab);
    to.active = -1;
    to.activate(index);
    focus(to);
    saveSoon();
  }

  // The places back (or forward) of the pane's tab, nearest first, as a menu; the one chosen is gone to as if by that
  // many steps, so the steps between stay on the other side.
  async function stackMenu(pane, way, x, y) {
    const tab = pane.tab;
    const stack = way === "back" ? tab.back : tab.forward;
    if (!stack.length) return;
    const nearest = [...stack].reverse();
    const id = await LZ.choose(nearest.map((uri, k) => ({ id: String(k), label: placeLabel(uri), icon: "folder" })), x, y);
    if (id == null) return;
    const at = stack.length - 1 - Number(id);
    const to = stack[at];
    const passed = stack.splice(at).slice(1).reverse();
    const other = way === "back" ? tab.forward : tab.back;
    other.push(tab.uri, ...passed);
    pane.navigate(to, { history: false, select: way === "back" ? pane.childOf(to) : null });
  }

  // Opens a place in the focused pane.
  function open(uri, options) {
    focused?.navigate(uri, options);
    focused?.list.focus({ preventScroll: true });
  }

  // The actions of the keymap, the menu bar and the toolbar, on a pane (the focused one by default).
  const actions = {
    open(pane) {
      const tab = pane.tab;
      const entries = tab.selectedEntries();
      if (!entries.length) return;
      // A kind a feature opens as a folder (an archive) is browsed into; the rest the system opens.
      const into = entries.map((e) => (e.isDir ? e.uri : LZ.vfs.browse(e))).filter(Boolean);
      const files = entries.filter((e) => !e.isDir && !LZ.vfs.browse(e));
      if (into.length === 1 && !files.length) return pane.navigate(into[0]);
      for (const uri of into) pane.newTab(uri);
      if (files.length) call("native.open", { uris: files.map((f) => f.uri) }).catch(say);
    },
    openInNewTab(pane) {
      for (const e of pane.tab.selectedEntries().filter((e) => e.isDir)) pane.newTab(e.uri);
    },
    quickLook(pane) {
      const tab = pane.tab;
      if (!tab.selCount()) return;
      const lead = tab.rows.get(tab.lead);
      const selected = tab.selectedEntries();
      const index = Math.max(0, selected.findIndex((e) => e === lead));
      call("native.quicklook", { ...tab.selection(), index }).catch(say);
    },
    duplicate(pane) {
      const tab = pane.tab;
      const uris = tab.selectedEntries().map((e) => e.uri);
      if (uris.length && tab.capabilities.write) call("fs.copy", { from: uris, to: tab.uri, mode: "copy" }).catch(say);
    },
    getInfo(pane) {
      if (pane.tab.selCount()) call("native.get_info", pane.tab.selection()).catch(say);
      else call("native.get_info", { uris: [pane.tab.uri] }).catch(say);
    },
    reveal(pane) {
      const sel = pane.tab.selCount() ? pane.tab.selection() : { uris: [pane.tab.uri] };
      call("native.reveal", sel).catch(say);
    },
    copyPath(pane) {
      const entries = pane.tab.selectedEntries();
      const text = (entries.length ? entries.map((e) => pathOf(e.uri)) : [pathOf(pane.tab.uri)]).join("\n");
      call("clipboard.text", { text }).then(() => toast(t("pathCopied")), say);
    },
    nextPane() {
      cycle(1);
    },
    previousPane() {
      cycle(-1);
    },
    layoutSingle: () => setLayout("single"),
    layoutH2: () => setLayout("h2"),
    layoutV2: () => setLayout("v2"),
    layoutH3: () => setLayout("h3"),
    layoutL1R2: () => setLayout("l1r2"),
    layoutGrid: () => setLayout("grid"),
    back(pane) {
      const tab = pane.tab;
      if (!tab.back.length) return;
      const from = tab.uri;
      tab.forward.push(from);
      const to = tab.back.pop();
      pane.navigate(to, { history: false, select: pane.childOf(to) });
    },
    forward(pane) {
      const tab = pane.tab;
      if (!tab.forward.length) return;
      tab.back.push(tab.uri);
      pane.navigate(tab.forward.pop(), { history: false });
    },
    enclosing(pane) {
      const uri = pane.tab.uri;
      const path = pathOf(uri);
      if (uri.startsWith("archive://")) {
        const cut = path.indexOf("!");
        const archive = path.slice(0, cut);
        const inside = path.slice(cut + 1).replace(/^\/|\/$/g, "");
        if (!inside) return pane.navigate(fileUri(archive.slice(0, archive.lastIndexOf("/")) || "/"), { select: [archive.split("/").pop()] });
        const up = inside.includes("/") ? inside.slice(0, inside.lastIndexOf("/")) : "";
        return pane.navigate(archiveUri(archive, up), { select: [inside.split("/").pop()] });
      }
      if (path === "/") return;
      const parent = path.slice(0, path.lastIndexOf("/")) || "/";
      pane.navigate(withPath(uri, parent), { select: [path.split("/").pop()] });
    },
    rename(pane) {
      const tab = pane.tab;
      if (tab.selCount() !== 1) return;
      const name = tab.all ? null : [...tab.sel][0];
      if (name) pane.startRename(name);
    },
    trash(pane) {
      const tab = pane.tab;
      if (!tab.selCount()) return;
      if (!tab.capabilities.trash) return actions.delete(pane);
      call("fs.trash", tab.selection()).catch(say);
    },
    async delete(pane) {
      const tab = pane.tab;
      const n = tab.selCount();
      if (!n) return;
      const ok = await confirmSheet(t("deleteTitle", n), t("deleteText"), t("deleteNow"));
      if (ok) call("fs.delete", tab.selection()).catch(say);
    },
    newFolder(pane) {
      const tab = pane.tab;
      if (!tab.capabilities.write) return;
      call("fs.mkdir", { uri: tab.uri })
        .then((entry) => {
          tab.pendingRename = entry.name;
          pane.refresh();
        })
        .catch(say);
    },
    selectAll(pane) {
      pane.selectAll();
    },
    selectNone(pane) {
      pane.tab.clearSel();
      pane.render();
      selectionChanged(pane);
    },
    // Everything not selected becomes selected and the other way round, without loading a huge folder's rows: all but
    // some, turned over, is just those.
    invertSelection(pane) {
      const tab = pane.tab;
      const kept = tab.all ? new Set(tab.except) : null;
      if (kept) {
        tab.clearSel();
        kept.forEach((name) => tab.sel.add(name));
      } else {
        const except = new Set(tab.sel);
        tab.clearSel();
        tab.all = true;
        except.forEach((name) => tab.except.add(name));
      }
      pane.render();
      selectionChanged(pane);
    },
    // Each selected folder, or the pane's own when none is, in a window of its own.
    openInNewWindow(pane) {
      const folders = pane.tab.selectedEntries().filter((e) => e.isDir);
      for (const uri of (folders.length ? folders.map((e) => e.uri) : [pane.tab.uri]).slice(0, 8)) call("app.new_window", { uri }).catch(say);
    },
    copy(pane) {
      if (pane.tab.selCount()) call("clipboard.copy", pane.tab.selection()).then(updateCut, say);
    },
    cut(pane) {
      if (pane.tab.selCount()) call("clipboard.cut", pane.tab.selection()).then(updateCut, say);
    },
    paste(pane) {
      call("clipboard.paste", { to: pane.tab.uri }).catch(say);
    },
    undo() {
      call("fs.undo").catch(say);
    },
    toggleHidden() {
      setSetting({ show_hidden: !S.settings.show_hidden });
    },
    viewList(pane) {
      setMode(pane, "list");
    },
    viewIcons(pane) {
      setMode(pane, "icons");
    },
    viewColumns(pane) {
      setMode(pane, "columns");
    },
    viewGallery(pane) {
      setMode(pane, "gallery");
    },
    newTab(pane) {
      pane.newTab();
    },
    closeTab(pane) {
      pane.closeTab(pane.active);
    },
    editAddress(pane) {
      pane.editAddress();
    },
    find() {
      Toolbar.openSearch();
    },
    deselect(pane) {
      pane.tab.clearSel();
      pane.render();
      selectionChanged(pane);
    },
    toggleSidebar() {
      Sidebar.toggle();
    },
    home(pane) {
      pane.navigate(S.places.home);
    },
    desktop(pane) {
      pane.navigate(S.places.desktop);
    },
    downloads(pane) {
      pane.navigate(S.places.downloads);
    },
    applications(pane) {
      pane.navigate(S.places.applications);
    },
  };

  function action(name, pane = focused) {
    const fn = actions[name];
    if (fn && pane) fn(pane);
    return !!fn;
  }

  function setMode(pane, mode) {
    pane.tab.mode = mode;
    pane.list.scrollTop = 0;
    pane.renderAll();
    Toolbar.update();
    saveSoon();
    setSetting({ view_mode: mode });
  }

  // The items that were cut are drawn faded until they are pasted or the clipboard changes.
  function updateCut() {
    call("clipboard.state")
      .then((d) => {
        cut.clear();
        d.cut.forEach((u) => cut.add(u));
        panes.forEach((p) => p.render());
      })
      .catch(() => {});
  }

  on("view.changed", (d) => {
    const found = findTab(d.view);
    if (!found) return;
    const [pane, tab] = found;
    // A place opened in a main window goes into the path history, once, as typed when it came from the path bar.
    if (S.window.role === "main" && !samePlace(tab.recorded, d.uri)) {
      tab.recorded = d.uri;
      call("history.add", { uri: d.uri, typed: samePlace(tab.typed, d.uri) }).catch(() => {});
      tab.typed = null;
    }
    tab.uri = d.uri;
    tab.generation = d.generation;
    tab.count = d.count;
    tab.capabilities = d.capabilities;
    tab.groups = d.groups || [];
    tab.free = d.free;
    tab.loading = false;
    tab.error = null;
    tab.rows = new Map();
    tab.byName = new Map();
    if (pane.tab === tab) {
      pane.renderAll();
      if (tab.pendingSelect) pane.seek(tab.pendingSelect);
      if (tab.pendingRename) pane.seek([tab.pendingRename]);
    }
    if (pane === focused) {
      Toolbar.update();
      Sidebar.mark();
    }
  });
  on("view.error", (d) => {
    const found = findTab(d.view);
    if (!found) return;
    const [pane, tab] = found;
    tab.loading = false;
    tab.error = d.error;
    if (pane.tab === tab) pane.renderAll();
  });
  on("view.sizes", (d) => {
    const found = findTab(d.view);
    if (!found) return;
    const [pane, tab] = found;
    if (d.generation !== tab.generation) return;
    for (const [name, size] of Object.entries(d.sizes)) {
      const row = tab.entry(name);
      if (row) row.dirSize = size;
    }
    if (pane.tab === tab) pane.render();
  });
  let shownColumns = null;
  on("settings.changed", (s) => {
    const columns = JSON.stringify(s.columns);
    const recolumn = shownColumns !== null && columns !== shownColumns;
    shownColumns = columns;
    for (const pane of panes) {
      pane.renderTabs();
      if (recolumn) {
        pane.applyCols();
        pane.renderAll();
      }
      for (const tab of pane.tabs) {
        if (pane.tab === tab && tab.generation && !!s.show_hidden !== tab.showHidden) {
          tab.showHidden = !!s.show_hidden;
          call("view.hidden", { view: tab.id, show: tab.showHidden })
            .then((d) => pane.tab === tab && pane.regenerate(d.generation, d.count, d.groups))
            .catch(() => {});
        }
      }
      if (!!s.folder_sizes !== api.sizesOn && pane.tab.generation) call("fs.sizes", { view: pane.tab.id, on: !!s.folder_sizes }).catch(() => {});
    }
    api.sizesOn = !!s.folder_sizes;
  });
  on("jobs.finished", (d) => {
    if (d.ok && d.data?.names?.length && d.data.to) {
      const pane = panes.find((p) => samePlace(p.tab.uri, d.data.to));
      if (pane) pane.tab.pendingSelect = d.data.names;
    }
    // The watcher brings local changes in too; a place it does not follow is brought up to date here.
    for (const pane of panes) if (pane.tab.generation && !isLocal(pane.tab.uri)) pane.refresh();
    updateCut();
  });

  const api = {
    start,
    open,
    setLayout,
    state,
    load,
    focus,
    current,
    focused: () => focused,
    all: () => panes,
    findTab,
    tabDropAt,
    moveTab,
    stackMenu,
    changed,
    selectionChanged,
    saveSoon,
    action,
    actions,
    emit,
    on(name, fn) {
      (listeners[name] ||= []).push(fn);
    },
    cut,
    sizesOn: false,
  };
  return api;
})();

words({
  vi: { pathCopied: "Đã sao chép đường dẫn", deleteTitle: "Xóa hẳn {0} mục?", deleteText: "Các mục này sẽ bị xóa ngay, không qua Thùng rác. Không hoàn tác được.", deleteNow: "Xóa", notAPath: "Hãy nhập một đường dẫn bắt đầu bằng / hoặc ~" },
  en: { pathCopied: "Path copied", deleteTitle: "Delete {0} items for good?", deleteText: "These items will be deleted at once, without the Trash. This cannot be undone.", deleteNow: "Delete", notAPath: "Type a path that starts with / or ~" },
});
