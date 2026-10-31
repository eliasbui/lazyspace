// The sidebar: the well-known folders under Bookmarks, the disks under Locations, and what features add between them.
// A click opens the place in the focused pane; the place a pane shows is marked.
words({
  vi: {
    bookmarks: "Mục ưa thích", locations: "Vị trí", unpin: "Bỏ ghim khỏi thanh bên", desktop: "Màn hình nền", downloads: "Tải xuống", documents: "Tài liệu",
    movies: "Phim", music: "Nhạc", pictures: "Ảnh", applications: "Ứng dụng", trashName: "Thùng rác", eject: "Đẩy ra",
    quickAccess: "Truy cập nhanh", quickEmpty: "Kéo một thư mục vào đây, hoặc chuột phải vào nó rồi chọn Ghim vào Truy cập nhanh.",
    pinQuick: "Ghim thư mục đang mở", unpinQuick: "Bỏ ghim khỏi Truy cập nhanh", pinnedQuick: "Đã ghim {0} vào Truy cập nhanh", notFolder: "Chỉ ghim được thư mục",
    moveUp: "Đưa lên trên", moveDown: "Đưa xuống dưới",
  },
  en: {
    bookmarks: "Favourites", locations: "Locations", unpin: "Remove from Sidebar", desktop: "Desktop", downloads: "Downloads", documents: "Documents",
    movies: "Movies", music: "Music", pictures: "Pictures", applications: "Applications", trashName: "Trash", eject: "Eject",
    quickAccess: "Quick Access", quickEmpty: "Drag a folder here, or right-click it and choose Pin to Quick Access.",
    pinQuick: "Pin the Folder Open Here", unpinQuick: "Unpin from Quick Access", pinnedQuick: "{0} pinned to Quick Access", notFolder: "Only folders can be pinned",
    moveUp: "Move Up", moveDown: "Move Down",
  },
});

