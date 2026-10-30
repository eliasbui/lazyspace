// The items of the core in the context menu. Features add theirs with LZ.menu.add; the user arranges all of them
// (menu.json, the menu editor of Settings).
words({
  vi: {
    "m.open": "Mở", "m.openWith": "Mở bằng", "m.openTab": "Mở trong tab mới", "m.quickLook": "Xem nhanh", "m.getInfo": "Lấy thông tin",
    "m.rename": "Đổi tên", "m.duplicate": "Nhân bản", "m.copyPath": "Sao chép đường dẫn", "m.copy": "Sao chép", "m.cut": "Cắt", "m.paste": "Dán",
    "m.trash": "Chuyển vào Thùng rác", "m.delete": "Xóa hẳn", "m.newFolder": "Thư mục mới", "m.reveal": "Hiện trong Finder",
    "m.view": "Xem dạng", "m.sort": "Sắp xếp theo", "m.hidden": "Hiện tệp ẩn", "m.asList": "Danh sách", "m.asIcons": "Biểu tượng",
    "m.byName": "Tên", "m.byDate": "Ngày sửa đổi", "m.bySize": "Kích thước", "m.byKind": "Loại", "m.groups": "Nhóm",
  },
  en: {
    "m.open": "Open", "m.openWith": "Open With", "m.openTab": "Open in New Tab", "m.quickLook": "Quick Look", "m.getInfo": "Get Info",
    "m.rename": "Rename", "m.duplicate": "Duplicate", "m.copyPath": "Copy Path", "m.copy": "Copy", "m.cut": "Cut", "m.paste": "Paste",
    "m.trash": "Move to Trash", "m.delete": "Delete Immediately", "m.newFolder": "New Folder", "m.reveal": "Show in Finder",
    "m.view": "View as", "m.sort": "Sort by", "m.hidden": "Show Hidden Files", "m.asList": "List", "m.asIcons": "Icons",
    "m.byName": "Name", "m.byDate": "Date Modified", "m.bySize": "Size", "m.byKind": "Kind", "m.groups": "Groups",
  },
});

