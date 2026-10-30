// Advanced batch rename (W5): a sheet with rules applied in order and a live preview of the new names; names that
// would collide are marked and keep the Rename button off. The rules stay for the next batch of the session.
LZ.words({
  vi: {
    batchRename: "Đổi tên hàng loạt", batchTitle: "Đổi tên {0} mục", addRule: "Thêm quy tắc", doRename: "Đổi tên",
    "r.replace": "Thay thế", "r.insert": "Chèn", "r.remove": "Xóa ký tự", "r.number": "Đánh số", "r.parent": "Tên thư mục cha", "r.case": "Hoa thường", "r.ext": "Đuôi tệp",
    find: "Tìm", replaceWith: "Thay bằng", regex: "Regex", ignoreCase: "Không phân biệt hoa thường", scopeName: "Tên", scopeExt: "Đuôi", scopeAll: "Tên và đuôi",
    text: "Chữ", atStart: "Ở đầu", atEnd: "Ở cuối", atIndex: "Ở vị trí", position: "Vị trí", count: "Số ký tự", fromEnd: "Tính từ cuối",
    start: "Bắt đầu", step: "Bước", digits: "Số chữ số", separator: "Ngăn cách", lower: "chữ thường", upper: "CHỮ HOA", title: "Viết Hoa Mỗi Từ", sentence: "Viết hoa đầu câu",
    newExt: "Đuôi mới (để trống là giữ nguyên)", keepCase: "Giữ nguyên", previewSummary: "{0} mục đổi tên, {1} lỗi", moveUp: "Lên", moveDown: "Xuống", removeRule: "Bỏ quy tắc",
  },
  en: {
    batchRename: "Batch Rename", batchTitle: "Rename {0} Items", addRule: "Add Rule", doRename: "Rename",
    "r.replace": "Replace", "r.insert": "Insert", "r.remove": "Remove Characters", "r.number": "Number", "r.parent": "Folder Name", "r.case": "Case", "r.ext": "Extension",
    find: "Find", replaceWith: "Replace with", regex: "Regex", ignoreCase: "Ignore case", scopeName: "Name", scopeExt: "Extension", scopeAll: "Name and extension",
    text: "Text", atStart: "At start", atEnd: "At end", atIndex: "At position", position: "Position", count: "Characters", fromEnd: "From the end",
    start: "Start", step: "Step", digits: "Digits", separator: "Separator", lower: "lower case", upper: "UPPER CASE", title: "Title Case", sentence: "Sentence case",
    newExt: "New extension (empty keeps it)", keepCase: "Keep", previewSummary: "{0} renamed, {1} problems", moveUp: "Up", moveDown: "Down", removeRule: "Remove Rule",
  },
});

