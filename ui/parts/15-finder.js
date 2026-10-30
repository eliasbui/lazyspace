// LazySpace in place of Finder (src/features/viewer.rs). "Show in LazySpace" beside "Show in Finder": the folder of
// each item in a new tab of the focused pane, the item selected. A window without panes of its own (the shelf, the
// desktop) asks the app, which sends the folders to a main window as `viewer.show`, as it does with what macOS sends
// once LazySpace is the Mac's file viewer. In Settings: the switch that makes it so.
LZ.words({
  vi: {
    revealHere: "Hiện trong LazySpace", "m.revealHere": "Hiện trong LazySpace",
    finderTitle: "Finder", viewerOn: "Dùng LazySpace thay Finder",
    viewerOnHint: "Đổi một cài đặt của macOS: khi ứng dụng khác bảo \"Hiện trong Finder\" và khi mở một thư mục, LazySpace sẽ mở thay Finder. Tắt đi thì Finder trở lại như cũ.",
    viewerPartly: "macOS mới nhận một phần: tắt rồi bật lại, hoặc tắt để trả hết cho Finder.",
    viewerUnavailable: "Chỉ bản LazySpace.app (cài từ tệp .app) mới thay được Finder.",
  },
  en: {
    revealHere: "Show in LazySpace", "m.revealHere": "Show in LazySpace",
    finderTitle: "Finder", viewerOn: "Use LazySpace instead of Finder",
    viewerOnHint: "Changes a macOS setting: when another app says \"Show in Finder\" and when a folder is opened, LazySpace opens instead of Finder. Turning it off gives Finder back.",
    viewerPartly: "macOS took only part of it: turn it off and on again, or off to give everything back to Finder.",
    viewerUnavailable: "Only LazySpace.app (installed from the .app) can stand in for Finder.",
  },
});

const Viewer = (() => {
  // The folders that hold `uris`, each with the names to select in it, in the order met.
  function folders(uris) {
    const out = new Map();
    for (const uri of uris) {
      const path = pathOf(uri);
      if (path === "/") {
        out.set(uri, out.get(uri) || []);
        continue;
      }
      const folder = withPath(uri, path.slice(0, path.lastIndexOf("/")) || "/");
      const names = out.get(folder) || [];
      names.push(path.split("/").pop());
      out.set(folder, names);
    }
    return out;
  }

  // Each folder in a new tab of `pane`, its items selected once they are listed.
  function open(pane, uri, names) {
    pane.newTab(uri, names?.length ? names : null);
    Panes.focus(pane);
    pane.list.focus({ preventScroll: true });
  }

  // The items of this Mac: in a main window here, from any other window through a main one.
  function reveal(pane, uris) {
    const local = uris.filter(isLocal);
    if (!local.length) return;
    if (S.window.role !== "main" || !pane) return LZ.call("viewer.reveal", { uris: local }).catch(LZ.say);
    for (const [uri, names] of folders(local)) open(pane, uri, names);
  }

  // What the app sends waits for the panes, which start after the window's hello (09-core-start.js).
  const waiting = [];
  const start = Panes.start;
  Panes.start = (...args) => {
    start(...args);
    for (const d of waiting.splice(0)) open(Panes.focused(), d.uri, d.names);
  };
  LZ.on("viewer.show", (d) => {
    if (S.window.role !== "main") return;
    if (Panes.focused()) open(Panes.focused(), d.uri, d.names);
    else waiting.push(d);
  });

  // The selection, or the folder of the tab itself when nothing is selected.
  const targets = (pane) => (pane.tab.selCount() ? pane.tab.selectedEntries().map((e) => e.uri) : [pane.tab.uri]);
  Panes.actions.revealHere = (pane) => reveal(pane, targets(pane));
  // The items on the shelf's own pane are files of this Mac though the tab is not, so the entries decide.
  const local = (ctx) => (ctx.count ? ctx.entries.length > 0 && ctx.entries.every((e) => isLocal(e.uri)) : isLocal(ctx.tab.uri));
  LZ.menu.add({ id: "revealHere", label: "m.revealHere", icon: "folder", group: 50, order: 3, when: local, action: "revealHere", run: (ctx) => Panes.action("revealHere", ctx.pane) });
  Keys.add({ "Cmd+Ctrl+R": "revealHere" });

  // Settings: LazySpace as the Mac's file viewer and its app for folders. The switch shows what macOS says, not what
  // was last asked for.
  const group = LZ.settings.section({
    id: "viewer",
    title: "finderTitle",
    build(el) {
      el.innerHTML = `
        <div class="item"><div class="label"><span data-t="viewerOn"></span><small data-t="viewerOnHint"></small><small data-viewer="note" hidden></small></div>
          <div class="control"><label class="switch"><input type="checkbox" data-viewer="on" /><span class="knob"></span></label></div></div>`;
    },
  });
  const box = group.querySelector('[data-viewer="on"]');
  const note = group.querySelector('[data-viewer="note"]');
  function paint(state) {
    if (!state) return;
    const both = state.fileViewer && state.folders;
    const some = state.fileViewer || state.folders;
    box.checked = some;
    box.disabled = !state.available && !some;
    const why = !state.available && !some ? "viewerUnavailable" : some && !both ? "viewerPartly" : null;
    note.hidden = !why;
    note.textContent = why ? t(why) : "";
  }
  const refresh = () => LZ.call("viewer.state").then(paint, () => (box.disabled = false));
  box.addEventListener("change", () => {
    box.disabled = true;
    LZ.call("viewer.enable", { on: box.checked }).then(paint, (error) => {
      LZ.say(error);
      refresh();
    });
  });
  // macOS's settings can change outside the app, so they are read again whenever the window comes forward.
  LZ.on("app.hello", refresh);
  window.addEventListener("focus", refresh);

  return { reveal, folders };
})();
