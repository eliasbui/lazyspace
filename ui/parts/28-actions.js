// Commands of the user's own (src/features/actions.rs): written in Settings, offered in the context menu for the items
// they fit, run with the items as their arguments; what they print comes back as a toast.
LZ.words({
  vi: {
    actionsTitle: "Lệnh của bạn", "m.actions": "Lệnh",
    actionsHint: "Mỗi lệnh là một dòng zsh. Các mục đang chọn là tham số của nó (\"$@\", $1) và nó chạy trong thư mục chứa chúng; $LAZYSPACE_FOLDER là thư mục đó. Tên tệp không bao giờ bị chạy thành lệnh.",
    actionName: "Tên", actionCommand: "Dòng lệnh, ví dụ: code \"$@\"", addAction: "Thêm lệnh", removeAction: "Xóa lệnh này",
    "when.any": "Mọi mục", "when.files": "Chỉ tệp", "when.folders": "Chỉ thư mục", "when.none": "Không chọn gì",
    "out.toast": "Hiện kết quả", "out.terminal": "Chạy trong Terminal", "out.none": "Chạy im lặng", actionDone: "Xong: {0}",
  },
  en: {
    actionsTitle: "Your Commands", "m.actions": "Commands",
    actionsHint: "Each command is a line of zsh. The items selected are its arguments (\"$@\", $1) and it runs in the folder they are in; $LAZYSPACE_FOLDER is that folder. No file name is ever run as a command.",
    actionName: "Name", actionCommand: "Command, for example: code \"$@\"", addAction: "Add Command", removeAction: "Remove This Command",
    "when.any": "Any item", "when.files": "Files only", "when.folders": "Folders only", "when.none": "Nothing selected",
    "out.toast": "Show the output", "out.terminal": "Run in Terminal", "out.none": "Run quietly", actionDone: "Done: {0}",
  },
});

(() => {
  let actions = [];
  const load = () => LZ.call("actions.list").then((list) => (actions = list), () => actions);

  // Whether a command is offered for what the menu is about.
  const fits = (a, ctx) =>
    a.when === "none" ? ctx.count === 0 : ctx.count > 0 && (a.when === "any" || ctx.entries.every((e) => (a.when === "folders" ? e.isDir : !e.isDir)));
  // The folder a command runs in: the pane's, or the folder of the first item when the pane is not one of this Mac.
  const folderOf = (ctx) => (isLocal(ctx.tab.uri) ? ctx.tab.uri : ctx.entries[0]?.uri.slice(0, ctx.entries[0].uri.lastIndexOf("/")));
  LZ.menu.add({
    id: "actions",
    label: "m.actions",
    icon: "terminal",
    group: 70,
    order: 1,
    when: (ctx) => actions.some((a) => fits(a, ctx)) && !!folderOf(ctx) && ctx.entries.every((e) => isLocal(e.uri)),
    submenu: (ctx) =>
      actions
        .filter((a) => fits(a, ctx))
        .map((a) => ({ id: `action.${a.id}`, label: () => a.name, run: (c) => LZ.call("actions.run", { id: a.id, folder: folderOf(c), uris: c.count ? c.entries.map((e) => e.uri) : [] }).catch(LZ.say) })),
  });
  LZ.on("jobs.finished", (d) => {
    if (!d.ok || d.data?.action == null) return;
    const out = String(d.data.output || "").trim();
    LZ.toast(out ? (out.length > 300 ? `${out.slice(0, 300)}...` : out) : t("actionDone", d.data.action));
  });

  // Settings: the commands as rows of fields, kept as they are typed.
  const group = LZ.settings.section({
    id: "actions",
    title: "actionsTitle",
    build(el) {
      el.innerHTML = `<div class="item"><div class="label"><small data-t="actionsHint"></small></div></div><div class="act-list"></div>
        <div class="item"><div class="control"><button class="push" data-act="add" data-t="addAction"></button></div></div>`;
    },
  });
  const listEl = group.querySelector(".act-list");
  const option = (prefix, value, current) => `<option value="${value}"${value === current ? " selected" : ""}>${LZ.esc(t(`${prefix}.${value}`))}</option>`;
  function paint() {
    listEl.innerHTML = actions
      .map(
        (a, i) => `<div class="act-row" data-i="${i}">
          <input class="act-name" data-f="name" value="${LZ.esc(a.name)}" placeholder="${LZ.esc(t("actionName"))}" spellcheck="false">
          <input class="act-command" data-f="command" value="${LZ.esc(a.command)}" placeholder="${LZ.esc(t("actionCommand"))}" spellcheck="false">
          <select data-f="when">${["any", "files", "folders", "none"].map((v) => option("when", v, a.when)).join("")}</select>
          <select data-f="output">${["toast", "terminal", "none"].map((v) => option("out", v, a.output)).join("")}</select>
          <button class="act-remove" data-act="remove" title="${LZ.esc(t("removeAction"))}">${icon("xmark")}</button>
        </div>`,
      )
      .join("");
  }
  let timer;
  const keep = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const ready = actions.filter((a) => a.name.trim() && a.command.trim());
      LZ.call("actions.save", { actions: ready }).catch(LZ.say);
    }, 400);
  };
  group.addEventListener("input", (e) => {
    const row = e.target.closest(".act-row");
    const field = e.target.dataset.f;
    if (!row || !field) return;
    actions[Number(row.dataset.i)][field] = e.target.value;
    keep();
  });
  group.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "add") {
      actions.push({ id: `a${Date.now().toString(36)}`, name: "", command: "", when: "any", output: "toast" });
      paint();
      listEl.querySelector(".act-row:last-child .act-name")?.focus();
    } else if (act === "remove") {
      actions.splice(Number(e.target.closest(".act-row").dataset.i), 1);
      paint();
      keep();
    }
  });
  group.addEventListener("keydown", (e) => e.stopPropagation());
  LZ.on("app.hello", () => load().then(paint));
  LZ.on("settings.changed", paint);
})();
