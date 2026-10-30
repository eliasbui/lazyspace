// Commands and shortcuts. The actions a dual-pane manager is known for (copy or move to the other pane with F5 and F6,
// swap the panes, open in the other pane), reopening a closed tab, moving between tabs, refreshing, Finder's Move Item
// Here, and the palette (Cmd+P, or Cmd+/ for the list of shortcuts): every action by its name in either language, typed
// without accents if one likes, with its keys, run with Enter.
(() => {
  // [action, group, vi, en]; the label of a layout comes from the layout's own word.
  const COMMANDS = [
    ["home", "go", "Thư mục nhà", "Home"],
    ["desktop", "go", "Màn hình nền", "Desktop"],
    ["documents", "go", "Tài liệu", "Documents"],
    ["downloads", "go", "Tải xuống", "Downloads"],
    ["applications", "go", "Ứng dụng", "Applications"],
    ["back", "go", "Quay lại", "Back"],
    ["forward", "go", "Tiến tới", "Forward"],
    ["enclosing", "go", "Thư mục cha", "Enclosing Folder"],
    ["editAddress", "go", "Đi tới đường dẫn", "Go to Path"],
    ["connectServer", "go", "Kết nối máy chủ", "Connect to Server"],
    ["open", "file", "Mở", "Open"],
    ["quickLook", "file", "Xem nhanh", "Quick Look"],
    ["rename", "file", "Đổi tên", "Rename"],
    ["batchRename", "file", "Đổi tên hàng loạt", "Batch Rename"],
    ["duplicate", "file", "Nhân bản", "Duplicate"],
    ["newFolder", "file", "Thư mục mới", "New Folder"],
    ["newFile", "file", "Tệp mới từ mẫu", "New File from Template"],
    ["copy", "file", "Sao chép", "Copy"],
    ["cut", "file", "Cắt", "Cut"],
    ["paste", "file", "Dán", "Paste"],
    ["pasteMove", "file", "Chuyển mục đã sao chép tới đây", "Move Copied Items Here"],
    ["copyToOther", "file", "Chép sang khung bên kia", "Copy to Other Pane"],
    ["moveToOther", "file", "Chuyển sang khung bên kia", "Move to Other Pane"],
    ["trash", "file", "Chuyển vào Thùng rác", "Move to Trash"],
    ["delete", "file", "Xóa hẳn", "Delete Immediately"],
    ["undo", "file", "Hoàn tác", "Undo"],
    ["getInfo", "file", "Lấy thông tin", "Get Info"],
    ["reveal", "file", "Hiện trong Finder", "Show in Finder"],
    ["revealHere", "file", "Hiện trong LazySpace", "Show in LazySpace"],
    ["copyPath", "file", "Sao chép đường dẫn", "Copy Path"],
    ["selectAll", "file", "Chọn tất cả", "Select All"],
    ["hash", "file", "Tính mã băm", "Calculate Hashes"],
    ["newTab", "panes", "Tab mới", "New Tab"],
    ["closeTab", "panes", "Đóng tab", "Close Tab"],
    ["reopenTab", "panes", "Mở lại tab vừa đóng", "Reopen Closed Tab"],
    ["nextTab", "panes", "Tab sau", "Next Tab"],
    ["previousTab", "panes", "Tab trước", "Previous Tab"],
    ["nextPane", "panes", "Khung sau", "Next Pane"],
    ["previousPane", "panes", "Khung trước", "Previous Pane"],
    ["openInOther", "panes", "Mở ở khung bên kia", "Open in Other Pane"],
    ["swapPanes", "panes", "Đổi chỗ hai khung", "Swap the Panes"],
    ["layoutSingle", "panes", "Bố cục: một khung", "Layout: One Pane"],
    ["layoutH2", "panes", "Bố cục: hai khung cạnh nhau", "Layout: Two Side by Side"],
    ["layoutV2", "panes", "Bố cục: hai khung trên dưới", "Layout: Two Stacked"],
    ["layoutH3", "panes", "Bố cục: ba khung", "Layout: Three Panes"],
    ["layoutL1R2", "panes", "Bố cục: một trái, hai phải", "Layout: One Left, Two Right"],
    ["layoutGrid", "panes", "Bố cục: lưới bốn khung", "Layout: Grid of Four"],
    ["saveWorkspace", "panes", "Lưu workspace", "Save Workspace"],
    ["viewList", "view", "Xem dạng danh sách", "View as List"],
    ["viewIcons", "view", "Xem dạng biểu tượng", "View as Icons"],
    ["iconsBigger", "view", "Biểu tượng to hơn", "Bigger Icons"],
    ["iconsSmaller", "view", "Biểu tượng nhỏ hơn", "Smaller Icons"],
    ["toggleHidden", "view", "Hiện hoặc ẩn tệp ẩn", "Show or Hide Hidden Files"],
    ["toggleSidebar", "view", "Hiện hoặc ẩn thanh bên", "Show or Hide the Sidebar"],
    ["togglePreview", "view", "Hiện hoặc ẩn khung xem trước", "Show or Hide the Preview"],
    ["refresh", "view", "Tải lại", "Refresh"],
    ["find", "view", "Lọc thư mục này", "Filter This Folder"],
    ["compareFolders", "tools", "So sánh và đồng bộ thư mục", "Compare and Sync Folders"],
    ["toggleShelf", "tools", "Hiện hoặc ẩn khay tạm", "Show or Hide the Shelf"],
    ["openTerminal", "tools", "Mở trong Terminal", "Open in Terminal"],
    ["openEditor", "tools", "Mở trong trình soạn thảo", "Open in Editor"],
    ["settings", "tools", "Cài đặt", "Settings"],
    ["palette", "tools", "Lệnh và phím tắt", "Commands and Shortcuts"],
  ];
  const GROUPS = { go: ["Đi tới", "Go"], file: ["Tệp", "File"], panes: ["Khung và tab", "Panes and Tabs"], view: ["Xem", "View"], tools: ["Công cụ", "Tools"] };
  LZ.words({
    vi: {
      ...Object.fromEntries(COMMANDS.map(([id, , vi]) => [`cmd.${id}`, vi])),
      ...Object.fromEntries(Object.entries(GROUPS).map(([id, [vi]]) => [`cmdGroup.${id}`, vi])),
      commandsTitle: "Lệnh và phím tắt", commandsSearch: "Gõ tên lệnh, có dấu hay không đều được", noCommand: "Không có lệnh nào khớp",
      needTwoPanes: "Cần hai khung: chọn bố cục hai khung bằng Cmd+Option+2", noClosedTab: "Không có tab nào vừa đóng",
    },
    en: {
      ...Object.fromEntries(COMMANDS.map(([id, , , en]) => [`cmd.${id}`, en])),
      ...Object.fromEntries(Object.entries(GROUPS).map(([id, [, en]]) => [`cmdGroup.${id}`, en])),
      commandsTitle: "Commands and Shortcuts", commandsSearch: "Type the name of a command", noCommand: "No command matches",
      needTwoPanes: "Two panes are needed: choose a layout of two with Cmd+Option+2", noClosedTab: "No tab was closed",
    },
  });

  // The new actions.
  const other = (pane) => {
    const all = Panes.all();
    return all.length > 1 ? all[(all.indexOf(pane) + 1) % all.length] : null;
  };
  function toOther(pane, mode) {
    const there = other(pane);
    if (!there) return LZ.toast(t("needTwoPanes"));
    const uris = pane.tab.selectedEntries().map((e) => e.uri);
    if (uris.length) LZ.call("fs.copy", { from: uris, to: there.tab.uri, mode }).catch(LZ.say);
  }
  const closed = [];
  const closeTab = Pane.prototype.closeTab;
  Pane.prototype.closeTab = function (i) {
    if (this.tabs.length > 1 && this.tabs[i]?.uri) {
      closed.push(this.tabs[i].uri);
      if (closed.length > 20) closed.shift();
    }
    closeTab.call(this, i);
  };
  const stepTab = (pane, by) => {
    if (pane.tabs.length > 1) pane.activate((pane.active + by + pane.tabs.length) % pane.tabs.length);
  };
  Object.assign(Panes.actions, {
    copyToOther: (pane) => toOther(pane, "copy"),
    moveToOther: (pane) => toOther(pane, "move"),
    openInOther(pane) {
      const there = other(pane);
      if (!there) return LZ.toast(t("needTwoPanes"));
      const folder = pane.tab.selectedEntries().find((e) => e.isDir);
      there.navigate(folder ? folder.uri : pane.tab.uri);
    },
    swapPanes(pane) {
      const there = other(pane);
      if (!there) return LZ.toast(t("needTwoPanes"));
      const [a, b] = [pane.tab.uri, there.tab.uri];
      pane.navigate(b);
      there.navigate(a);
    },
    reopenTab(pane) {
      const uri = closed.pop();
      if (uri) pane.newTab(uri);
      else LZ.toast(t("noClosedTab"));
    },
    nextTab: (pane) => stepTab(pane, 1),
    previousTab: (pane) => stepTab(pane, -1),
    refresh: (pane) => pane.refresh(),
    pasteMove: (pane) => LZ.call("clipboard.paste", { to: pane.tab.uri, move: true }).catch(LZ.say),
    documents: (pane) => S.places.documents && pane.navigate(S.places.documents),
    newFile: () => $("tb-newFile")?.click(),
    hash: (pane) => Hash.start(pane),
    openTerminal: (pane) => OpenIn.open(pane, "terminal"),
    openEditor: (pane) => OpenIn.open(pane, "editor"),
    settings: () => openSheet("settingsSheet"),
    palette: () => open(),
  });

  // In the context menu too, when there is another pane to send to.
  const twoPanes = (c) => c.count > 0 && Panes.all().length > 1;
  LZ.menu.add({ id: "copyToOther", label: "cmd.copyToOther", icon: "arrow.right.doc.on.clipboard", group: 30, order: 4, when: twoPanes, action: "copyToOther", run: (c) => Panes.action("copyToOther", c.pane) });
  LZ.menu.add({ id: "moveToOther", label: "cmd.moveToOther", icon: "arrow.right.square", group: 30, order: 5, when: twoPanes, action: "moveToOther", run: (c) => Panes.action("moveToOther", c.pane) });

  Keys.add({
    F5: "copyToOther",
    F6: "moveToOther",
    "Ctrl+Tab": "nextTab",
    "Ctrl+Shift+Tab": "previousTab",
    "Cmd+Alt+N": "newFile",
    "Cmd+Alt+H": "hash",
    "Cmd+Alt+O": "openInOther",
    "Cmd+Ctrl+T": "openTerminal",
    "Cmd+Ctrl+E": "openEditor",
  });
  Keys.add(
    {
      "Cmd+Shift+T": "reopenTab",
      "Cmd+Shift+]": "nextTab",
      "Cmd+Shift+[": "previousTab",
      "Cmd+R": "refresh",
      "Cmd+Alt+V": "pasteMove",
      "Cmd+Shift+O": "documents",
      "Cmd+U": "swapPanes",
      "Cmd+P": "palette",
      "Cmd+/": "palette",
    },
    "mac",
  );
  Keys.add(
    {
      "Ctrl+Shift+T": "reopenTab",
      "Ctrl+R": "refresh",
      "Ctrl+Shift+V": "pasteMove",
      "Ctrl+U": "swapPanes",
      "Ctrl+P": "palette",
      "Ctrl+/": "palette",
    },
    "windows",
  );

  // The keys of an action as a person reads them: Option for Alt on a Mac, and the names of the keys.
  function keysOf(action) {
    const mac = Keys.keymap() === "mac";
    const names = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Backspace: mac ? "Delete" : "Backspace", Alt: mac ? "Option" : "Alt" };
    return Object.entries(Keys.map())
      .filter(([, name]) => name === action)
      .map(([chord]) => chord.split("+").map((k) => names[k] || k).join("+"))
      .slice(0, 2);
  }

  // Folds a text for matching: lower case, without Vietnamese accents, so "thu muc moi" finds "Thư mục mới".
  const fold = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();

  const panel = LZ.sheet.create("paletteSheet", { small: true });
  panel.classList.add("palette");
  panel.innerHTML = `<input class="cmd-input" spellcheck="false" autocomplete="off" data-tp="commandsSearch"><div class="cmd-list"></div>`;
  const input = panel.querySelector(".cmd-input");
  const list = panel.querySelector(".cmd-list");
  let shown = [];
  let at = 0;

  function paint() {
    const q = fold(input.value.trim());
    const words = q.split(/\s+/).filter(Boolean);
    shown = COMMANDS.filter(([id, , vi, en]) => Panes.actions[id] && words.every((w) => fold(`${vi} ${en} ${id}`).includes(w)));
    at = Math.min(at, Math.max(0, shown.length - 1));
    let group = null;
    list.innerHTML =
      shown
        .map(([id, g], i) => {
          const head = !q && g !== group ? `<div class="cmd-group">${LZ.esc(t(`cmdGroup.${(group = g)}`))}</div>` : "";
          const keys = keysOf(id).map((k) => `<kbd>${LZ.esc(k)}</kbd>`).join("");
          return `${head}<div class="cmd${i === at ? " on" : ""}" data-i="${i}"><span>${LZ.esc(t(`cmd.${id}`))}</span><span class="cmd-keys">${keys}</span></div>`;
        })
        .join("") || `<p class="cmd-none">${LZ.esc(t("noCommand"))}</p>`;
    list.querySelector(".cmd.on")?.scrollIntoView({ block: "nearest" });
  }

  function open() {
    input.value = "";
    at = 0;
    LZ.sheet.open("paletteSheet");
    paint();
    setTimeout(() => input.focus(), 30);
  }

  function run(i) {
    const command = shown[i];
    if (!command) return;
    LZ.sheet.close();
    Panes.action(command[0]);
  }

  input.addEventListener("input", () => {
    at = 0;
    paint();
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      at = Math.min(shown.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
      paint();
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(at);
    } else if (e.key === "Escape") LZ.sheet.close();
  });
  list.addEventListener("mousemove", (e) => {
    const row = e.target.closest(".cmd");
    if (row && Number(row.dataset.i) !== at) {
      at = Number(row.dataset.i);
      for (const el of list.querySelectorAll(".cmd")) el.classList.toggle("on", el === row);
    }
  });
  list.addEventListener("click", (e) => {
    const row = e.target.closest(".cmd");
    if (row) run(Number(row.dataset.i));
  });
})();
