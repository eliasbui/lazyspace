// The context menu editor (W1), in Settings: every item of the menu with a box to show or hide it, buttons to move
// it, a line after it, and an SF Symbol of the user's choice; saved as menu.json, which the menu follows at once.
LZ.words({
  vi: {
    contextMenu: "Menu chuột phải", contextMenuHint: "Ẩn hoặc hiện, sắp xếp lại và đổi biểu tượng của từng mục.", resetMenu: "Mặc định",
    lineAfter: "Vạch ngăn sau mục này", line: "Vạch", chooseIcon: "Chọn biểu tượng", editMenu: "Sửa menu...",
  },
  en: {
    contextMenu: "Context Menu", contextMenuHint: "Show or hide, reorder and change the icon of each item.", resetMenu: "Defaults",
    lineAfter: "Line after this item", line: "Line", chooseIcon: "Choose an Icon", editMenu: "Edit Menu...",
  },
});

const MenuEditor = (() => {
  const SYMBOLS = [
    "folder", "folder.fill", "folder.badge.plus", "doc", "doc.text", "doc.badge.plus", "doc.on.doc", "doc.on.clipboard", "scissors", "trash", "trash.slash", "pencil",
    "pencil.and.list.clipboard", "eye", "eye.slash", "info.circle", "link", "star", "star.fill", "heart", "tag", "bookmark", "paperplane", "square.and.arrow.up",
    "square.and.arrow.down", "arrow.up.forward.app", "arrow.up.right.square", "macwindow", "terminal", "chevron.left.forwardslash.chevron.right", "curlybraces", "number",
    "lock", "lock.open", "key", "archivebox", "shippingbox", "externaldrive", "internaldrive", "server.rack", "network", "globe", "cloud", "icloud", "tray",
    "tray.and.arrow.down", "tray.full", "photo", "film", "music.note", "magnifyingglass", "gearshape", "slider.horizontal.3", "wand.and.stars", "sparkles", "bolt",
    "flag", "bell", "clock", "calendar", "plus.square.on.square", "square.grid.2x2", "list.bullet", "arrow.up.arrow.down", "arrow.triangle.2.circlepath", "plus.rectangle.on.rectangle",
  ];
  let layout = { order: [], hidden: [], icons: {}, separators: [] };
  const symbolUrl = (name) => `lazy://symbol/${16 * pixelRatio()}/${encodeURIComponent(name)}`;

  const panel = LZ.sheet.create("menuEditSheet");
  panel.classList.add("menuedit-panel");
  panel.innerHTML = `<h2 data-t="contextMenu"></h2><p data-t="contextMenuHint"></p><div class="me-list"></div>
    <div class="buttons"><button class="push" data-me="reset" data-t="resetMenu"></button><button class="push primary" data-me="done" data-t="done"></button></div>`;
  const list = panel.querySelector(".me-list");
  const picker = LZ.sheet.create("iconPickSheet", { small: true });
  picker.innerHTML = `<h2 data-t="chooseIcon"></h2><div class="me-icons">${SYMBOLS.map((s) => `<button class="me-icon" data-sym="${s}" title="${s}"><img src="${symbolUrl(s)}" alt=""></button>`).join("")}</div>`;
  let picking = null;

  // The items in the order the user gave, those the user never placed after them in their groups' order.
  function ordered() {
    const items = LZ.menu.list();
    if (!layout.order.length) return items;
    const rank = (id) => {
      const i = layout.order.indexOf(id);
      return i < 0 ? Infinity : i;
    };
    return [...items].sort((a, b) => rank(a.id) - rank(b.id));
  }

  // Without an order of the user's own, the lines of the menu are where the groups change.
  function defaultSeparators(items) {
    return items.filter((item, i) => items[i + 1] && items[i + 1].group !== item.group).map((item) => item.id);
  }

  function render() {
    const items = ordered();
    const separators = layout.order.length ? layout.separators : defaultSeparators(items);
    list.innerHTML = items
      .map((item, i) => {
        const iconName = layout.icons[item.id] || item.icon;
        return `<div class="me-row${separators.includes(item.id) ? " line" : ""}" data-id="${item.id}">
          <input type="checkbox" data-me="show"${layout.hidden.includes(item.id) ? "" : " checked"}>
          <button class="me-pick" data-me="icon" title="${LZ.esc(t("chooseIcon"))}">${iconName ? `<img src="${symbolUrl(iconName)}" alt="">` : ""}</button>
          <span class="me-label">${LZ.esc(item.label)}</span>
          <label class="check" title="${LZ.esc(t("lineAfter"))}"><input type="checkbox" data-me="line"${separators.includes(item.id) ? " checked" : ""}> ${LZ.esc(t("line"))}</label>
          <button class="mini" data-me="up"${i === 0 ? " disabled" : ""}>${icon("chevron.up")}</button>
          <button class="mini" data-me="down"${i === items.length - 1 ? " disabled" : ""}>${icon("chevron.down")}</button>
        </div>`;
      })
      .join("");
  }

  // Saves the arrangement as it is on screen; the first change of a default menu writes out its full order.
  function save() {
    const rows = [...list.querySelectorAll(".me-row")];
    layout.order = rows.map((r) => r.dataset.id);
    layout.separators = rows.filter((r) => r.querySelector('[data-me="line"]').checked).map((r) => r.dataset.id);
    LZ.call("menuedit.set", { layout }).catch(LZ.say);
  }

  list.addEventListener("change", (e) => {
    const row = e.target.closest(".me-row");
    if (!row) return;
    if (e.target.dataset.me === "show") {
      layout.hidden = layout.hidden.filter((id) => id !== row.dataset.id);
      if (!e.target.checked) layout.hidden.push(row.dataset.id);
    }
    save();
    render();
  });
  panel.addEventListener("click", (e) => {
    const act = e.target.closest("[data-me]")?.dataset.me;
    const row = e.target.closest(".me-row");
    if ((act === "up" || act === "down") && row) {
      const sibling = act === "up" ? row.previousElementSibling : row.nextElementSibling;
      if (sibling) act === "up" ? sibling.before(row) : sibling.after(row);
      save();
      render();
    } else if (act === "icon" && row) {
      picking = row.dataset.id;
      LZ.sheet.open("iconPickSheet");
    } else if (act === "reset") {
      layout = { order: [], hidden: [], icons: {}, separators: [] };
      LZ.call("menuedit.set", { layout }).catch(LZ.say);
      render();
    } else if (act === "done") LZ.sheet.close();
  });
  picker.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sym]");
    if (!b || !picking) return;
    layout.icons[picking] = b.dataset.sym;
    picking = null;
    LZ.call("menuedit.set", { layout }).catch(LZ.say);
    LZ.sheet.open("menuEditSheet");
    render();
  });

  async function open() {
    layout = await LZ.call("menuedit.get").catch(() => layout);
    layout.icons ||= {};
    render();
    LZ.sheet.open("menuEditSheet");
  }

  LZ.settings.section({
    id: "contextmenu",
    title: "contextMenu",
    build(el) {
      el.innerHTML = `<div class="item"><div class="label"><span data-t="contextMenu"></span><small data-t="contextMenuHint"></small></div><div class="control"><button class="push" data-t="editMenu"></button></div></div>`;
      el.querySelector("button").addEventListener("click", open);
    },
  });
  return { open };
})();
