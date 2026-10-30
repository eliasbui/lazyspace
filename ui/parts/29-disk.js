// What a folder holds by size, drawn as rectangles as DaisyDisk draws it, and the files in it that are the same
// (src/features/disk.rs). Both start from the folder selected, or the pane's own, in the context menu or the palette.
LZ.words({
  vi: {
    diskMap: "Xem dung lượng", findTwins: "Tìm tệp trùng lặp", diskTitle: "Dung lượng của \"{0}\"", measuring: "Đang đo...", diskUp: "Lên trên",
    diskHint: "Bấm vào một thư mục để xem sâu hơn; nhấp đúp vào một mục để hiện nó trong cửa sổ.",
    twinsTitle: "Tệp trùng lặp trong \"{0}\"", twinsNone: "Không có tệp nào trùng nhau.", twinsSum: "{0} nhóm, có thể giải phóng {1}",
    twinsGroup: "{0} x {1}, thừa {2}", pickExtra: "Chọn các bản thừa", pickNone: "Bỏ chọn", trashPicked: "Chuyển {0} mục vào Thùng rác", finding: "Đang so sánh tệp...",
  },
  en: {
    diskMap: "Show Disk Usage", findTwins: "Find Duplicate Files", diskTitle: "What \"{0}\" Holds", measuring: "Measuring...", diskUp: "Up",
    diskHint: "Click a folder to look inside; double-click an item to show it in the window.",
    twinsTitle: "Duplicate Files in \"{0}\"", twinsNone: "No files are the same.", twinsSum: "{0} groups, {1} to free",
    twinsGroup: "{0} x {1}, {2} extra", pickExtra: "Select the Extra Copies", pickNone: "Deselect", trashPicked: "Move {0} Items to the Trash", finding: "Comparing files...",
  },
});

