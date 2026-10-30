// The share sheet of macOS (src/native/share.rs) for the items selected, or the folder itself when none is: from a
// button of the toolbar, as Finder has it, and from the context menu.
LZ.words({ vi: { share: "Chia sẻ", "m.share": "Chia sẻ..." }, en: { share: "Share", "m.share": "Share..." } });
LZ.icons.add({ "share.up": "square.and.arrow.up" });

(() => {
  const targets = (pane) => (pane.tab.selCount() ? pane.tab.selectedEntries().map((e) => e.uri) : [pane.tab.uri]).filter(isLocal);
  function share(pane, x, y) {
    const uris = targets(pane);
    if (uris.length) LZ.call("native.share", { uris, x, y }).catch(LZ.say);
  }
  Panes.actions.share = (pane) => {
    const r = $("tb-share")?.getBoundingClientRect();
    share(pane, r ? r.left + r.width / 2 : innerWidth / 2, r ? r.bottom : 60);
  };
  LZ.toolbar.add({
    id: "share",
    side: "right",
    icon: "share.up",
    label: "share",
    run: (_, button) => {
      const pane = Panes.focused();
      const r = button.getBoundingClientRect();
      if (pane) share(pane, r.left + r.width / 2, r.bottom);
    },
  });
  const local = (ctx) => (ctx.count ? ctx.entries.length > 0 && ctx.entries.every((e) => isLocal(e.uri)) : isLocal(ctx.tab.uri));
  LZ.menu.add({ id: "share", label: "m.share", icon: "square.and.arrow.up", group: 30, order: 6, when: local, run: (ctx) => share(ctx.pane, ctx.x ?? innerWidth / 2, ctx.y ?? 60) });
})();
