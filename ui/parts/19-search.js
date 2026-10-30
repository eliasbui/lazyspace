// Search (src/features/search.rs, src/features/index.rs). What is typed in the toolbar's field filters the focused pane
// at once, and the items of the quick index that match it best, as fzf matches, show under the field to jump to. Enter,
// or one of the offers above them, searches the pane's folder and every folder in it, or the whole Mac: the results are
// a place of their own (`search://<what>/<folder>`), the best match first, with the folder of each item as a column and
// a bar of filters over them: where, the kind, when it changed, how big, and whether the contents count.
LZ.words({
  vi: {
    searchFor: "Tìm \"{0}\"", searchIn: "Tìm \"{0}\" trong {1} và các thư mục con", searchMac: "Tìm \"{0}\" trên cả máy",
    searchContent: "Tìm \"{0}\" cả trong nội dung tệp", thisMac: "Máy Mac này", recents: "Gần đây", quickHits: "Tệp và thư mục",
    sWhere: "Trong", sKind: "Loại", sDate: "Ngày sửa", sSize: "Kích thước", sContent: "Cả nội dung", sAny: "Bất kỳ",
    "kind.": "Mọi loại", "kind.folder": "Thư mục", "kind.image": "Ảnh", "kind.movie": "Phim", "kind.audio": "Âm thanh", "kind.pdf": "PDF",
    "kind.document": "Tài liệu", "kind.archive": "Tệp nén", "kind.app": "Ứng dụng", "kind.code": "Mã nguồn",
    "date.today": "Hôm nay", "date.week": "7 ngày qua", "date.month": "30 ngày qua", "date.year": "Một năm qua",
    "size.1m": "Trên 1 MB", "size.100m": "Trên 100 MB", "size.1g": "Trên 1 GB",
    searchTitle: "Tìm kiếm", quickIndex: "Chỉ mục tìm nhanh",
    quickIndexHint: "Mọi tệp và thư mục trong thư mục nhà và Ứng dụng, giữ trong bộ nhớ và tự cập nhật, so khớp như fzf (gõ không dấu vẫn ra). Bỏ qua mục ẩn, Library, node_modules và thư mục build.",
    indexCount: "{0} mục", indexBuilding: "Đang lập chỉ mục...", indexNotReady: "Chưa có chỉ mục", reindex: "Lập lại chỉ mục",
  },
  en: {
    searchFor: "Search \"{0}\"", searchIn: "Search \"{0}\" in {1} and its folders", searchMac: "Search \"{0}\" on this Mac",
    searchContent: "Search \"{0}\" in the contents of files too", thisMac: "This Mac", recents: "Recents", quickHits: "Files and Folders",
    sWhere: "In", sKind: "Kind", sDate: "Modified", sSize: "Size", sContent: "Contents too", sAny: "Any",
    "kind.": "Any Kind", "kind.folder": "Folders", "kind.image": "Images", "kind.movie": "Movies", "kind.audio": "Audio", "kind.pdf": "PDF",
    "kind.document": "Documents", "kind.archive": "Archives", "kind.app": "Applications", "kind.code": "Source Code",
    "date.today": "Today", "date.week": "Last 7 Days", "date.month": "Last 30 Days", "date.year": "Last Year",
    "size.1m": "Over 1 MB", "size.100m": "Over 100 MB", "size.1g": "Over 1 GB",
    searchTitle: "Search", quickIndex: "Quick index",
    quickIndexHint: "Every file and folder in the home folder and Applications, held in memory and kept up to date, matched as fzf matches (accents optional). Hidden items, the Library, node_modules and build folders are left out.",
    indexCount: "{0} items", indexBuilding: "Indexing...", indexNotReady: "No index yet", reindex: "Index Again",
  },
});

