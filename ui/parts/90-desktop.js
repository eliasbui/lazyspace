// LazySpace as the desktop (W9). In the desktop's own window: one pane of icons at ~/Desktop on the wallpaper, each
// icon where it was put (desktop.json), with everything a pane does: the context menu, the keys, Quick Look, renaming,
// dragging out and dropping in. A folder opens in a main window. In Settings: the switches that turn it on and hide
// Finder's own icons.
LZ.words({
  vi: {
    desktop: "Màn hình nền", desktopOn: "Dùng LazySpace làm màn hình nền", desktopOnHint: "Hiện các mục của thư mục Màn hình nền trên hình nền, với menu chuột phải, phím tắt và kéo thả của LazySpace.",
    hideFinderIcons: "Ẩn biểu tượng của Finder trên màn hình nền", hideFinderIconsHint: "Finder sẽ khởi động lại để ẩn biểu tượng của nó; tắt màn hình nền LazySpace thì biểu tượng của Finder trở lại.",
    hideFinderIconsAsk: "Finder sẽ khởi động lại", hideFinderIconsText: "Để ẩn hoặc hiện lại biểu tượng của nó, Finder cần khởi động lại. Các cửa sổ Finder sẽ mở lại như cũ.", restartFinder: "Khởi động lại Finder",
  },
  en: {
    desktop: "Desktop", desktopOn: "Use LazySpace as the desktop", desktopOnHint: "Shows the items of the Desktop folder on the wallpaper, with LazySpace's context menu, shortcuts and drag and drop.",
    hideFinderIcons: "Hide Finder's icons on the desktop", hideFinderIconsHint: "Finder restarts to hide its icons; turning the LazySpace desktop off brings Finder's icons back.",
    hideFinderIconsAsk: "Finder will restart", hideFinderIconsText: "To hide or show its icons again, Finder has to restart. Its windows open again as they were.", restartFinder: "Restart Finder",
  },
});

