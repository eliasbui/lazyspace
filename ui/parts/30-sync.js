// Comparing and syncing two folders (W3), in a sheet: the differences with what each would do, every line's action
// changeable, and nothing done until Sync is pressed and confirmed.
LZ.words({
  vi: {
    syncTitle: "So sánh và đồng bộ", syncMenu: "So sánh và đồng bộ...", comparePanes: "So sánh với khung bên cạnh", modeLtr: "Trái sang phải", modeRtl: "Phải sang trái",
    modeBoth: "Hai chiều", byTime: "Kích thước và ngày", byContent: "Nội dung", ignoreHidden: "Bỏ qua tệp ẩn", mirror: "Xóa mục thừa ở đích (vào Thùng rác; trên máy chủ thì xóa hẳn)",
    compare: "So sánh", doSync: "Đồng bộ", syncSummary: "{0} giống nhau, {1} khác biệt", syncTruncated: "Chỉ liệt kê 20.000 mục khác biệt đầu tiên.",
    "s.leftNewer": "Trái mới hơn", "s.rightNewer": "Phải mới hơn", "s.leftOnly": "Chỉ bên trái", "s.rightOnly": "Chỉ bên phải", "s.conflict": "Xung đột",
    "a.skip": "Bỏ qua", "a.ltr": "Chép sang phải", "a.rtl": "Chép sang trái", "a.deleteLeft": "Xóa bên trái", "a.deleteRight": "Xóa bên phải",
    syncConfirm: "Đồng bộ {0} mục?", syncConfirmText: "Chép sang phải {0}, chép sang trái {1}, chuyển vào Thùng rác {2}. Mục bị thay sẽ mất bản cũ.",
    comparing: "Đang so sánh...", allSame: "Hai thư mục giống nhau.", swap: "Đổi bên", filterAll: "Tất cả",
  },
  en: {
    syncTitle: "Compare and Sync", syncMenu: "Compare and Sync...", comparePanes: "Compare with the Next Pane", modeLtr: "Left to right", modeRtl: "Right to left",
    modeBoth: "Both ways", byTime: "Size and date", byContent: "Content", ignoreHidden: "Ignore hidden files", mirror: "Remove extra items from the target (to the Trash; on a server for good)",
    compare: "Compare", doSync: "Sync", syncSummary: "{0} the same, {1} different", syncTruncated: "Only the first 20,000 differences are listed.",
    "s.leftNewer": "Left is newer", "s.rightNewer": "Right is newer", "s.leftOnly": "Left only", "s.rightOnly": "Right only", "s.conflict": "Conflict",
    "a.skip": "Skip", "a.ltr": "Copy to the right", "a.rtl": "Copy to the left", "a.deleteLeft": "Remove from the left", "a.deleteRight": "Remove from the right",
    syncConfirm: "Sync {0} items?", syncConfirmText: "{0} copied to the right, {1} to the left, {2} moved to the Trash. Replaced items lose their old version.",
    comparing: "Comparing...", allSame: "The two folders are the same.", swap: "Swap sides", filterAll: "All",
  },
});
LZ.icons.add({
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4"/></svg>',
});

