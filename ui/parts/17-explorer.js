// What File Explorer on Windows has that the core did not: a folder pinned to the sidebar, a folder in a new window,
// the selection turned over or cleared, and a menu of the rest behind a button at the end of the toolbar.
LZ.words({
  vi: {
    "m.openWindow": "Mở trong cửa sổ mới", "m.pin": "Ghim vào Truy cập nhanh", "m.unpin": "Bỏ ghim khỏi Truy cập nhanh",
    "m.select": "Chọn", "m.selectAll": "Chọn tất cả", selectNone: "Bỏ chọn tất cả", invertSelection: "Đảo vùng chọn", moreActions: "Thao tác khác",
  },
  en: {
    "m.openWindow": "Open in New Window", "m.pin": "Pin to Quick Access", "m.unpin": "Unpin from Quick Access",
    "m.select": "Select", "m.selectAll": "Select All", selectNone: "Deselect All", invertSelection: "Invert Selection", moreActions: "More Actions",
  },
});

(() => {
  const act = (name) => (ctx) => Panes.action(name, ctx.pane);
  const folders = (ctx) => ctx.count > 0 && ctx.entries.length > 0 && ctx.entries.every((e) => e.isDir);
  // The folder a pin is about: the one folder selected, or the pane's own on a click beside the items.
  const pinTarget = (ctx) => (ctx.count === 1 && ctx.entry?.isDir ? ctx.entry.uri : ctx.count === 0 ? ctx.tab.uri : null);
  const items = [
    { id: "openWindow", label: "m.openWindow", icon: "macwindow.badge.plus", group: 10, order: 3.5, when: folders, run: act("openInNewWindow") },
    { id: "pin", label: "m.pin", icon: "pin", group: 50, order: 4, when: (ctx) => !!pinTarget(ctx) && !Sidebar.pinned(pinTarget(ctx)), run: (ctx) => Sidebar.pin(pinTarget(ctx), true) },
    { id: "unpin", label: "m.unpin", icon: "pin.slash", group: 50, order: 4, when: (ctx) => !!pinTarget(ctx) && Sidebar.pinned(pinTarget(ctx)), run: (ctx) => Sidebar.pin(pinTarget(ctx), false) },
    {
      id: "select",
      label: "m.select",
      icon: "checklist",
      group: 60,
      order: 4,
      when: (ctx) => ctx.count === 0 && ctx.tab.count > 0,
      submenu: [
        { id: "select.all", label: "m.selectAll", icon: "checkmark.circle", action: "selectAll", run: act("selectAll") },
        { id: "select.none", label: "selectNone", icon: "circle", action: "selectNone", run: act("selectNone") },
        { id: "select.invert", label: "invertSelection", icon: "circle.lefthalf.filled", action: "invertSelection", run: act("invertSelection") },
      ],
    },
  ];
  for (const item of items) LZ.menu.add(item);
  Keys.add({ "Cmd+Alt+A": "selectNone" }, "mac");

  // The menu at the end of the toolbar, as File Explorer's "See more": the selection, what the window shows, and the
  // item's details and the settings. It goes last, after the buttons every other part adds.
  window.addEventListener("DOMContentLoaded", () => {
    LZ.toolbar.add({
      id: "more",
      side: "right",
      icon: "ellipsis",
      label: "moreActions",
      run: async (_, button) => {
        const pane = Panes.focused();
        if (!pane) return;
        const r = button.getBoundingClientRect();
        const has = (action) => !!Panes.actions[action];
        const id = await LZ.choose(
          [
            { id: "selectAll", label: t("m.selectAll"), icon: "checkmark.circle" },
            { id: "selectNone", label: t("selectNone"), icon: "circle", enabled: pane.tab.selCount() > 0 },
            { id: "invertSelection", label: t("invertSelection"), icon: "circle.lefthalf.filled" },
            { separator: true },
            { id: "toggleHidden", label: t("m.hidden"), icon: "eye", checked: !!S.settings.show_hidden },
            { id: "alwaysTabs", label: t("alwaysTabs"), icon: "rectangle.stack", checked: S.settings.always_tabs !== false },
            ...(has("togglePreview") ? [{ id: "togglePreview", label: t("cmd.togglePreview"), icon: "sidebar.right" }] : []),
            { id: "toggleSidebar", label: t("cmd.toggleSidebar"), icon: "sidebar.left" },
            { separator: true },
            { id: "copyPath", label: t("m.copyPath"), icon: "link" },
            { id: "getInfo", label: t("m.getInfo"), icon: "info.circle" },
            { id: "settings", label: `${t("settings")}...`, icon: "gearshape" },
          ],
          r.left,
          r.bottom + 6,
        );
        if (id === "alwaysTabs") setSetting({ always_tabs: S.settings.always_tabs === false });
        else if (id) Panes.action(id, pane);
      },
    });
    Toolbar.fit();
  });
})();