(() => {
  const act = (name) => (ctx) => Panes.action(name, ctx.pane);
  const one = (ctx) => ctx.count === 1;
  const some = (ctx) => ctx.count > 0;
  const none = (ctx) => ctx.count === 0;
  // Items of this Mac: those selected (search results and the shelf hold items of many folders), or the folder itself.
  const local = (ctx) => (ctx.count ? ctx.entries.length > 0 && ctx.entries.every((e) => isLocal(e.uri)) : isLocal(ctx.tab.uri));
  const file = (ctx) => one(ctx) && ctx.entry && !ctx.entry.isDir && isLocal(ctx.entry.uri);
  const sortItem = (by, label) => ({
    id: `sort.${by}`,
    label,
    checked: (ctx) => ctx.pane.sortOf(ctx.tab).by === by,
    run: (ctx) => ctx.pane.sortBy(by),
  });
  const items = [
    { id: "open", label: "m.open", icon: "arrow.up.forward.app", group: 10, order: 1, when: some, action: "open", run: act("open") },
    { id: "openWith", label: "m.openWith", icon: "square.and.arrow.up.on.square", group: 10, order: 2, when: file, submenu: [] },
    { id: "openTab", label: "m.openTab", icon: "plus.rectangle.on.rectangle", group: 10, order: 3, when: (c) => some(c) && c.entries.every((e) => e.isDir), run: act("openInNewTab") },
    { id: "quickLook", label: "m.quickLook", icon: "eye", group: 10, order: 4, when: some, action: "quickLook", run: act("quickLook") },
    { id: "getInfo", label: "m.getInfo", icon: "info.circle", group: 20, order: 1, when: local, action: "getInfo", run: act("getInfo") },
    { id: "rename", label: "m.rename", icon: "pencil", group: 20, order: 2, when: (c) => one(c) && c.tab.capabilities.rename, run: act("rename") },
    { id: "duplicate", label: "m.duplicate", icon: "plus.square.on.square", group: 20, order: 3, when: (c) => some(c) && c.tab.capabilities.write, action: "duplicate", run: act("duplicate") },
    { id: "copyPath", label: "m.copyPath", icon: "link", group: 20, order: 4, when: local, action: "copyPath", run: act("copyPath") },
    { id: "copy", label: "m.copy", icon: "doc.on.doc", group: 30, order: 1, when: (c) => some(c) && local(c), action: "copy", run: act("copy") },
    { id: "cut", label: "m.cut", icon: "scissors", group: 30, order: 2, when: (c) => some(c) && local(c) && c.tab.capabilities.write, action: "cut", run: act("cut") },
    { id: "paste", label: "m.paste", icon: "doc.on.clipboard", group: 30, order: 3, when: (c) => c.tab.capabilities.write, action: "paste", run: act("paste") },
    { id: "trash", label: "m.trash", icon: "trash", group: 40, order: 1, when: (c) => some(c) && c.tab.capabilities.trash, action: "trash", run: act("trash") },
    { id: "delete", label: "m.delete", icon: "trash.slash", group: 40, order: 2, when: (c) => some(c) && c.tab.capabilities.write, action: "delete", run: act("delete") },
    { id: "newFolder", label: "m.newFolder", icon: "folder.badge.plus", group: 50, order: 1, when: (c) => c.tab.capabilities.write, action: "newFolder", run: act("newFolder") },
    { id: "reveal", label: "m.reveal", icon: "macwindow", group: 50, order: 2, when: local, action: "reveal", run: act("reveal") },
    {
      id: "view",
      label: "m.view",
      icon: "square.grid.2x2",
      group: 60,
      order: 1,
      when: none,
      submenu: [
        { id: "view.list", label: "m.asList", icon: "list.bullet", checked: (c) => c.tab.mode === "list", action: "viewList", run: act("viewList") },
        { id: "view.icons", label: "m.asIcons", icon: "square.grid.2x2", checked: (c) => c.tab.mode === "icons", action: "viewIcons", run: act("viewIcons") },
        { id: "view.columns", label: "m.asColumns", icon: "rectangle.split.3x1", checked: (c) => c.tab.mode === "columns", action: "viewColumns", run: act("viewColumns") },
        { id: "view.gallery", label: "m.asGallery", icon: "photo.on.rectangle", checked: (c) => c.tab.mode === "gallery", action: "viewGallery", run: act("viewGallery") },
      ],
    },
    { id: "sort", label: "m.sort", icon: "arrow.up.arrow.down", group: 60, order: 2, when: none, submenu: [sortItem("name", "m.byName"), sortItem("mtime", "m.byDate"), sortItem("size", "m.bySize"), sortItem("kind", "m.byKind")] },
    {
      id: "groups",
      label: "m.groups",
      icon: "rectangle.grid.1x2",
      group: 60,
      order: 2.5,
      when: (c) => none(c) && c.tab.mode === "list",
      submenu: GROUPS.map(([g, word]) => ({ id: `group.${g || "none"}`, label: word, checked: (c) => (c.pane.sortOf(c.tab).group || "") === g, run: (c) => c.pane.groupBy(g) })),
    },
    { id: "hidden", label: "m.hidden", icon: "eye.slash", group: 60, order: 3, when: none, checked: () => !!S.settings.show_hidden, action: "toggleHidden", run: act("toggleHidden") },
  ];
  for (const item of items) LZ.menu.add(item);

  // A right click: on an item, the menu of the selection (the item is selected first if it was not); on nothing, the
  // menu of the folder.
  Panes.on("contextmenu", ({ pane, event, index }) => {
    const tab = pane.tab;
    if (index == null) {
      tab.clearSel();
      pane.render();
    }
    const entries = tab.selectedEntries();
    const ctx = { pane, tab, entries, entry: entries[0] || null, count: index == null ? 0 : tab.selCount(), where: index == null ? "empty" : "item", x: event.clientX, y: event.clientY };
    LZ.menu.show(ctx, event.clientX, event.clientY);
  });
})();