const Sync = (() => {
  const SHOWN = 2000;
  const STATES = ["leftNewer", "rightNewer", "leftOnly", "rightOnly", "conflict"];
  const ACTIONS = ["skip", "ltr", "rtl", "deleteLeft", "deleteRight"];
  let left = null;
  let right = null;
  let pairs = [];
  let job = null;
  let filter = "all";
  let options = { mode: "ltr", content: false, ignoreHidden: true, mirror: false };

  const panel = LZ.sheet.create("syncSheet");
  panel.classList.add("sync-panel");
  panel.innerHTML = `
    <h2 data-t="syncTitle"></h2>
    <div class="sync-sides"><span class="sync-left"></span><button class="mini" data-sync="swap">${icon("swap")}</button><span class="sync-right"></span></div>
    <div class="sync-options">
      <div class="segmented" data-opt="mode"><button class="seg" data-v="ltr" data-t="modeLtr"></button><button class="seg" data-v="rtl" data-t="modeRtl"></button><button class="seg" data-v="both" data-t="modeBoth"></button></div>
      <div class="segmented" data-opt="content"><button class="seg" data-v="false" data-t="byTime"></button><button class="seg" data-v="true" data-t="byContent"></button></div>
      <label class="check"><input type="checkbox" data-opt="ignoreHidden"> <span data-t="ignoreHidden"></span></label>
      <label class="check"><input type="checkbox" data-opt="mirror"> <span data-t="mirror"></span></label>
      <button class="push" data-sync="compare" data-t="compare"></button>
    </div>
    <div class="sync-filter"></div>
    <div class="sync-summary"></div>
    <div class="sync-table"></div>
    <div class="buttons"><button class="push" data-sync="close" data-t="done"></button><button class="push primary" data-sync="apply" data-t="doSync" disabled></button></div>`;
  const table = panel.querySelector(".sync-table");
  const summary = panel.querySelector(".sync-summary");

  const side = (s) => (s ? `${s.isDir ? "--" : fmtSize(s.size)}, ${fmtDate(s.mtime)}` : "");

  function paintOptions() {
    panel.querySelector(".sync-left").textContent = pathOf(left);
    panel.querySelector(".sync-right").textContent = pathOf(right);
    for (const seg of panel.querySelectorAll('[data-opt="mode"] .seg')) seg.classList.toggle("on", seg.dataset.v === options.mode);
    for (const seg of panel.querySelectorAll('[data-opt="content"] .seg')) seg.classList.toggle("on", seg.dataset.v === String(options.content));
    panel.querySelector('[data-opt="ignoreHidden"]').checked = options.ignoreHidden;
    const mirror = panel.querySelector('[data-opt="mirror"]');
    mirror.checked = options.mirror && options.mode !== "both";
    mirror.disabled = options.mode === "both";
  }

  function render() {
    const counts = Object.fromEntries(STATES.map((s) => [s, pairs.filter((p) => p.state === s).length]));
    panel.querySelector(".sync-filter").innerHTML = [["all", t("filterAll"), pairs.length], ...STATES.filter((s) => counts[s]).map((s) => [s, t(`s.${s}`), counts[s]])]
      .map(([key, label, n]) => `<button class="chip${filter === key ? " on" : ""}" data-filter="${key}">${LZ.esc(label)} <b>${n}</b></button>`)
      .join("");
    const shown = pairs.map((p, i) => [p, i]).filter(([p]) => filter === "all" || p.state === filter);
    table.innerHTML =
      shown
        .slice(0, SHOWN)
        .map(
          ([p, i]) => `<div class="sr ${p.state}" data-i="${i}">
            <span class="badge">${LZ.esc(t(`s.${p.state}`))}</span>
            <span class="rel" title="${LZ.esc(p.rel)}">${LZ.esc(p.rel)}</span>
            <span class="sd">${side(p.left)}</span>
            <select>${ACTIONS.map((a) => `<option value="${a}"${a === p.action ? " selected" : ""}>${LZ.esc(t(`a.${a}`))}</option>`).join("")}</select>
            <span class="sd">${side(p.right)}</span>
          </div>`,
        )
        .join("") || (job ? "" : `<p class="sync-empty">${LZ.esc(t("allSame"))}</p>`);
    const active = pairs.filter((p) => p.action !== "skip").length;
    const apply = panel.querySelector('[data-sync="apply"]');
    apply.disabled = !active;
    apply.textContent = active ? `${t("doSync")} (${active})` : t("doSync");
  }

  function compare() {
    pairs = [];
    summary.textContent = t("comparing");
    table.innerHTML = "";
    LZ.call("sync.compare", { left, right, options })
      .then((d) => (job = d.job))
      .catch((error) => (summary.textContent = String(error)));
  }

  LZ.on("jobs.finished", (d) => {
    if (d.id !== job) return;
    job = null;
    if (!d.ok) {
      summary.textContent = d.cancelled ? "" : String(d.error || "");
      return;
    }
    if (d.data?.pairs) {
      pairs = d.data.pairs;
      summary.textContent = t("syncSummary", d.data.same, pairs.length) + (d.data.truncated ? ` ${t("syncTruncated")}` : "");
      render();
    } else if (d.data?.done != null) {
      compare();
    }
  });

  panel.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-sync]")?.dataset.sync;
    const seg = e.target.closest(".segmented .seg");
    const chip = e.target.closest("[data-filter]");
    if (seg) {
      const opt = seg.closest("[data-opt]").dataset.opt;
      options[opt] = opt === "content" ? seg.dataset.v === "true" : seg.dataset.v;
      if (opt === "mode" && options.mode === "both") options.mirror = false;
      paintOptions();
      compare();
    } else if (chip) {
      filter = chip.dataset.filter;
      render();
    } else if (act === "swap") {
      [left, right] = [right, left];
      paintOptions();
      compare();
    } else if (act === "compare") compare();
    else if (act === "close") LZ.sheet.close();
    else if (act === "apply") {
      const count = (a) => pairs.filter((p) => p.action === a).length;
      const n = pairs.filter((p) => p.action !== "skip").length;
      const ok = await LZ.confirm(t("syncConfirm", n), t("syncConfirmText", count("ltr"), count("rtl"), count("deleteLeft") + count("deleteRight")), t("doSync"));
      LZ.sheet.open("syncSheet");
      if (!ok) return;
      summary.textContent = t("comparing");
      LZ.call("sync.apply", { left, right, steps: pairs.map((p) => ({ rel: p.rel, action: p.action })) })
        .then((d) => (job = d.job))
        .catch(LZ.say);
    }
  });
  panel.addEventListener("change", (e) => {
    const opt = e.target.dataset.opt;
    if (opt) {
      options[opt] = e.target.checked;
      compare();
      return;
    }
    const row = e.target.closest(".sr");
    if (row && e.target.tagName === "SELECT") {
      pairs[Number(row.dataset.i)].action = e.target.value;
      render();
    }
  });

  function open(a, b) {
    left = a;
    right = b;
    filter = "all";
    paintOptions();
    LZ.sheet.open("syncSheet");
    compare();
  }

  // The focused pane's folder and the next pane's, or the two folders selected.
  function fromPanes(pane = Panes.focused()) {
    const dirs = pane.tab.selectedEntries().filter((e) => e.isDir);
    if (dirs.length === 2) return open(dirs[0].uri, dirs[1].uri);
    const all = Panes.all();
    if (all.length < 2) return;
    const next = all[(all.indexOf(pane) + 1) % all.length];
    open(pane.tab.uri, next.tab.uri);
  }

  Panes.actions.compareFolders = fromPanes;
  Keys.add({ "Cmd+Alt+K": "compareFolders" });
  LZ.menu.add({ id: "sync", label: "syncMenu", icon: "arrow.triangle.2.circlepath", group: 55, order: 5, when: (c) => c.count === 2 && c.entries.length === 2 && c.entries.every((e) => e.isDir), run: (c) => open(c.entries[0].uri, c.entries[1].uri) });
  LZ.menu.add({ id: "comparePanes", label: "comparePanes", icon: "arrow.triangle.2.circlepath", group: 55, order: 6, action: "compareFolders", when: (c) => c.count === 0 && Panes.all().length > 1, run: (c) => fromPanes(c.pane) });
  return { open };
})();
