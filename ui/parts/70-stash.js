// The Stash Shelf (W7). In the main window: a sidebar entry that opens the shelf in a pane, a toolbar button that shows
// the floating shelf, and "Add to Shelf" / "Remove from Shelf" in the context menu. In the shelf's own window: a
// compact basket that takes files dropped from anywhere, text, links and pictures from a browser or the clipboard,
// and gives its items back by dragging them out.
LZ.words({
  vi: {
    stash: "Khay tạm", stashShow: "Hiện hoặc ẩn khay tạm", stashAdd: "Thêm vào khay tạm", stashRemove: "Bỏ khỏi khay", stashClear: "Dọn khay",
    stashPaste: "Lấy từ bảng nhớ tạm", stashEmpty: "Thả tệp, ảnh, liên kết hay văn bản vào đây", stashClose: "Đóng khay", stashAdded: "Đã thêm {0} mục vào khay",
    revealFinder: "Hiện trong Finder", openItem: "Mở", downloadLanes: "Tải bằng Lanes", lanesSent: "Đã gửi {0} liên kết cho Lanes",
  },
  en: {
    stash: "Stash", stashShow: "Show or hide the shelf", stashAdd: "Add to Shelf", stashRemove: "Remove from Shelf", stashClear: "Clear the Shelf",
    stashPaste: "Take from the Clipboard", stashEmpty: "Drop files, pictures, links or text here", stashClose: "Close the Shelf", stashAdded: "{0} items added to the shelf",
    revealFinder: "Show in Finder", openItem: "Open", downloadLanes: "Download with Lanes", lanesSent: "{0} links sent to Lanes",
  },
});
LZ.icons.add({
  tray: "tray",
  clipboard: "doc.on.clipboard",
});

