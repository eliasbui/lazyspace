// The column view and the gallery, as Finder has them. In the column view the tab's folder is one column after the
// folders above it, each with the way down marked; one folder selected opens in the column after it, and one file shows
// a preview there. The tab's own list is the column of its folder, so selecting, dragging, the menu and the keys work as
// in a list; the other columns are lists of their own, shown only: a click in one goes there. The gallery shows the item
// selected large over a strip of the folder's items.
LZ.words({
  vi: { asColumns: "Dạng cột", asGallery: "Dạng gallery", "m.asColumns": "Cột", "m.asGallery": "Gallery", columnTooBig: "Chỉ hiện {0} mục đầu" },
  en: { asColumns: "as Columns", asGallery: "as Gallery", "m.asColumns": "Columns", "m.asGallery": "Gallery", columnTooBig: "Only the first {0} items" },
});

const Columns = (() => {
  // The most rows a column of its own shows.
  const LIMIT = 2000;
  // The listings of the columns, by URI: listed once, kept while a column shows them, listed again when they change.
  const lists = new Map();
  // What each side of a strip was last drawn from, to draw it again only when that changes.
  const drawn = new WeakMap();
  let seq = 0;

  function listing(pane, uri) {
    let list = lists.get(uri);
    if (list) return list;
    list = { id: `w${S.window.id}col${++seq}`, uri, rows: null, count: 0 };
    lists.set(uri, list);
    call("fs.list", { view: list.id, uri, sort: pane.sortOf(pane.tab), showHidden: !!S.settings.show_hidden }).catch(() => {
      list.rows = [];
      paintAll();
    });
    return list;
  }

  on("view.changed", async (d) => {
    const list = [...lists.values()].find((l) => l.id === d.view);
    if (!list) return;
    const rows = [];
    for (let start = 0; start < Math.min(d.count, LIMIT); start += 500) {
      const got = await call("view.rows", { view: list.id, start, count: 500, generation: d.generation }).catch(() => null);
      if (!got) return;
      rows.push(...got.rows);
    }
    list.rows = rows;
    list.count = d.count;
    paintAll();
  });
  on("view.error", (d) => {
    const list = [...lists.values()].find((l) => l.id === d.view);
    if (!list) return;
    list.rows = [];
    paintAll();
  });

  // The folders above the tab's, from the start of its place (the home folder, the disk, a server's root, an
  // archive's top), the highest first; none for a search or the shelf.
  function above(uri) {
    const scheme = schemeOf(uri);
    if (!uri || scheme === "search" || scheme === "stash") return [];
    const path = pathOf(uri);
    if (scheme === "archive") {
      const cut = path.indexOf("!");
      const archive = path.slice(0, cut);
      const parts = path.slice(cut + 1).split("/").filter(Boolean);
      return parts.map((_, i) => archiveUri(archive, parts.slice(0, i).join("/")));
    }
    const home = S.places.home ? pathOf(S.places.home) : null;
    const start = scheme === "file" && home && (path === home || path.startsWith(`${home}/`)) ? home : "/";
    if (path === start) return [];
    const folders = [start];
    let at = start === "/" ? "" : start;
    for (const part of path.slice(start.length).split("/").filter(Boolean).slice(0, -1)) folders.push((at = `${at}/${part}`));
    return folders.map((p) => (scheme === "file" ? fileUri(p) : withPath(uri, p)));
  }

  // The column of a listing, the row of `marked` shown as the way down.
  function column(list, marked) {
    const rows = list.rows;
    const body = !rows
      ? `<p class="mnote">${esc(t("loading"))}</p>`
      : rows
          .map((e, i) => {
            const opens = e.isDir || LZ.vfs.browse(e) ? icon("chevron.right") : "";
            return `<div class="mrow${e.name === marked ? " on" : ""}" data-i="${i}"><img src="${esc(iconUrl(e, 16))}" alt="" draggable="false"><span>${esc(e.name)}</span>${opens}</div>`;
          })
          .join("") + (list.count > rows.length ? `<p class="mnote">${esc(t("columnTooBig", rows.length))}</p>` : "");
    return `<div class="mcol" data-uri="${esc(list.uri)}">${body}</div>`;
  }

  // The preview of one file, as the last column of Finder's shows it.
  function preview(e) {
    const thumb = thumbUrl(e, 256);
    const pic = thumb ? thumbImg(thumb, iconUrl(e, 128), "mthumb") : `<img class="micon" src="${esc(iconUrl(e, 128))}" alt="" draggable="false">`;
    const facts = [e.type, e.isDir ? null : fmtSize(e.size), fmtDate(e.mtime)].filter(Boolean).map((f) => `<span>${esc(f)}</span>`).join("");
    return `<div class="mcol mpreview">${pic}<b>${esc(e.name)}</b><div class="mfacts">${facts}</div></div>`;
  }

  // Puts the tab's list in a strip of columns in the column view, and back where it was in any other.
  function strip(pane) {
    let el = pane.el.querySelector(".col-strip");
    if (pane.tab?.mode !== "columns") {
      if (el) {
        el.replaceWith(pane.list);
        for (const list of lists.values()) list.panes?.delete(pane);
      }
      return null;
    }
    if (!el) {
      el = document.createElement("div");
      el.className = "col-strip";
      pane.list.replaceWith(el);
      el.appendChild(pane.list);
      el.addEventListener("click", (e) => go(pane, e, false));
      el.addEventListener("dblclick", (e) => go(pane, e, true));
    }
    return el;
  }

  // A click on a row of a column of its own goes to that folder with the row selected; a double click on a file opens it.
  function go(pane, e, twice) {
    const row = e.target.closest(".mcol .mrow");
    const col = row?.closest(".mcol");
    if (!row || !col) return;
    const entry = lists.get(col.dataset.uri)?.rows?.[Number(row.dataset.i)];
    if (!entry) return;
    if (twice && !entry.isDir && !LZ.vfs.browse(entry)) return call("native.open", { uris: [entry.uri] }).catch(say);
    pane.navigate(col.dataset.uri, { select: [entry.name] });
    pane.list.focus({ preventScroll: true });
  }

  function paint(pane) {
    const el = strip(pane);
    stage(pane);
    if (!el) return;
    const tab = pane.tab;
    const folders = above(tab.uri);
    const names = [...folders.slice(1), tab.uri].map((u) => nameOf(u));
    const before = folders.map((uri, i) => column(listing(pane, uri), names[i])).join("");
    const one = tab.selCount() === 1 ? tab.selectedEntries()[0] : null;
    const into = one && pane.browsable(one);
    const after = into ? column(listing(pane, into), null) : one ? preview(one) : "";
    // Only what changed is drawn again, so a column keeps where it was scrolled.
    const parts = { before, after };
    for (const [side, html] of Object.entries(parts)) {
      const holder = el.querySelector(`.mside.${side}`) || el.insertAdjacentElement(side === "before" ? "afterbegin" : "beforeend", Object.assign(document.createElement("div"), { className: `mside ${side}` }));
      if (drawn.get(holder) === html) continue;
      const scrolls = [...holder.querySelectorAll(".mcol")].map((c) => [c.dataset.uri, c.scrollTop]);
      holder.innerHTML = html;
      drawn.set(holder, html);
      for (const [uri, top] of scrolls) {
        const c = holder.querySelector(`.mcol[data-uri="${CSS.escape(uri || "")}"]`);
        if (c) c.scrollTop = top;
      }
      for (const c of holder.querySelectorAll(".mrow.on")) c.scrollIntoView({ block: "nearest" });
    }
    el.scrollLeft = el.scrollWidth;
    tidy();
  }

  // Listings no column shows any more are let go.
  function tidy() {
    const shown = new Set([...document.querySelectorAll(".col-strip .mcol[data-uri]")].map((c) => c.dataset.uri));
    for (const [uri, list] of lists) {
      if (shown.has(uri)) continue;
      lists.delete(uri);
      call("view.close", { view: list.id }).catch(() => {});
    }
  }

  // The gallery's stage: the item selected (or the first) large, its name and what it is under it.
  function stage(pane) {
    let el = pane.el.querySelector(".gallery-stage");
    if (pane.tab?.mode !== "gallery") return el?.remove();
    if (!el) {
      el = document.createElement("div");
      el.className = "gallery-stage";
      pane.list.before(el);
      el.addEventListener("dblclick", () => Panes.action("open", pane));
    }
    const tab = pane.tab;
    const e = tab.rows.get(tab.lead) || tab.selectedEntries()[0] || tab.rows.get(0);
    const key = e ? `${tab.generation}|${e.uri}` : "";
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    if (!e) return (el.innerHTML = "");
    const thumb = thumbUrl(e, 1024);
    const pic = thumb ? thumbImg(thumb, iconUrl(e, 256), "gthumb", "gicon") : `<img class="gicon" src="${esc(iconUrl(e, 256))}" alt="" draggable="false">`;
    const facts = [e.type, e.isDir ? null : fmtSize(e.size), fmtDate(e.mtime)].filter(Boolean).join("  ·  ");
    el.innerHTML = `<div class="gpic">${pic}</div><b>${esc(e.name)}</b><small>${esc(facts)}</small>`;
  }

  function paintAll() {
    for (const pane of Panes.all()) if (pane.tab?.mode === "columns" || pane.tab?.mode === "gallery" || pane.el.querySelector(".col-strip, .gallery-stage")) paint(pane);
  }

  Panes.on("render", ({ pane }) => paint(pane));
  Panes.on("selection", ({ pane }) => pane && paint(pane));

  // Left goes out to the folder above with this one selected; right goes into the one folder selected, at its first item.
  Object.assign(Panes.actions, {
    columnOut(pane) {
      if (above(pane.tab.uri).length) Panes.action("enclosing", pane);
    },
    columnIn(pane) {
      const one = pane.tab.selCount() === 1 ? pane.tab.selectedEntries()[0] : null;
      const into = one && pane.browsable(one);
      if (!into) return;
      const first = lists.get(into)?.rows?.[0]?.name;
      pane.navigate(into, { select: first ? [first] : null });
    },
  });

  return { paint };
})();
