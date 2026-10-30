// New files from templates (W2): a toolbar button and a context menu entry list the templates; the new file is
// selected and its name is ready to type, as a new folder's is.
LZ.words({
  vi: { newFile: "Tệp mới", templatesFolder: "Mở thư mục mẫu", addTemplate: "Dùng tệp đã chọn làm mẫu", templateAdded: "Đã thêm mẫu" },
  en: { newFile: "New File", templatesFolder: "Open the Templates Folder", addTemplate: "Use the Selected File as a Template", templateAdded: "Template added" },
});
LZ.icons.add({
  "doc.plus": "doc.badge.plus",
});

const Templates = (() => {
  let list = [];
  const SYMBOL = { txt: "doc.text", md: "doc.plaintext", docx: "doc.richtext", xlsx: "tablecells", sh: "terminal", py: "chevron.left.forwardslash.chevron.right", html: "globe", json: "curlybraces" };

  async function load() {
    list = await LZ.call("templates.list").catch(() => list);
    return list;
  }

  function create(pane, id) {
    const tab = pane.tab;
    LZ.call("templates.create", { uri: tab.uri, id })
      .then((entry) => {
        tab.pendingRename = entry.name;
        pane.refresh();
      })
      .catch(LZ.say);
  }

  const entries = () => list.map((tpl) => ({ id: `tpl:${tpl.id}`, label: tpl.builtin ? tpl.name : `${tpl.name}${tpl.ext ? `.${tpl.ext}` : ""}`, icon: SYMBOL[tpl.ext] || "doc" }));

  LZ.toolbar.add({
    id: "newFile",
    side: "left",
    icon: "doc.plus",
    label: "newFile",
    run: async (_, button) => {
      const pane = Panes.focused();
      if (!pane?.tab.capabilities.write) return;
      await load();
      const r = button.getBoundingClientRect();
      const id = await LZ.choose([...entries(), { separator: true }, { id: "folder", label: t("templatesFolder"), icon: "folder" }], r.left, r.bottom + 6);
      if (!id) return;
      if (id === "folder") LZ.call("templates.folder").then((uri) => pane.newTab(uri), LZ.say);
      else create(pane, id.slice(4));
    },
  });
  // The new-file button sits with the new-folder and Trash buttons.
  $("tbActions").prepend($("tb-newFile"));

  LZ.menu.add({
    id: "newFile",
    label: "newFile",
    icon: "doc.badge.plus",
    group: 50,
    order: 0,
    when: (c) => c.count === 0 && c.tab.capabilities.write,
    submenu: () => [
      ...list.map((tpl, i) => ({ id: `newFile.${i}`, label: () => entries()[i].label, icon: entries()[i].icon, group: 1, run: (c) => create(c.pane, tpl.id) })),
      { id: "newFile.folder", label: "templatesFolder", icon: "folder", group: 2, run: (c) => LZ.call("templates.folder").then((uri) => c.pane.newTab(uri), LZ.say) },
    ],
  });
  LZ.menu.add({
    id: "addTemplate",
    label: "addTemplate",
    icon: "doc.on.doc",
    group: 50,
    order: 9,
    when: (c) => c.count === 1 && c.entry && c.entry.kind === "file" && isLocal(c.entry.uri),
    run: (c) => LZ.call("templates.add", { uri: c.entry.uri }).then(() => LZ.toast(t("templateAdded")), LZ.say),
  });

  LZ.on("app.hello", load);
  return { load, create };
})();