const Sidebar = (() => {
  const BOOKMARKS = [
    ["recents", "clock", "recents"],
    ["desktop", "desktop", "desktop"],
    ["downloads", "download", "downloads"],
    ["documents", "doc", "documents"],
    ["movies", "film", "movies"],
    ["music", "music", "music"],
    ["pictures", "photo", "pictures"],
    ["home", "house", null],
    ["applications", "app", "applications"],
    ["trash", "trash", "trashName"],
  ];
  let volumes = [];

  function item(uri, iconName, label, end = "", pinned = false) {
    return `<button class="side-item" data-uri="${esc(uri)}"${pinned ? " data-pinned" : ""}><span class="ico" data-ico="${iconName}">${icon(iconName)}</span><span class="label">${esc(label)}</span>${end}</button>`;
  }

  function render() {
    const places = S.places || {};
    let html = `<div class="side-head">${esc(t("bookmarks"))}</div>`;
    for (const [key, iconName, word] of BOOKMARKS) {
      if (!places[key]) continue;
      html += item(places[key], iconName, word ? t(word) : nameOf(places[key]));
    }
    $("sideBookmarks").innerHTML = html;
    // Quick Access: the folders the user pinned, first in the sidebar, as File Explorer has them.
    const pins = S.settings.favourites || [];
    const pinMark = `<span class="pin" aria-hidden="true">${icon("pin")}</span>`;
    $("sideQuick").innerHTML =
      `<div class="side-head"><span>${esc(t("quickAccess"))}</span><span class="end" data-quick-add title="${esc(t("pinQuick"))}">${icon("plus")}</span></div>` +
      (pins.length ? pins.map((uri, i) => item(uri, isLocal(uri) ? "folder" : "network", placeName(uri), pinMark, true).replace("<button ", `<button data-quick="${i}" `)).join("") : `<div class="quick-empty">${esc(t("quickEmpty"))}</div>`);
    let disks = `<div class="side-head">${esc(t("locations"))}</div>`;
    for (const v of volumes) {
      const eject = v.ejectable ? `<span class="end" data-eject="${esc(v.path)}" title="${esc(t("eject"))}">${icon("eject")}</span>` : "";
      disks += item(`file://${v.path.split("/").map(encodeURIComponent).join("/")}`, v.internal ? "drive" : "drive.external", v.name, eject);
    }
    $("sideLocations").innerHTML = disks;
    mark();
  }

  // Marks the place the focused pane shows.
  function mark() {
    const here = Panes.current()?.uri;
    for (const el of document.querySelectorAll(".side-item[data-uri]")) el.classList.toggle("on", samePlace(el.dataset.uri, here));
  }

  async function loadVolumes() {
    volumes = await call("native.volumes").catch(() => volumes);
    render();
  }

  $("sidebar").addEventListener("click", (e) => {
    if (e.target.closest("[data-quick-add]")) {
      e.stopPropagation();
      return pinHere();
    }
    if (dragged) return;
    const eject = e.target.closest("[data-eject]");
    if (eject) {
      e.stopPropagation();
      Devices.eject(eject.dataset.eject);
      return;
    }
    const el = e.target.closest(".side-item[data-uri]");
    // With Command it opens in a new tab, as a folder does with Command and a double click.
    if (el && e.metaKey) Panes.focused()?.newTab(el.dataset.uri);
    else if (el) Panes.open(el.dataset.uri);
  });
  // The middle button opens a place in a tab behind the one shown.
  $("sidebar").addEventListener("auxclick", (e) => {
    const el = e.button === 1 && e.target.closest(".side-item[data-uri]");
    const pane = Panes.focused();
    if (el && pane) pane.newTab(el.dataset.uri, null, { background: true, at: pane.active + 1 });
  });
  // A place's own menu, unless its section has one: open it here, in a new tab or window, take a pinned folder out, or
  // eject a disk.
  $("sidebar").addEventListener("contextmenu", async (e) => {
    const el = e.target.closest(".side-item[data-uri]");
    if (!el || e.defaultPrevented) return;
    e.preventDefault();
    const uri = el.dataset.uri;
    const pinned = el.hasAttribute("data-pinned");
    const disk = el.querySelector("[data-eject]")?.dataset.eject;
    const id = await LZ.choose(
      [
        { id: "open", label: t("m.open"), icon: "arrow.up.forward.app" },
        { id: "tab", label: t("m.openTab"), icon: "plus.rectangle.on.rectangle" },
        { id: "window", label: t("m.openWindow"), icon: "macwindow.badge.plus" },
        ...(pinned
          ? [
              { separator: true },
              { id: "up", label: t("moveUp"), icon: "arrow.up", enabled: Number(el.dataset.quick) > 0 },
              { id: "down", label: t("moveDown"), icon: "arrow.down", enabled: Number(el.dataset.quick) < (S.settings.favourites || []).length - 1 },
              { id: "unpin", label: t("unpinQuick"), icon: "pin.slash" },
            ]
          : [{ separator: true }, { id: "pin", label: t("m.pin"), icon: "pin" }]),
        ...(disk ? [{ separator: true }, { id: "eject", label: t("eject"), icon: "eject" }] : []),
      ],
      e.clientX,
      e.clientY,
    );
    if (id === "open") Panes.open(uri);
    else if (id === "tab") Panes.focused()?.newTab(uri);
    else if (id === "window") call("app.new_window", { uri }).catch(say);
    else if (id === "unpin") pin(uri, false);
    else if (id === "pin") pin(uri, true);
    else if (id === "up" || id === "down") reorder(Number(el.dataset.quick), Number(el.dataset.quick) + (id === "up" ? -1 : 1));
    else if (id === "eject") Devices.eject(disk);
  });

  // Pins a folder to the sidebar, or takes it out.
  function pin(uri, on) {
    const now = (S.settings.favourites || []).filter((u) => !samePlace(u, uri));
    if (on) now.push(uri);
    setSetting({ favourites: now });
  }
  const pinned = (uri) => (S.settings.favourites || []).some((u) => samePlace(u, uri));

  // Moves the pinned folder at `from` to `to` in Quick Access.
  function reorder(from, to) {
    const now = [...(S.settings.favourites || [])];
    if (!now[from] || to < 0 || to >= now.length || from === to) return;
    now.splice(to, 0, ...now.splice(from, 1));
    setSetting({ favourites: now });
  }

  // Pins the folder the focused pane shows.
  function pinHere() {
    const uri = Panes.current()?.uri;
    if (!uri) return;
    if (!pinned(uri)) {
      pin(uri, true);
      LZ.toast(t("pinnedQuick", placeName(uri)));
    }
  }

  // Pins what was dropped on Quick Access, each folder once; a file is not pinned.
  async function pinDropped(uris) {
    let files = 0;
    for (const uri of uris) {
      const entry = await call("fs.stat", { uri }).catch(() => null);
      if (!entry?.isDir) files++;
      else if (!pinned(uri)) pin(uri, true);
    }
    if (files) LZ.toast(t("notFolder"));
  }

  // A pinned folder dragged up or down the list takes the place it is let go at.
  let dragged = false;
  $("sideQuick").addEventListener("mousedown", (down) => {
    const el = down.button === 0 && down.target.closest(".side-item[data-quick]");
    if (!el) return;
    const items = [...$("sideQuick").querySelectorAll(".side-item[data-quick]")];
    const from = Number(el.dataset.quick);
    let to = from;
    let moving = false;
    const move = (m) => {
      const dy = m.clientY - down.clientY;
      if (!moving && Math.abs(dy) < 5) return;
      moving = true;
      el.classList.add("lifted");
      el.style.transform = `translateY(${dy}px)`;
      const h = el.getBoundingClientRect().height;
      to = Math.min(items.length - 1, Math.max(0, from + Math.round(dy / h)));
    };
    const up = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
      el.classList.remove("lifted");
      el.style.transform = "";
      if (!moving) return;
      // The click that ends a drag opens nothing.
      dragged = true;
      setTimeout(() => (dragged = false), 0);
      reorder(from, to);
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  });
  on("settings.changed", () => render());

  // The sidebar's width follows a drag of its right edge, at once rather than with the motion of showing and hiding.
  $("sideResizer").addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = $("sidebar").getBoundingClientRect().width + 8;
    $("app").classList.add("still");
    const move = (m) => {
      const w = Math.min(380, Math.max(160, startW + m.clientX - startX));
      $("app").style.setProperty("--side-w", `${w}px`);
    };
    const up = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
      $("app").classList.remove("still");
      Panes.saveSoon();
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  });

  // Disks come and go while the app runs (ui/parts/32-devices.js); their free space is asked for again when the window
  // comes forward.
  window.addEventListener("focus", loadVolumes);

  async function start() {
    S.places = await call("native.home").catch(() => ({}));
    render();
    loadVolumes();
  }

  function toggle() {
    $("app").classList.toggle("no-sidebar");
    Panes.saveSoon();
  }

  return { start, render, mark, toggle, loadVolumes, volumes: () => volumes, pin, pinned, pinHere, pinDropped, width: () => $("app").style.getPropertyValue("--side-w") };
})();