const DesktopMode = (() => {
  // The space kept free around the icons, as Finder keeps it from the screen's edges.
  const MARGIN = 12;
  let pane = null;
  let cells = {};

  const grid = () => ({ cols: Math.max(1, Math.floor((pane.list.clientWidth - 2 * MARGIN) / CELL_W)), rows: Math.max(1, Math.floor((pane.list.clientHeight - 2 * MARGIN) / CELL_H)) });

  // Where an icon goes: its cell counted from the top right; an item not placed yet waits out of sight.
  function placeAt(i, entry) {
    const cell = entry && cells[entry.name];
    if (!cell) return { left: -9999, top: 0 };
    return { left: pane.list.clientWidth - MARGIN - (cell[0] + 1) * CELL_W, top: MARGIN + cell[1] * CELL_H };
  }

  async function arrange() {
    if (!pane?.tab.generation) return;
    const d = await LZ.call("desktop.place", { view: pane.tab.id, ...grid() }).catch(() => null);
    if (!d) return;
    cells = d.cells;
    pane.render();
  }

  // The cell under a point of the window.
  function cellAt(x, y) {
    const r = pane.list.getBoundingClientRect();
    const col = Math.max(0, Math.floor((r.right - MARGIN - x) / CELL_W));
    const row = Math.max(0, Math.floor((y - r.top - MARGIN) / CELL_H));
    return { col, row };
  }

  function start(d) {
    document.documentElement.classList.add("desktop-mode");
    const uri = d.uri || S.places.desktop;
    Panes.start({ layout: "single", panes: [{ tabs: [{ uri, mode: "icons" }] }] }, uri);
    pane = Panes.all()[0];
    pane.placeAt = placeAt;
    new ResizeObserver(arrange).observe(pane.list);
    LZ.on("view.changed", (v) => v.view === pane.tab.id && arrange());
    LZ.on("desktop.screens", arrange);

    // A folder opens in a main window, a file with its app: the desktop itself stays where it is.
    const open = Panes.actions.open;
    Panes.actions.open = (p) => {
      if (p !== pane) return open(p);
      const entries = p.tab.selectedEntries();
      const into = entries.map((e) => (e.isDir ? e.uri : LZ.vfs.browse(e))).filter(Boolean);
      for (const uri of into) LZ.call("app.new_window", { uri }).catch(LZ.say);
      const files = entries.filter((e) => !e.isDir && !LZ.vfs.browse(e));
      if (files.length) LZ.call("native.open", { uris: files.map((e) => e.uri) }).catch(LZ.say);
    };
    for (const name of ["enclosing", "back", "forward"]) {
      const action = Panes.actions[name];
      Panes.actions[name] = (p) => (p === pane ? undefined : action(p));
    }

    // Icons of the desktop dropped on the desktop move to where they are dropped; anything else is copied or moved in
    // by the core, then placed at the drop as it arrives.
    let dropped = null;
    const move = (names, at) =>
      LZ.call("desktop.move", { view: pane.tab.id, names, ...at, ...grid() })
        .then((d) => {
          cells = d.cells;
          pane.render();
        })
        .catch(LZ.say);
    Panes.onDrop = (drop, target) => {
      if (target.uri !== pane.tab.uri) return false;
      const here = pathOf(pane.tab.uri);
      const names = drop.uris.map((u) => pathOf(u)).filter((p) => p.slice(0, p.lastIndexOf("/")) === here).map((p) => p.slice(p.lastIndexOf("/") + 1));
      if (names.length === drop.uris.length) {
        move(names, cellAt(drop.x, drop.y));
        return true;
      }
      dropped = cellAt(drop.x, drop.y);
      return false;
    };
    LZ.on("jobs.finished", (j) => {
      if (!dropped || !j.ok || !samePlace(j.data?.to, pane.tab.uri) || !j.data.names?.length) return;
      move(j.data.names, dropped);
      dropped = null;
    });
  }

  LZ.on("app.hello", async (d) => {
    if (d.windowRole !== "desktop" || pane) return;
    S.places = await LZ.call("native.home").catch(() => ({}));
    start(d);
  });

  // Settings: the desktop and Finder's icons.
  const group = LZ.settings.section({
    id: "desktop",
    title: "desktop",
    build(el) {
      el.innerHTML = `
        <div class="item"><div class="label"><span data-t="desktopOn"></span><small data-t="desktopOnHint"></small></div>
          <div class="control"><label class="switch"><input type="checkbox" data-desk="on" /><span class="knob"></span></label></div></div>
        <div class="item"><div class="label"><span data-t="hideFinderIcons"></span><small data-t="hideFinderIconsHint"></small></div>
          <div class="control"><label class="switch"><input type="checkbox" data-desk="hide" /><span class="knob"></span></label></div></div>`;
    },
  });
  const box = (k) => group.querySelector(`[data-desk="${k}"]`);
  function paint() {
    const desk = S.settings.desktop || {};
    box("on").checked = !!desk.on;
    box("hide").checked = !!desk.hide_finder_icons;
    box("hide").disabled = !desk.on;
  }
  group.addEventListener("change", async (e) => {
    const kind = e.target.dataset?.desk;
    if (!kind) return;
    const desk = S.settings.desktop || {};
    const on = kind === "on" ? e.target.checked : !!desk.on;
    const hide = kind === "hide" ? e.target.checked : !!desk.hide_finder_icons;
    // Finder restarts when its icons go or come back, which is asked first.
    const finderChanges = (on && hide) !== (!!desk.on && !!desk.hide_finder_icons);
    if (finderChanges && !(await LZ.confirm(t("hideFinderIconsAsk"), t("hideFinderIconsText"), t("restartFinder")))) {
      paint();
      openSheet("settingsSheet");
      return;
    }
    LZ.call("desktop.enable", { on, hideFinderIcons: hide }).catch(LZ.say);
    if (finderChanges) openSheet("settingsSheet");
  });
  LZ.on("settings.changed", paint);
  LZ.on("app.hello", paint);
  return { arrange };
})();