const Search = (() => {
  const KINDS = ["", "folder", "image", "movie", "audio", "pdf", "document", "archive", "app", "code"];
  const DATES = ["", "today", "week", "month", "year"];
  const SIZES = ["", "1m", "100m", "1g"];
  const ICON_OF = { folder: "folder", image: "photo", movie: "film", audio: "music.note", pdf: "doc.richtext", document: "doc.text", archive: "archivebox", app: "app", code: "chevron.left.forwardslash.chevron.right" };

  // The query of a search URI ({ q, kind, date, size, content, tag, recent, from }), and a search URI of a query and
  // a folder (`/` for the whole Mac). Each value is encoded, then the whole query once more as the authority.
  const isSearch = (uri) => schemeOf(uri) === "search";
  const query = (uri) => Object.fromEntries(new URLSearchParams(authorityOf(uri)));
  function uriOf(q, folder) {
    const text = Object.entries(q)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    return `search://${encodeURIComponent(text)}${encodePath(folder || "/")}`;
  }
  const folderOf = (uri) => pathOf(uri);
  const title = (uri) => {
    const q = query(uri);
    if (q.recent === "1") return t("recents");
    if (!q.q && q.tag) return typeof Tags === "undefined" ? q.tag : Tags.label(q.tag);
    return t("searchFor", q.q || "");
  };
  placeNames.search = title;
  placeCrumbs.search = (uri) => {
    const q = query(uri);
    const folder = folderOf(uri);
    const crumbs = [];
    if (q.q) crumbs.push(folder === "/" ? [fileUri("/"), t("thisMac"), "path:/"] : [fileUri(folder), nameOf(fileUri(folder)), `path:${folder}`]);
    crumbs.push([uri, title(uri), null]);
    return crumbs;
  };

  // Where a search from the focused pane looks: its folder on this Mac, the folder of the search it shows, or the home.
  function scopeOf(pane) {
    const uri = pane.tab.uri;
    if (isSearch(uri)) return query(uri).from || folderOf(uri);
    return isLocal(uri) ? pathOf(uri) : pathOf(S.places.home || "file:///");
  }

  function run(pane, text, { mac = false, content = false } = {}) {
    const words = text.trim();
    if (!pane || !words) return;
    const folder = scopeOf(pane);
    const before = isSearch(pane.tab.uri) ? query(pane.tab.uri) : {};
    const q = { ...before, q: words, content: content || before.content ? "1" : "", recent: "", tag: "", from: mac ? folder : "" };
    pane.navigate(uriOf(q, mac ? "/" : folder), { history: !isSearch(pane.tab.uri) });
    pane.list.focus({ preventScroll: true });
  }

  // Under the toolbar's field while it holds text: the offers to search (this folder and those in it, which Enter takes,
  // the whole Mac, the contents too), then the items of the quick index that match best. A folder opens in the pane; a
  // file opens its folder with it selected, or with Command opens in its app.
  let offers = null;
  let at = 0;
  let hits = [];
  let asked = 0;
  const input = $("searchInput");
  function choices() {
    const pane = Panes.focused();
    const text = input.value.trim();
    if (!pane || !text) return [];
    const folder = scopeOf(pane);
    const name = folder === "/" ? t("thisMac") : nameOf(fileUri(folder));
    const list = [
      { label: t("searchIn", text, name), icon: "magnifyingglass", go: () => run(pane, text) },
      { label: t("searchMac", text), icon: "desktopcomputer", go: () => run(pane, text, { mac: true }) },
      { label: t("searchContent", text), icon: "doc.text.magnifyingglass", go: () => run(pane, text, { content: true }) },
    ];
    for (const hit of hits) {
      const uri = fileUri(hit.path);
      const parent = fileUri(hit.path.slice(0, hit.path.lastIndexOf("/")) || "/");
      list.push({
        hit,
        label: hit.path.split("/").pop(),
        where: placeLabel(parent),
        go: (e) => {
          if (hit.folder) return pane.navigate(uri);
          if (e?.metaKey) return LZ.call("native.open", { uris: [uri] }).catch(LZ.say);
          pane.navigate(parent, { select: [hit.path.split("/").pop()] });
        },
      });
    }
    return list;
  }
  function close() {
    offers?.remove();
    offers = null;
  }
  function show() {
    const list = choices();
    if (!list.length || document.activeElement !== input) return close();
    if (!offers) {
      offers = document.createElement("div");
      offers.className = "suggest search-offers";
      document.body.appendChild(offers);
      offers.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const div = e.target.closest("[data-i]");
        if (div) pick(Number(div.dataset.i), e);
      });
    }
    at = Math.min(at, list.length - 1);
    const r = $("tbSearch").getBoundingClientRect();
    const width = Math.max(360, r.width);
    offers.style.left = `${Math.max(8, r.right - width)}px`;
    offers.style.top = `${r.bottom + 6}px`;
    offers.style.width = `${width}px`;
    offers.innerHTML = list
      .map((c, i) => {
        const head = c.hit && !list[i - 1]?.hit ? `<p class="suggest-head">${LZ.esc(t("quickHits"))}</p>` : "";
        const pic = c.hit ? `<img src="lazy://icon/${16 * pixelRatio()}/${encodeURIComponent(`path:${c.hit.path}`)}" alt="" draggable="false">` : icon(c.icon);
        const where = c.where ? `<small>${LZ.esc(c.where)}</small>` : "";
        return `${head}<div data-i="${i}" class="${i === at ? "on" : ""}">${pic}<span>${LZ.esc(c.label)}</span>${where}</div>`;
      })
      .join("");
  }
  function pick(i, e) {
    const choice = choices()[i];
    close();
    choice?.go(e);
  }
  // The best of the quick index for what is typed; an answer to an older text is dropped.
  let timer;
  function ask() {
    clearTimeout(timer);
    const text = input.value.trim();
    if (!text) {
      hits = [];
      return show();
    }
    timer = setTimeout(() => {
      const mine = ++asked;
      LZ.call("index.search", { q: text, limit: 8 })
        .then((d) => {
          if (mine !== asked || input.value.trim() !== text) return;
          hits = d.items;
          show();
        })
        .catch(() => {});
    }, 40);
  }
  LZ.icons.add({ magnifyingglass: "magnifyingglass", desktopcomputer: "desktopcomputer", "doc.text.magnifyingglass": "doc.text.magnifyingglass" });
  input.addEventListener("input", () => {
    at = 0;
    show();
    ask();
  });
  input.addEventListener("focus", () => {
    show();
    ask();
  });
  input.addEventListener("blur", () => setTimeout(close, 100));

  // The keys of the field while offers show (04-core-toolbar.js asks first): Enter takes the one marked (with Command, a
  // file opens in its app), the arrows move the mark. Returns whether the key was taken.
  function keydown(e) {
    if (!offers) return false;
    const n = choices().length;
    if (e.key === "Enter") {
      e.preventDefault();
      pick(at, e);
      return true;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      at = (at + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      show();
      return true;
    }
    if (e.key === "Escape") close();
    return false;
  }

  // The bar of filters over the results of a search with words, as Finder's search bar: each filter a pill with its
  // menu; a change searches again in place.
  async function filterMenu(pane, which, button) {
    const uri = pane.tab.uri;
    const q = query(uri);
    const folder = folderOf(uri);
    const r = button.getBoundingClientRect();
    const go = (patch, where = folder) => pane.navigate(uriOf({ ...q, ...patch }, where), { history: false });
    if (which === "where") {
      const home = q.from || folder;
      const id = await LZ.choose(
        [
          { id: "here", label: home === "/" ? t("thisMac") : nameOf(fileUri(home)), icon: "folder", checked: folder !== "/" },
          { id: "mac", label: t("thisMac"), icon: "desktopcomputer", checked: folder === "/" },
        ],
        r.left,
        r.bottom + 4,
      );
      if (id === "mac" && folder !== "/") go({ from: folder }, "/");
      else if (id === "here" && folder === "/" && q.from) go({ from: "" }, q.from);
      return;
    }
    if (which === "content") return go({ content: q.content === "1" ? "" : "1" });
    const values = { kind: KINDS, date: DATES, size: SIZES }[which];
    const id = await LZ.choose(
      values.map((v) => ({ id: v || "any", label: v ? t(`${which}.${v}`) : which === "kind" ? t("kind.") : t("sAny"), icon: which === "kind" ? ICON_OF[v] : undefined, checked: (q[which] || "") === v })),
      r.left,
      r.bottom + 4,
    );
    if (id) go({ [which]: id === "any" ? "" : id });
  }

  function paintBar(pane) {
    const uri = pane.tab?.uri;
    const q = isSearch(uri) ? query(uri) : null;
    let bar = pane.el.querySelector(".search-bar");
    if (!q?.q) return bar?.remove();
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "search-bar";
      pane.path.after(bar);
      bar.addEventListener("click", (e) => {
        const b = e.target.closest("[data-filter]");
        if (b) filterMenu(pane, b.dataset.filter, b);
      });
    }
    const folder = folderOf(uri);
    const pill = (which, label, value, on) => `<button class="pill${on ? " on" : ""}" data-filter="${which}"><span>${LZ.esc(label)}</span>${value ? `<b>${LZ.esc(value)}</b>` : ""}${which === "content" ? "" : icon("chevron.down")}</button>`;
    bar.innerHTML = [
      pill("where", t("sWhere"), folder === "/" ? t("thisMac") : nameOf(fileUri(folder)), false),
      pill("kind", t("sKind"), q.kind ? t(`kind.${q.kind}`) : "", !!q.kind),
      pill("date", t("sDate"), q.date ? t(`date.${q.date}`) : "", !!q.date),
      pill("size", t("sSize"), q.size ? t(`size.${q.size}`) : "", !!q.size),
      pill("content", t("sContent"), "", q.content === "1"),
    ].join("");
  }
  Panes.on("render", ({ pane }) => paintBar(pane));

  // Settings: how big the quick index is, and a button to walk the disk again.
  const group = LZ.settings.section({
    id: "search",
    title: "searchTitle",
    build(el) {
      el.innerHTML = `<div class="item"><div class="label"><span data-t="quickIndex"></span><small data-t="quickIndexHint"></small><small data-index="state"></small></div>
        <div class="control"><button class="push" data-index="again" data-t="reindex"></button></div></div>`;
    },
  });
  const note = group.querySelector('[data-index="state"]');
  async function paintIndex() {
    const s = await LZ.call("index.state").catch(() => null);
    if (!s) return;
    note.textContent = s.building && !s.ready ? t("indexBuilding") : s.ready ? t("indexCount", s.count.toLocaleString(locale())) + (s.building ? ` (${t("indexBuilding")})` : "") : t("indexNotReady");
    if (s.building) setTimeout(paintIndex, 1000);
  }
  group.querySelector('[data-index="again"]').addEventListener("click", () => LZ.call("index.rebuild").then(() => setTimeout(paintIndex, 100), LZ.say));
  new MutationObserver(() => $("settingsSheet").classList.contains("open") && paintIndex()).observe($("settingsSheet"), { attributes: true, attributeFilter: ["class"] });

  return { isSearch, query, uriOf, run, keydown };
})();
