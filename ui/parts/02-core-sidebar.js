// The sidebar: the well-known folders under Bookmarks, the disks under Locations, and what features add between them.
// A click opens the place in the focused pane; the place a pane shows is marked.
words({
  vi: {
    bookmarks: "Mục ưa thích", locations: "Vị trí", unpin: "Bỏ ghim khỏi thanh bên", desktop: "Màn hình nền", downloads: "Tải xuống", documents: "Tài liệu",
    movies: "Phim", music: "Nhạc", pictures: "Ảnh", applications: "Ứng dụng", trashName: "Thùng rác", eject: "Đẩy ra",
  },
  en: {
    bookmarks: "Favourites", locations: "Locations", unpin: "Remove from Sidebar", desktop: "Desktop", downloads: "Downloads", documents: "Documents",
    movies: "Movies", music: "Music", pictures: "Pictures", applications: "Applications", trashName: "Trash", eject: "Eject",
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
    // The folders the user pinned, after the Mac's own, as Finder adds them to its Favourites.
    for (const uri of S.settings.favourites || []) html += item(uri, isLocal(uri) ? "folder" : "network", placeName(uri), "", true);
    $("sideBookmarks").innerHTML = html;
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
    const eject = e.target.closest("[data-eject]");
    if (eject) {
      e.stopPropagation();
      call("native.eject", { path: eject.dataset.eject }).then(loadVolumes, say);
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
  // A place's own menu, unless its section has one: open it here, in a new tab or window, or take a pinned folder out.
  $("sidebar").addEventListener("contextmenu", async (e) => {
    const el = e.target.closest(".side-item[data-uri]");
    if (!el || e.defaultPrevented) return;
    e.preventDefault();
    const uri = el.dataset.uri;
    const pinned = el.hasAttribute("data-pinned");
    const id = await LZ.choose(
      [
        { id: "open", label: t("m.open"), icon: "arrow.up.forward.app" },
        { id: "tab", label: t("m.openTab"), icon: "plus.rectangle.on.rectangle" },
        { id: "window", label: t("m.openWindow"), icon: "macwindow.badge.plus" },
        ...(pinned ? [{ separator: true }, { id: "unpin", label: t("unpin"), icon: "pin.slash" }] : []),
      ],
      e.clientX,
      e.clientY,
    );
    if (id === "open") Panes.open(uri);
    else if (id === "tab") Panes.focused()?.newTab(uri);
    else if (id === "window") call("app.new_window", { uri }).catch(say);
    else if (id === "unpin") pin(uri, false);
  });

  // Pins a folder to the sidebar, or takes it out.
  function pin(uri, on) {
    const now = (S.settings.favourites || []).filter((u) => !samePlace(u, uri));
    if (on) now.push(uri);
    setSetting({ favourites: now });
  }
  const pinned = (uri) => (S.settings.favourites || []).some((u) => samePlace(u, uri));
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

  // Disks come and go while the app runs; they are asked for again when the window comes forward.
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

  return { start, render, mark, toggle, loadVolumes, pin, pinned, width: () => $("app").style.getPropertyValue("--side-w") };
})();