const BatchRename = (() => {
  const TYPES = ["replace", "insert", "remove", "number", "parent", "case", "ext"];
  const DEFAULTS = {
    replace: { find: "", with: "", regex: false, caseInsensitive: false, scope: "name" },
    insert: { text: "", at: "end", index: 0 },
    remove: { from: 0, count: 1, fromEnd: false },
    number: { start: 1, step: 1, pad: 2, at: "end", sep: " " },
    parent: { at: "start", sep: " " },
    case: { mode: "lower" },
    ext: { set: null, case: null },
  };
  let rules = [{ type: "replace", ...DEFAULTS.replace }];
  let target = null;
  let timer = 0;
  let canApply = false;

  const panel = LZ.sheet.create("renameSheet");
  panel.classList.add("rename-panel");
  panel.innerHTML = `
    <h2 class="rename-title"></h2>
    <div class="rules"></div>
    <div class="rule-add"><button class="push" data-act="add"></button></div>
    <div class="rename-summary"></div>
    <div class="rename-preview"></div>
    <div class="buttons"><button class="push" data-act="cancel" data-t="cancel"></button><button class="push primary" data-act="apply" data-t="doRename"></button></div>`;
  const list = panel.querySelector(".rules");
  const preview = panel.querySelector(".rename-preview");
  const summary = panel.querySelector(".rename-summary");

  const opt = (value, label, current) => `<option value="${value}"${String(current) === String(value) ? " selected" : ""}>${LZ.esc(t(label))}</option>`;
  const num = (key, value, label, min = 0) => `<label class="field-l"><span>${LZ.esc(t(label))}</span><input type="number" data-k="${key}" value="${value}" min="${min}"></label>`;
  const txt = (key, value, label, wide = false) => `<label class="field-l${wide ? " wide" : ""}"><span>${LZ.esc(t(label))}</span><input type="text" data-k="${key}" value="${LZ.esc(value ?? "")}" spellcheck="false"></label>`;
  const chk = (key, value, label) => `<label class="check"><input type="checkbox" data-k="${key}"${value ? " checked" : ""}> ${LZ.esc(t(label))}</label>`;
  const at = (rule) => `<select data-k="at">${opt("start", "atStart", rule.at)}${opt("end", "atEnd", rule.at)}${opt("index", "atIndex", rule.at)}</select>`;

  function fields(rule) {
    switch (rule.type) {
      case "replace":
        return txt("find", rule.find, "find", true) + txt("with", rule.with, "replaceWith", true) + chk("regex", rule.regex, "regex") + chk("caseInsensitive", rule.caseInsensitive, "ignoreCase") +
          `<select data-k="scope">${opt("name", "scopeName", rule.scope)}${opt("ext", "scopeExt", rule.scope)}${opt("all", "scopeAll", rule.scope)}</select>`;
      case "insert":
        return txt("text", rule.text, "text", true) + at(rule) + (rule.at === "index" ? num("index", rule.index, "position") : "");
      case "remove":
        return num("count", rule.count, "count", 1) + num("from", rule.from, "position") + chk("fromEnd", rule.fromEnd, "fromEnd");
      case "number":
        return num("start", rule.start, "start", -999999) + num("step", rule.step, "step", -9999) + num("pad", rule.pad, "digits") + at(rule) + (rule.at === "index" ? num("index", rule.index ?? 0, "position") : "") + txt("sep", rule.sep, "separator");
      case "parent":
        return `<select data-k="at">${opt("start", "atStart", rule.at)}${opt("end", "atEnd", rule.at)}</select>` + txt("sep", rule.sep, "separator");
      case "case":
        return `<select data-k="mode">${["lower", "upper", "title", "sentence"].map((m) => opt(m, m, rule.mode)).join("")}</select>`;
      case "ext":
        return txt("set", rule.set, "newExt", true) + `<select data-k="case">${opt("", "keepCase", rule.case ?? "")}${opt("lower", "lower", rule.case)}${opt("upper", "upper", rule.case)}</select>`;
    }
    return "";
  }

  function render() {
    list.innerHTML = rules
      .map(
        (rule, i) => `<div class="rule" data-i="${i}">
          <select data-k="type">${TYPES.map((type) => opt(type, `r.${type}`, rule.type)).join("")}</select>
          <div class="rule-fields">${fields(rule)}</div>
          <div class="rule-tools">
            <button class="mini" data-act="up" title="${LZ.esc(t("moveUp"))}"${i === 0 ? " disabled" : ""}>${icon("chevron.up")}</button>
            <button class="mini" data-act="down" title="${LZ.esc(t("moveDown"))}"${i === rules.length - 1 ? " disabled" : ""}>${icon("chevron.down")}</button>
            <button class="mini" data-act="drop" title="${LZ.esc(t("removeRule"))}">${icon("xmark")}</button>
          </div>
        </div>`,
      )
      .join("");
    panel.querySelector('[data-act="add"]').textContent = `+ ${t("addRule")}`;
  }

  // The rules as the app takes them: empty strings of the extension rule mean "keep".
  const payload = () =>
    rules.map((r) => {
      const out = { ...r };
      if (r.type === "ext") {
        out.set = r.set === null || r.set === undefined || r.set === "" ? null : r.set;
        out.case = r.case || null;
      }
      return out;
    });

  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!target) return;
      LZ.call("rename.preview", { ...target, rules: payload() })
        .then((d) => {
          canApply = d.problems === 0 && d.changed > 0;
          panel.querySelector('[data-act="apply"]').disabled = !canApply;
          summary.textContent = t("previewSummary", d.changed, d.problems);
          summary.classList.toggle("bad", d.problems > 0);
          preview.innerHTML = d.rows
            .map((r) => `<div class="pr${r.problem ? " bad" : ""}${r.to !== r.from ? " changed" : ""}"><span>${LZ.esc(r.from)}</span><i>${icon("chevron.right")}</i><span title="${LZ.esc(r.problem || "")}">${LZ.esc(r.to)}</span></div>`)
            .join("");
        })
        .catch((error) => {
          canApply = false;
          panel.querySelector('[data-act="apply"]').disabled = true;
          summary.textContent = String(error);
          summary.classList.add("bad");
        });
    }, 120);
  }

  list.addEventListener("input", (e) => {
    const row = e.target.closest(".rule");
    const key = e.target.dataset.k;
    if (!row || !key) return;
    const i = Number(row.dataset.i);
    const el = e.target;
    if (key === "type") {
      rules[i] = { type: el.value, ...DEFAULTS[el.value] };
      render();
    } else {
      rules[i][key] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) || 0 : el.value;
      if (key === "at") render();
    }
    refresh();
  });
  panel.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    const i = Number(e.target.closest(".rule")?.dataset.i);
    if (act === "add") {
      rules.push({ type: "number", ...DEFAULTS.number });
      render();
      refresh();
    } else if (act === "up" || act === "down") {
      const j = act === "up" ? i - 1 : i + 1;
      [rules[i], rules[j]] = [rules[j], rules[i]];
      render();
      refresh();
    } else if (act === "drop") {
      rules.splice(i, 1);
      if (!rules.length) rules.push({ type: "replace", ...DEFAULTS.replace });
      render();
      refresh();
    } else if (act === "cancel") LZ.sheet.close();
    else if (act === "apply" && canApply) {
      LZ.call("rename.apply", { ...target, rules: payload() }).then(() => LZ.sheet.close(), LZ.say);
    }
  });

  function open(pane) {
    const tab = pane.tab;
    if (!tab.selCount() || !isLocal(tab.uri)) return;
    target = tab.selection();
    panel.querySelector(".rename-title").textContent = t("batchTitle", tab.selCount());
    render();
    preview.innerHTML = "";
    summary.textContent = "";
    LZ.sheet.open("renameSheet");
    refresh();
    setTimeout(() => list.querySelector('input[type="text"]')?.focus(), 30);
  }

  // Return renames, as the default button of a Mac dialog does.
  list.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
    e.preventDefault();
    clearTimeout(timer);
    LZ.call("rename.preview", { ...target, rules: payload() })
      .then((d) => {
        if (d.problems === 0 && d.changed > 0) return LZ.call("rename.apply", { ...target, rules: payload() }).then(() => LZ.sheet.close());
        refresh();
      })
      .catch(LZ.say);
  });

  Panes.actions.batchRename = open;
  Keys.add({ "Cmd+Alt+R": "batchRename" });
  LZ.menu.add({ id: "batchRename", label: "batchRename", icon: "pencil.and.list.clipboard", group: 20, order: 2.5, action: "batchRename", when: (c) => c.count > 1 && c.tab.capabilities.rename && isLocal(c.tab.uri), run: (c) => open(c.pane) });
  return { open };
})();
