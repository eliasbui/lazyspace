// The panes of the window, each with its tabs, its path bar, its columns and its rows. The rows live in Rust
// (src/views.rs): a pane draws only what is on screen and asks for those rows by range and generation.
words({
  vi: {
    colName: "Tên", colModified: "Ngày sửa đổi", colSize: "Kích thước", colKind: "Loại", loading: "Đang tải...", emptyFolder: "Thư mục trống",
    noMatch: "Không có mục nào khớp", newTab: "Tab mới", closeTab: "Đóng tab", filterPane: "Lọc", openPrivacy: "Mở Quyền riêng tư",
  },
  en: {
    colName: "Name", colModified: "Date Modified", colSize: "Size", colKind: "Kind", loading: "Loading...", emptyFolder: "This folder is empty",
    noMatch: "Nothing matches", newTab: "New Tab", closeTab: "Close Tab", filterPane: "Filter", openPrivacy: "Open Privacy Settings",
  },
});

const ROW_H = 24;
const CELL_W = 108;
const CELL_H = 118;
const COLUMNS = [
  ["name", "colName"],
  ["mtime", "colModified"],
  ["size", "colSize"],
  ["kind", "colKind"],
];
const fileUri = (path) => `file://${path.split("/").map(encodeURIComponent).join("/")}`;

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
    this.cols = { mtime: 160, size: 86, kind: 150 };
    this.pool = new Map();
    this.fetching = false;
    this.renaming = null;
    this.el = document.createElement("section");
    this.el.className = "pane";
    this.el.dataset.pane = `p${index}`;
    this.el.innerHTML = `
      <div class="tabs"></div>
      <div class="pathbar">
        <button class="nav" data-act="back">${icon("chevron.left")}</button>
        <button class="nav" data-act="forward">${icon("chevron.right")}</button>
        <div class="crumbs"></div>
        <button class="tool" data-act="filter">${icon("search")}</button>
      </div>
      <div class="head"></div>
      <div class="list" tabindex="0"><div class="sizer"></div><div class="message" hidden></div></div>
      <div class="status"></div>
      <div class="pane-overlay"></div>`;
    const q = (s) => this.el.querySelector(s);
    this.tabsEl = q(".tabs");
    this.path = q(".pathbar");
    this.crumbs = q(".crumbs");
    this.head = q(".head");
    this.list = q(".list");
    this.sizer = q(".sizer");
    this.message = q(".message");
    this.status = q(".status");
    this.overlay = q(".pane-overlay");
    this.applyCols();
    this.bind();
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
      if (this.indexAt(e) != null) Panes.action("open", this);
    });
    this.list.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      Panes.emit("contextmenu", { pane: this, event: e, index: this.indexAt(e) });
    });
    this.path.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "back") Panes.action("back", this);
      else if (act === "forward") Panes.action("forward", this);
      else if (act === "filter") $("searchInput").focus();
      const crumb = e.target.closest(".crumb");
      if (crumb) this.navigate(crumb.dataset.uri, { select: this.childOf(crumb.dataset.uri) });
      else if (e.target === this.crumbs) this.editAddress();
    });
    this.crumbs.addEventListener("dblclick", (e) => {
      if (!e.target.closest(".crumb")) this.editAddress();
    });
    this.head.addEventListener("click", (e) => {
      const col = e.target.closest("[data-col]");
      if (col && !e.target.classList.contains("grip")) this.sortBy(col.dataset.col);
    });
    this.head.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("grip")) this.resizeColumn(e, e.target.dataset.grip);
    });
    this.tabsEl.addEventListener("mousedown", (e) => {
      const x = e.target.closest(".x");
      const tab = e.target.closest(".tab");
      if (x) this.closeTab(Number(x.dataset.i));
      else if (tab) this.activate(Number(tab.dataset.i));
    });
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
      .then((d) => this.regenerate(d.generation))
      .catch(say);
    setSetting({ sort });
    this.renderHead();
    Panes.saveSoon();
  }

  // A new generation of the same listing (sorted or filtered again): the rows go and come back in the new order.
  regenerate(generation, count) {
    const tab = this.tab;
    tab.generation = generation;
    if (count != null) tab.count = count;
    tab.rows = new Map();
    tab.byName = new Map();
    this.renderAll();
  }

  // The columns a pane of this width shows, as QSpace drops columns in a narrow pane: all four from 600 points, no
  // Kind below that, and only the name and the size below 460.
  shownColumns() {
    const width = this.list.clientWidth || 800;
    return width >= 600 ? ["name", "mtime", "size", "kind"] : width >= 460 ? ["name", "mtime", "size"] : ["name", "size"];
  }

  applyCols() {
    this.columns = this.shownColumns();
    const widths = this.columns.slice(1).map((c) => `${this.cols[c]}px`).join(" ");
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
  }

  renderTabs() {
    if (this.tabs.length < 2) {
      this.tabsEl.innerHTML = "";
      this.tabsEl.hidden = true;
      return;
    }
    this.tabsEl.hidden = false;
    this.tabsEl.innerHTML = this.tabs
      .map((tab, i) => `<div class="tab${i === this.active ? " on" : ""}" data-i="${i}"><button class="x" data-i="${i}" title="${esc(t("closeTab"))}">${icon("xmark")}</button><span>${esc(nameOf(tab.uri))}</span></div>`)
      .join("");
  }

  renderPath() {
    const tab = this.tab;
    this.path.querySelector('[data-act="back"]').disabled = !tab.back.length;
    this.path.querySelector('[data-act="forward"]').disabled = !tab.forward.length;
    if (this.crumbs.querySelector(".address")) return;
    const path = pathOf(tab.uri);
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
    const sep = `<span class="sep">${icon("triangle.right")}</span>`;
    this.crumbs.innerHTML =
      sep +
      crumbs
        .map(([p, name, first]) => {
          const img = first ? `<img src="lazy://icon/${14 * pixelRatio()}/${encodeURIComponent(`path:${p}`)}" alt="">` : "";
          return `<button class="crumb" data-uri="${esc(fileUri(p))}">${img}<span>${esc(name)}</span></button>`;
        })
        .join(sep);
  }

  renderHead() {
    const sort = this.sortOf(this.tab);
    const shown = this.columns || this.shownColumns();
    this.head.innerHTML = COLUMNS.filter(([key]) => shown.includes(key)).map(([key, word]) => {
      const sorted = sort.by === key || (key === "kind" && sort.by === "kind");
      const arrow = sorted ? icon(sort.desc ? "chevron.down" : "chevron.up") : "";
      const grip = key === "name" ? "" : `<i class="grip" data-grip="${key}"></i>`;
      return `<button class="col${key === "size" ? " num" : ""}${sorted ? " sorted" : ""}" data-col="${key}">${grip}<span>${esc(t(word))}</span>${arrow}</button>`;
    }).join("");
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
    const icons = tab.mode === "icons";
    this.el.classList.toggle("grid-view", icons);
    this.head.hidden = icons;
    const showMessage = tab.error || (!tab.loading && tab.count === 0) || (tab.loading && !tab.generation);
    this.message.hidden = !showMessage;
    if (tab.error) {
      this.message.innerHTML = `<p>${esc(tab.error)}</p>`;
    } else if (showMessage) {
      this.message.innerHTML = `<p>${esc(tab.loading ? t("loading") : tab.filter ? t("noMatch") : t("emptyFolder"))}</p>`;
    }
    const width = this.list.clientWidth - 16;
    const height = this.list.clientHeight;
    if (!icons && this.shownColumns().join() !== (this.columns || []).join()) {
      this.applyCols();
      this.renderHead();
    }
    const per = icons ? Math.max(1, Math.floor(width / CELL_W)) : 1;
    const rowH = icons ? CELL_H : ROW_H;
    this.per = per;
    this.rowH = rowH;
    const lines = Math.ceil(tab.count / per);
    this.sizer.style.height = `${lines * rowH + (icons ? 8 : 0)}px`;
    const firstLine = Math.max(0, Math.floor(this.list.scrollTop / rowH) - 2);
    const lastLine = Math.ceil((this.list.scrollTop + height) / rowH) + 2;
    const first = firstLine * per;
    const last = Math.min(tab.count, lastLine * per);
    const wanted = new Set();
    for (let i = first; i < last; i++) wanted.add(i);
    // The stripes go on below the last row, down the empty part of the list, as in Finder.
    if (!icons && !showMessage) for (let i = Math.max(tab.count, first); i < lastLine; i++) wanted.add(i);
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
      this.paint(el, i, tab, icons, per);
    }
    this.ensure(first, last);
    this.renderStatus();
  }

  paint(el, i, tab, icons, per) {
    const e = tab.rows.get(i);
    const sel = !!e && tab.isSel(e.name);
    const cut = !!e && Panes.cut.has(e.uri);
    const key = `${tab.generation}|${icons}|${per}|${(this.columns || []).length}|${e ? e.name : ""}|${sel}|${cut}|${e?.dirSize ?? ""}`;
    if (el.dataset.key === key || (this.renaming && this.renaming.index === i)) return;
    el.dataset.key = key;
    el.dataset.index = i;
    if (icons) {
      el.className = `cell-icon${sel ? " sel" : ""}${cut ? " cut" : ""}`;
      el.style.left = `${(i % per) * CELL_W + Math.max(0, (this.list.clientWidth - 16 - per * CELL_W) / 2)}px`;
      el.style.top = `${Math.floor(i / per) * CELL_H + 6}px`;
      if (!e) {
        el.innerHTML = "";
        return;
      }
      const thumb = thumbUrl(e, 64);
      const fallback = iconUrl(e, 64);
      const img = thumb
        ? `<img class="thumb" src="${thumb}" draggable="false" alt="" onerror="this.onerror=null;this.className='';this.src='${fallback}'">`
        : `<img src="${fallback}" draggable="false" alt="">`;
      el.innerHTML = `<div class="pic">${img}</div><div class="label">${esc(e.name)}</div>`;
      return;
    }
    el.className = `row${i % 2 ? " odd" : ""}${sel ? " sel" : ""}${cut ? " cut" : ""}${e?.hidden ? " hidden-item" : ""}`;
    el.style.top = `${i * ROW_H}px`;
    if (!e) {
      el.innerHTML = "";
      return;
    }
    const size = e.isDir || e.kind === "app" || e.kind === "package" ? (e.dirSize != null ? fmtSize(e.dirSize) : "--") : fmtSize(e.size);
    const thumb = thumbUrl(e, 16);
    const fallback = iconUrl(e, 16);
    const img = thumb ? `<img src="${thumb}" draggable="false" alt="" onerror="this.onerror=null;this.src='${fallback}'">` : `<img src="${fallback}" draggable="false" alt="">`;
    const cells = { mtime: `<div class="cell">${fmtDate(e.mtime)}</div>`, size: `<div class="cell num">${size}</div>`, kind: `<div class="cell">${esc(e.type || "")}</div>` };
    el.innerHTML = `<div class="cell name">${img}<span>${esc(e.name)}</span></div>${(this.columns || []).slice(1).map((c) => cells[c]).join("")}`;
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
  pointer(e) {
    if (e.button !== 0 && e.button !== 2) return;
    if (e.target.classList.contains("rename")) return;
    this.list.focus({ preventScroll: true });
    const tab = this.tab;
    const i = this.indexAt(e);
    if (i == null) {
      if (e.button === 0 && !e.metaKey && !e.shiftKey) {
        tab.clearSel();
        this.render();
      }
      return;
    }
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
    const line = Math.floor(i / (this.per || 1));
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

  // The path bar as a field: type a path, with the folders that match offered below; Enter goes there.
  editAddress() {
    if (this.crumbs.querySelector(".address")) return;
    const input = document.createElement("input");
    input.className = "address";
    input.spellcheck = false;
    input.value = pathOf(this.tab.uri);
    this.crumbs.innerHTML = "";
    this.crumbs.appendChild(input);
    input.focus();
    input.select();
    let list = null;
    let items = [];
    let at = -1;
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
          if (div) {
            input.value = items[Number(div.dataset.i)];
            suggest();
            input.focus();
          }
        });
      }
      const r = input.getBoundingClientRect();
      list.style.left = `${r.left}px`;
      list.style.top = `${r.bottom + 4}px`;
      list.style.width = `${r.width}px`;
      list.innerHTML = items.map((p, i) => `<div data-i="${i}" class="${i === at ? "on" : ""}">${esc(p)}</div>`).join("");
    };
    let timer;
    const suggest = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        call("fs.complete", { text: input.value })
          .then((d) => {
            items = d.items;
            at = -1;
            show();
          })
          .catch(() => {});
      }, 60);
    };
    const done = (go) => {
      clearTimeout(timer);
      close();
      const value = input.value.trim();
      input.remove();
      this.renderPath();
      if (!go || !value) return;
      const home = S.places.home ? pathOf(S.places.home) : "";
      const path = value === "~" ? home : value.startsWith("~/") ? home + value.slice(1) : value;
      if (path.startsWith("/")) this.navigate(fileUri(path.replace(/\/+$/, "") || "/"));
      else if (/^[a-z0-9+-]+:\/\//.test(path)) this.navigate(path);
      else say(t("notAPath"));
    };
    input.addEventListener("input", suggest);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        if (at >= 0) input.value = items[at];
        done(true);
      } else if (e.key === "Escape") done(false);
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!items.length) return;
        at = (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        show();
      } else if (e.key === "Tab" && items.length) {
        e.preventDefault();
        input.value = items[Math.max(0, at)];
        suggest();
      }
    });
    input.addEventListener("blur", () => setTimeout(() => input.isConnected && done(false), 120));
  }

  // Tabs: a new one opens where the current one is, or at `uri`.
  newTab(uri) {
    const from = this.tab?.uri;
    this.tabs.push(new Tab(null, this.tab?.mode));
    this.active = this.tabs.length - 1;
    this.navigate(uri || from || S.places.home, { history: false });
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

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const state = {
        layout: grid.dataset.layout,
        focus: panes.indexOf(focused),
        sidebarWidth: Sidebar.width(),
        sidebarHidden: $("app").classList.contains("no-sidebar"),
        panes: panes.map((p) => ({ active: p.active, cols: p.cols, tabs: p.tabs.map((tab) => ({ uri: tab.uri, mode: tab.mode, sort: tab.sort })) })),
      };
      call("panes.state", { state }).catch(() => {});
    }, 500);
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
    reportGlass();
  }

  function paintLayoutButton() {
    const layout = grid.dataset.layout;
    if (api.layoutButton) api.layoutButton.innerHTML = icon(`layout.${layout === "h3" ? "h2" : layout === "l1r2" ? "grid" : layout}`);
  }

  // Moves the focus to the next pane (or the previous one), as Tab does in QSpace.
  function cycle(step) {
    if (panes.length < 2) return;
    const next = panes[(panes.indexOf(focused) + step + panes.length) % panes.length];
    focus(next);
    next.list.focus({ preventScroll: true });
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
      const path = pathOf(pane.tab.uri);
      if (path === "/") return;
      const parent = path.slice(0, path.lastIndexOf("/")) || "/";
      pane.navigate(fileUri(parent), { select: [path.split("/").pop()] });
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
      $("searchInput").focus();
      $("searchInput").select();
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
    tab.uri = d.uri;
    tab.generation = d.generation;
    tab.count = d.count;
    tab.capabilities = d.capabilities;
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
  on("settings.changed", (s) => {
    for (const pane of panes) {
      for (const tab of pane.tabs) {
        if (pane.tab === tab && tab.generation && !!s.show_hidden !== tab.showHidden) {
          tab.showHidden = !!s.show_hidden;
          call("view.hidden", { view: tab.id, show: tab.showHidden })
            .then((d) => pane.tab === tab && pane.regenerate(d.generation, d.count))
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
    focus,
    current,
    focused: () => focused,
    all: () => panes,
    findTab,
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
