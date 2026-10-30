// Workspaces (W1): the window's layout, panes, tabs and places saved under a name in the sidebar, and brought back
// with a click; a right click renames, saves over or deletes one.
LZ.words({
  vi: {
    workspaces: "Workspace", saveWorkspace: "Lưu workspace", workspaceName: "Tên workspace", workspaceNameText: "Lưu bố cục, các khung và tab hiện tại với tên này.",
    renameWorkspace: "Đổi tên", overwriteWorkspace: "Lưu đè bằng cửa sổ hiện tại", deleteWorkspace: "Xóa workspace", workspaceSaved: "Đã lưu workspace \"{0}\"",
  },
  en: {
    workspaces: "Workspaces", saveWorkspace: "Save Workspace", workspaceName: "Workspace name", workspaceNameText: "Saves the layout, the panes and the tabs of this window under this name.",
    renameWorkspace: "Rename", overwriteWorkspace: "Save This Window Over It", deleteWorkspace: "Delete Workspace", workspaceSaved: "Workspace \"{0}\" saved",
  },
});
LZ.icons.add({
  workspace: "rectangle.3.group,square.stack.3d.up",
});

const Workspaces = (() => {
  let all = [];
  const section = LZ.sidebar.section({
    id: "workspaces",
    render(el) {
      el.innerHTML =
        `<div class="side-head"><span>${LZ.esc(t("workspaces"))}</span><span class="end" data-ws-save title="${LZ.esc(t("saveWorkspace"))}">${icon("plus")}</span></div>` +
        all.map((w) => `<button class="side-item" data-ws="${LZ.esc(w.id)}"><span class="ico" data-ico="workspace">${icon("workspace")}</span><span class="label">${LZ.esc(w.name)}</span></button>`).join("");
    },
  });

  async function load() {
    all = await LZ.call("workspaces.list").catch(() => all);
    section.refresh();
  }

  async function save(name) {
    const value = name ?? (await LZ.prompt(t("workspaceName"), { text: t("workspaceNameText"), ok: t("saveWorkspace") }));
    if (!value) return;
    LZ.call("workspaces.save", { name: value, state: Panes.state() })
      .then(() => {
        LZ.toast(t("workspaceSaved", value));
        load();
      })
      .catch(LZ.say);
  }

  section.el.addEventListener("click", (e) => {
    if (e.target.closest("[data-ws-save]")) return save();
    const item = e.target.closest("[data-ws]");
    const w = item && all.find((x) => x.id === item.dataset.ws);
    if (w) Panes.load(w.state);
  });
  section.el.addEventListener("contextmenu", async (e) => {
    const item = e.target.closest("[data-ws]");
    const w = item && all.find((x) => x.id === item.dataset.ws);
    if (!w) return;
    e.preventDefault();
    const choice = await LZ.choose(
      [
        { id: "rename", label: t("renameWorkspace"), icon: "pencil" },
        { id: "over", label: t("overwriteWorkspace"), icon: "square.and.arrow.down" },
        { separator: true },
        { id: "delete", label: t("deleteWorkspace"), icon: "trash" },
      ],
      e.clientX,
      e.clientY,
    );
    if (choice === "rename") {
      const name = await LZ.prompt(t("workspaceName"), { value: w.name, ok: t("renameWorkspace") });
      if (name) LZ.call("workspaces.rename", { id: w.id, name }).then(load, LZ.say);
    } else if (choice === "over") save(w.name);
    else if (choice === "delete") LZ.call("workspaces.delete", { id: w.id }).then(load, LZ.say);
  });

  Panes.actions.saveWorkspace = () => save();
  Keys.add({ "Cmd+Alt+W": "saveWorkspace" });
  LZ.on("app.hello", load);
  return { load, save };
})();
