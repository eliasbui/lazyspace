// The sidebar: the well-known folders under Bookmarks, the disks under Locations, and what features add between them.
// A click opens the place in the focused pane; the place a pane shows is marked.
words({
  vi: {
    bookmarks: "Mục ưa thích", locations: "Vị trí", desktop: "Màn hình nền", downloads: "Tải xuống", documents: "Tài liệu",
    movies: "Phim", music: "Nhạc", pictures: "Ảnh", applications: "Ứng dụng", trashName: "Thùng rác", eject: "Đẩy ra",
  },
  en: {
    bookmarks: "Favourites", locations: "Locations", desktop: "Desktop", downloads: "Downloads", documents: "Documents",
    movies: "Movies", music: "Music", pictures: "Pictures", applications: "Applications", trashName: "Trash", eject: "Eject",
  },
});

const Sidebar = (() => {
  const BOOKMARKS = [
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

  function item(uri, iconName, label, end = "") {
    return `<button class="side-item" data-uri="${esc(uri)}"><span class="ico">${icon(iconName)}</span><span class="label">${esc(label)}</span>${end}</button>`;
  }

  function render() {
    const places = S.places || {};
    let html = `<div class="side-head">${esc(t("bookmarks"))}</div>`;
    for (const [key, iconName, word] of BOOKMARKS) {
      if (!places[key]) continue;
      html += item(places[key], iconName, word ? t(word) : nameOf(places[key]));
    }
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
    if (el) Panes.open(el.dataset.uri);
  });

  // The sidebar's width follows a drag of its right edge.
  $("sideResizer").addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = $("sidebar").getBoundingClientRect().width + 8;
    const move = (m) => {
      const w = Math.min(380, Math.max(160, startW + m.clientX - startX));
      $("app").style.setProperty("--side-w", `${w}px`);
      reportGlass();
    };
    const up = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
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
    reportGlass();
    Panes.saveSoon();
  }

  return { start, render, mark, toggle, loadVolumes, width: () => $("app").style.getPropertyValue("--side-w") };
})();