const Stash = (() => {
  const STASH = "stash://";
  let count = 0;
  placeNames.stash = () => t("stash");
  placeCrumbs.stash = (uri) => [[uri, t("stash"), null]];

  // The main window's pieces.
  const section = LZ.sidebar.section({
    id: "stash",
    render(el) {
      if (S.window.role !== "main") return;
      el.innerHTML = `<button class="side-item" data-uri="${STASH}"><span class="ico" data-ico="tray">${icon("tray")}</span><span class="label">${LZ.esc(t("stash"))}</span><span class="side-count">${count || ""}</span></button>`;
      Sidebar.mark();
    },
  });
  // The shelf reads as one more favourite, right under them, rather than as an item of the section above it.
  section.el.parentElement.prepend(section.el);

  function changed(d) {
    count = d.count;
    section.refresh();
    for (const pane of Panes.all()) if (pane.tab.uri === STASH) pane.refresh();
    if (S.window.role === "shelf") Shelf.load();
  }
  LZ.on("stash.changed", changed);

  // Links kept as files go to Lanes, the download manager by the same author, when it is installed.
  let hasLanes = false;
  const isLink = (uri) => /\.(webloc|url|txt)$/i.test(uri);
  const download = (uris) =>
    LZ.call("lanes.send", { uris: uris.filter(isLink) })
      .then((d) => LZ.toast(t("lanesSent", d.sent)))
      .catch(LZ.say);

  const add = (uris) =>
    LZ.call("stash.add", { uris })
      .then((d) => d.added && S.window.role === "main" && LZ.toast(t("stashAdded", d.added)))
      .catch(LZ.say);

  LZ.toolbar.add({ id: "stash", side: "right", icon: "tray", label: "stashShow", run: () => Panes.action("toggleShelf") });
  Panes.actions.toggleShelf = () => LZ.call("stash.show", {}).catch(LZ.say);
  Keys.add({ "Cmd+Alt+T": "toggleShelf" });
  LZ.menu.add({ id: "stashAdd", label: "stashAdd", icon: "tray.and.arrow.down", group: 46, order: 1, when: (c) => c.count > 0 && isLocal(c.tab.uri), run: (c) => add(c.entries.map((e) => e.uri)) });
  LZ.menu.add({ id: "stashRemove", label: "stashRemove", icon: "tray.and.arrow.up", group: 46, order: 2, when: (c) => c.count > 0 && c.tab.uri === STASH, run: (c) => LZ.call("stash.remove", { uris: c.entries.map((e) => e.uri) }).catch(LZ.say) });
  LZ.menu.add({ id: "stashClear", label: "stashClear", icon: "trash", group: 46, order: 3, when: (c) => c.count === 0 && c.tab.uri === STASH, run: () => LZ.call("stash.clear").catch(LZ.say) });

  LZ.menu.add({ id: "downloadLanes", label: "downloadLanes", icon: "arrow.down.circle", group: 47, order: 1, when: (c) => hasLanes && c.count > 0 && (isLocal(c.tab.uri) || c.tab.uri === STASH) && c.entries.some((e) => isLink(e.uri)), run: (c) => download(c.entries.map((e) => e.uri)) });

  LZ.on("app.hello", () => {
    LZ.call("lanes.available").then((on) => (hasLanes = !!on)).catch(() => {});
    LZ.call("stash.count")
      .then((n) => {
        count = n;
        section.refresh();
      })
      .catch(() => {});
  });

  // The shelf's own window: everything but the basket is hidden.
  const Shelf = {
    items: [],
    selected: new Set(),
    el: null,
    build() {
      document.documentElement.classList.add("shelf-mode");
      const el = document.createElement("div");
      el.className = "shelf";
      el.innerHTML = `<div class="shelf-head drag"><span class="shelf-title">${LZ.esc(t("stash"))} <b class="shelf-count"></b></span>
        <span class="shelf-tools"><button class="mini" data-sh="paste" title="${LZ.esc(t("stashPaste"))}">${icon("clipboard")}</button><button class="mini" data-sh="clear" title="${LZ.esc(t("stashClear"))}">${icon("trash")}</button><button class="mini" data-sh="close" title="${LZ.esc(t("stashClose"))}">${icon("xmark")}</button></span></div>
        <div class="shelf-items"></div>`;
      document.body.appendChild(el);
      this.el = el;
      el.addEventListener("click", (e) => this.click(e));
      el.addEventListener("dblclick", (e) => {
        const item = this.itemAt(e);
        if (item) item.isDir ? LZ.call("app.new_window", { uri: item.uri }).catch(LZ.say) : LZ.call("native.open", { uris: [item.uri] }).catch(LZ.say);
      });
      el.addEventListener("mousedown", (e) => {
        const item = this.itemAt(e);
        if (!item || e.button !== 0) return;
        if (!this.selected.has(item.uri)) {
          if (!e.metaKey) this.selected.clear();
          this.selected.add(item.uri);
          this.paint();
        }
        // Dragging an item out takes the selection with it.
        LZ.call("drag.arm", { uris: [...this.selected] }).catch(() => {});
      });
      el.addEventListener("contextmenu", async (e) => {
        e.preventDefault();
        const item = this.itemAt(e);
        if (!item) return;
        if (!this.selected.has(item.uri)) {
          this.selected = new Set([item.uri]);
          this.paint();
        }
        const uris = [...this.selected];
        const choice = await LZ.choose(
          [
            { id: "open", label: t("openItem"), icon: "arrow.up.forward.app" },
            { id: "reveal", label: t("revealFinder"), icon: "macwindow" },
            { id: "revealHere", label: t("revealHere"), icon: "folder" },
            ...(hasLanes && uris.some(isLink) ? [{ id: "lanes", label: t("downloadLanes"), icon: "arrow.down.circle" }] : []),
            { separator: true },
            { id: "remove", label: t("stashRemove"), icon: "tray.and.arrow.up" },
          ],
          e.clientX,
          e.clientY,
        );
        if (choice === "open") LZ.call("native.open", { uris }).catch(LZ.say);
        else if (choice === "reveal") LZ.call("native.reveal", { uris }).catch(LZ.say);
        // The shelf has no panes: the app shows the items in a main window, opening one if none is open.
        else if (choice === "revealHere") Viewer.reveal(null, uris);
        else if (choice === "lanes") download(uris);
        else if (choice === "remove") LZ.call("stash.remove", { uris }).catch(LZ.say);
      });
      // Text, links and pictures from a browser come as an HTML5 drop (files come through the app, as `drop`).
      document.addEventListener("dragover", (e) => {
        e.preventDefault();
        el.classList.add("over");
      });
      document.addEventListener("dragleave", () => el.classList.remove("over"));
      document.addEventListener("drop", (e) => {
        e.preventDefault();
        el.classList.remove("over");
        this.fromData(e.dataTransfer);
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") LZ.call("stash.show", { on: false }).catch(() => {});
        if (e.key === "v" && e.metaKey) LZ.call("stash.add_clipboard").catch(LZ.say);
      });
      this.load();
    },
    async fromData(data) {
      const files = [...(data?.files || [])].filter((f) => f.type.startsWith("image/") && f.size < 64 << 20);
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        LZ.call("stash.add_data", { name: file.name || null, base64: btoa(binary) }).catch(LZ.say);
      }
      if (files.length) return;
      const url = data?.getData("text/uri-list")?.split("\n").find((l) => /^https?:\/\//.test(l.trim()));
      const text = data?.getData("text/plain");
      if (url) LZ.call("stash.add_data", { url: url.trim() }).catch(LZ.say);
      else if (text) LZ.call("stash.add_data", { text }).catch(LZ.say);
    },
    async load() {
      this.items = await LZ.call("stash.items").catch(() => this.items);
      const uris = new Set(this.items.map((i) => i.uri));
      this.selected = new Set([...this.selected].filter((u) => uris.has(u)));
      this.paint();
    },
    paint() {
      this.el.querySelector(".shelf-count").textContent = this.items.length || "";
      const list = this.el.querySelector(".shelf-items");
      list.innerHTML = this.items.length
        ? this.items
            .map((item, i) => {
              const thumb = thumbUrl(item, 48);
              const pic = thumb ? thumbImg(thumb, iconUrl(item, 48), "thumb") : `<img src="${LZ.esc(iconUrl(item, 48))}" alt="">`;
              return `<div class="shelf-item${this.selected.has(item.uri) ? " sel" : ""}" data-i="${i}">${pic}<span>${LZ.esc(item.name)}</span></div>`;
            })
            .join("")
        : `<div class="shelf-empty">${LZ.esc(t("stashEmpty"))}</div>`;
    },
    itemAt(e) {
      const el = e.target.closest(".shelf-item");
      return el ? this.items[Number(el.dataset.i)] : null;
    },
    click(e) {
      const act = e.target.closest("[data-sh]")?.dataset.sh;
      if (act === "close") return LZ.call("stash.show", { on: false }).catch(() => {});
      if (act === "clear") return LZ.call("stash.clear").catch(LZ.say);
      if (act === "paste") return LZ.call("stash.add_clipboard").catch(LZ.say);
      if (!this.itemAt(e) && !e.target.closest(".shelf-head")) {
        this.selected.clear();
        this.paint();
      }
    },
  };

  LZ.on("app.hello", (d) => {
    if (d.windowRole === "shelf" && !Shelf.el) Shelf.build();
  });
  // Files dropped on the shelf window go on the shelf.
  LZ.on("drop", (d) => {
    if (S.window.role === "shelf") add(d.uris);
  });
  LZ.on("drop.over", () => S.window.role === "shelf" && Shelf.el?.classList.add("over"));
  LZ.on("drop.leave", () => Shelf.el?.classList.remove("over"));
  return { add };
})();