const Disk = (() => {
  // The folder an action is for: the one folder selected, or the pane's own.
  const folderOf = (pane) => {
    const one = pane.tab.selCount() === 1 ? pane.tab.selectedEntries()[0] : null;
    return one?.isDir && isLocal(one.uri) ? one.uri : isLocal(pane.tab.uri) ? pane.tab.uri : null;
  };
  const jobs = new Map();
  LZ.on("jobs.finished", (d) => {
    const done = jobs.get(d.id);
    if (!done) return;
    jobs.delete(d.id);
    if (d.ok) done(d.data);
  });
  const start = (method, uri, done) => LZ.call(method, { uri }).then((d) => jobs.set(d.job, done), LZ.say);

  // The map: the folders shown, the deepest last, each with the items under it two levels down.
  const map = LZ.sheet.create("diskSheet");
  map.classList.add("disk-panel");
  map.innerHTML = `<header class="disk-head"><button class="push" data-a="up"></button><div class="disk-what"><h2></h2><small></small></div><button class="push primary" data-a="done"></button></header>
    <div class="disk-map"></div><p class="disk-hint"></p>`;
  const area = map.querySelector(".disk-map");
  let shown = [];

  // Rectangles for items of sizes `sizes` (largest first) in a box, as squares as they can be (Bruls, Huizing and van
  // Wijk's squarified treemap): rows are laid along the shorter side while that keeps their shapes squarer.
  function squarify(sizes, x, y, w, h) {
    const total = sizes.reduce((a, b) => a + b, 0);
    const out = [];
    if (!total || w <= 0 || h <= 0) return out;
    const scale = (w * h) / total;
    let rest = sizes.map((s) => s * scale);
    let box = { x, y, w, h };
    while (rest.length) {
      const side = Math.min(box.w, box.h);
      let row = [];
      let worst = Infinity;
      for (const area of rest) {
        const next = [...row, area];
        const sum = next.reduce((a, b) => a + b, 0);
        const ratio = Math.max(...next.map((a) => Math.max((side * side * a) / (sum * sum), (sum * sum) / (side * side * a))));
        if (ratio > worst) break;
        row = next;
        worst = ratio;
      }
      rest = rest.slice(row.length);
      const sum = row.reduce((a, b) => a + b, 0);
      const thick = sum / side;
      let at = 0;
      for (const area of row) {
        const len = area / thick;
        out.push(box.w >= box.h ? { x: box.x, y: box.y + at, w: thick, h: len } : { x: box.x + at, y: box.y, w: len, h: thick });
        at += len;
      }
      box = box.w >= box.h ? { x: box.x + thick, y: box.y, w: box.w - thick, h: box.h } : { x: box.x, y: box.y + thick, w: box.w, h: box.h - thick };
    }
    return out;
  }

  // The colour of an item by what it is.
  const KINDS = [
    [/^(png|jpe?g|gif|heic|webp|tiff?|bmp|raw|dng|psd|svg)$/, 30],
    [/^(mov|mp4|m4v|mkv|avi|webm)$/, 280],
    [/^(mp3|m4a|aac|wav|flac|aiff|ogg)$/, 330],
    [/^(zip|7z|rar|tar|gz|tgz|xz|bz2|dmg|iso|pkg)$/, 20],
    [/^(pdf|docx?|xlsx?|pptx?|pages|numbers|key|txt|md|rtf)$/, 180],
    [/^(rs|js|ts|tsx|py|go|swift|c|h|cpp|java|kt|rb|php|cs|sh|html|css|json)$/, 130],
  ];
  function colour(node, i) {
    if (node.other) return "var(--track)";
    if (node.dir) return `hsl(212, 62%, ${46 + (i % 5) * 6}%)`;
    const ext = node.name.includes(".") ? node.name.split(".").pop().toLowerCase() : "";
    const hue = KINDS.find(([re]) => re.test(ext))?.[1];
    return hue == null ? `hsl(220, 6%, ${52 + (i % 4) * 6}%)` : `hsl(${hue}, 65%, ${50 + (i % 3) * 5}%)`;
  }

  function paint() {
    const node = shown[shown.length - 1];
    map.querySelector('[data-a="up"]').hidden = shown.length < 2;
    map.querySelector("h2").textContent = node ? t("diskTitle", node.name) : t("measuring");
    map.querySelector("small").textContent = node ? fmtSize(node.size) : "";
    if (!node) return (area.innerHTML = `<p class="disk-wait">${esc(t("measuring"))}</p>`);
    const { width, height } = area.getBoundingClientRect();
    const children = node.children.filter((c) => c.size > 0);
    const rects = squarify(children.map((c) => c.size), 0, 0, width, height);
    area.innerHTML = rects
      .map((r, i) => {
        const c = children[i];
        const inner = c.dir && r.w > 90 && r.h > 54 ? squarify(c.children.filter((k) => k.size > 0).map((k) => k.size), 3, 20, r.w - 6, r.h - 23) : [];
        const kids = inner.map((k, j) => `<i style="left:${k.x}px;top:${k.y}px;width:${k.w}px;height:${k.h}px;background:${colour(c.children.filter((x) => x.size > 0)[j], j)}"></i>`).join("");
        const label = r.w > 46 && r.h > 18 ? `<b>${esc(c.name)}</b>${r.h > 34 && !kids ? `<small>${esc(fmtSize(c.size))}</small>` : ""}` : "";
        return `<div class="disk-cell${c.dir ? " dir" : ""}" data-i="${i}" title="${esc(`${c.name} - ${fmtSize(c.size)}`)}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;--c:${colour(c, i)}">${kids}${label}</div>`;
      })
      .join("");
  }
  new ResizeObserver(() => map.closest(".modal.open") && paint()).observe(area);

  function measure(uri) {
    LZ.sheet.open("diskSheet");
    paint();
    start("disk.map", uri, (data) => {
      shown.push(data.map);
      paint();
    });
  }
  area.addEventListener("click", (e) => {
    const node = shown[shown.length - 1]?.children.filter((c) => c.size > 0)[Number(e.target.closest(".disk-cell")?.dataset.i)];
    if (!node?.dir) return;
    shown.push({ ...node, children: node.children });
    paint();
    start("disk.map", fileUri(node.path), (data) => {
      if (shown[shown.length - 1]?.path === data.map.path) shown[shown.length - 1] = data.map;
      paint();
    });
  });
  area.addEventListener("dblclick", (e) => {
    const node = shown[shown.length - 1]?.children.filter((c) => c.size > 0)[Number(e.target.closest(".disk-cell")?.dataset.i)];
    const pane = Panes.focused();
    if (!node?.path || !pane) return;
    closeSheets();
    pane.navigate(fileUri(node.path.slice(0, node.path.lastIndexOf("/")) || "/"), { select: [node.name] });
  });
  map.addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "done") closeSheets();
    if (a === "up" && shown.length > 1) {
      shown.pop();
      paint();
    }
  });

  // The twins: each group with its files to tick, the first of each left unticked by "Select the Extra Copies".
  const twins = LZ.sheet.create("twinsSheet");
  twins.classList.add("twins-panel");
  twins.innerHTML = `<h2></h2><p class="twins-sum"></p><div class="twins-list"></div>
    <div class="buttons"><button class="push" data-a="extra"></button><button class="push" data-a="none"></button><button class="push" data-a="trash"></button><button class="push primary" data-a="done"></button></div>`;
  const list = twins.querySelector(".twins-list");
  let groups = [];
  const picked = () => [...list.querySelectorAll("input:checked")].map((c) => c.dataset.uri);
  function paintTwins(folder) {
    if (folder) twins.querySelector("h2").textContent = t("twinsTitle", nameOf(folder));
    const free = groups.reduce((sum, g) => sum + g.size * (g.uris.length - 1), 0);
    twins.querySelector(".twins-sum").textContent = groups.length ? t("twinsSum", groups.length, fmtSize(free)) : t("twinsNone");
    list.innerHTML = groups
      .map(
        (g) => `<div class="tw-group"><div class="tw-head">${esc(t("twinsGroup", fmtSize(g.size), g.uris.length, fmtSize(g.size * (g.uris.length - 1))))}</div>${g.uris
          .map((uri) => `<label class="tw-row"><input type="checkbox" data-uri="${esc(uri)}"><img src="${esc(`lazy://icon/${16 * pixelRatio()}/${encodeURIComponent(`path:${pathOf(uri)}`)}`)}" alt=""><span>${esc(placeLabel(uri))}</span></label>`)
          .join("")}</div>`,
      )
      .join("");
    count();
  }
  function count() {
    const n = picked().length;
    const b = twins.querySelector('[data-a="trash"]');
    b.textContent = t("trashPicked", n);
    b.disabled = !n;
  }
  list.addEventListener("change", count);
  twins.addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "done") closeSheets();
    if (a === "extra" || a === "none") {
      for (const group of list.querySelectorAll(".tw-group")) [...group.querySelectorAll("input")].forEach((c, i) => (c.checked = a === "extra" && i > 0));
      count();
    }
    if (a === "trash") {
      const uris = picked();
      LZ.call("fs.trash", { uris })
        .then((d) =>
          jobs.set(d.job, () => {
            groups = groups.map((g) => ({ ...g, uris: g.uris.filter((u) => !uris.includes(u)) })).filter((g) => g.uris.length > 1);
            paintTwins();
          }),
        )
        .catch(LZ.say);
    }
  });
  function findTwins(uri) {
    groups = [];
    twins.querySelector("h2").textContent = t("twinsTitle", nameOf(uri));
    twins.querySelector(".twins-sum").textContent = t("finding");
    list.innerHTML = "";
    LZ.sheet.open("twinsSheet");
    start("disk.twins", uri, (data) => {
      groups = data.twins;
      paintTwins(data.folder);
    });
  }

  Object.assign(Panes.actions, {
    diskMap(pane) {
      const uri = folderOf(pane);
      if (!uri) return;
      shown = [];
      measure(uri);
    },
    findTwins(pane) {
      const uri = folderOf(pane);
      if (uri) findTwins(uri);
    },
  });
  const fits = (ctx) => (ctx.count === 1 ? ctx.entry?.isDir && isLocal(ctx.entry.uri) : ctx.count === 0 && isLocal(ctx.tab.uri));
  LZ.menu.add({ id: "diskMap", label: "diskMap", icon: "chart.pie", group: 70, order: 2, when: fits, run: (c) => Panes.action("diskMap", c.pane) });
  LZ.menu.add({ id: "findTwins", label: "findTwins", icon: "doc.on.doc", group: 70, order: 3, when: fits, run: (c) => Panes.action("findTwins", c.pane) });
  LZ.on("app.hello", () => {
    for (const [sel, word] of [['[data-a="up"]', "diskUp"], ['[data-a="done"]', "done"]]) map.querySelector(sel).textContent = t(word);
    map.querySelector(".disk-hint").textContent = t("diskHint");
    for (const [sel, word] of [['[data-a="extra"]', "pickExtra"], ['[data-a="none"]', "pickNone"], ['[data-a="done"]', "done"]]) twins.querySelector(sel).textContent = t(word);
  });
})();
