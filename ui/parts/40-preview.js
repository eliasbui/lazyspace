// The side preview (W4), on the right of the panes or under them: the selected item of the focused pane as a picture,
// a film or a sound that plays, a PDF, text that can be edited and saved, or its Quick Look thumbnail, with what it
// is, its size and dates, and for a film its size, frame rate, data rate and length.
LZ.words({
  vi: {
    preview: "Xem trước", previewToggle: "Bật hoặc tắt khung xem trước", moveBottom: "Đặt khung xem trước bên dưới", moveRight: "Đặt khung xem trước bên phải",
    "pv.kind": "Loại", "pv.size": "Kích thước", "pv.created": "Ngày tạo", "pv.modified": "Ngày sửa đổi", "pv.dims": "Kích thước ảnh", "pv.duration": "Thời lượng",
    "pv.fps": "Tốc độ khung hình", "pv.rate": "Tốc độ dữ liệu", "pv.audio": "Âm thanh", "pv.items": "Số mục", save: "Lưu", saved: "Đã lưu",
    truncated: "Tệp lớn hơn 1 MB: chỉ hiện phần đầu và không sửa được.", dropChanges: "Bỏ thay đổi", nothing: "Chọn một mục để xem trước", many: "Đã chọn {0} mục", unsaved: "Có thay đổi chưa lưu",
  },
  en: {
    preview: "Preview", previewToggle: "Show or hide the preview", moveBottom: "Put the preview below", moveRight: "Put the preview on the right",
    "pv.kind": "Kind", "pv.size": "Size", "pv.created": "Created", "pv.modified": "Modified", "pv.dims": "Dimensions", "pv.duration": "Duration",
    "pv.fps": "Frame rate", "pv.rate": "Data rate", "pv.audio": "Audio", "pv.items": "Items", save: "Save", saved: "Saved",
    truncated: "The file is larger than 1 MB: only its start is shown, and it cannot be edited.", dropChanges: "Drop Changes", nothing: "Select an item to preview it", many: "{0} items selected", unsaved: "Unsaved changes",
  },
});
LZ.icons.add({
  "sidebar.right": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M14.5 5v14"/></svg>',
  "panel.bottom": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 13.5h18"/></svg>',
});

const Preview = (() => {
  const slot = document.querySelector('[data-slot="preview"]');
  const workspace = document.querySelector(".workspace");
  const el = document.createElement("div");
  el.className = "preview";
  el.innerHTML = `<div class="pv-grip"></div><div class="pv-head"><span class="pv-title"></span><button class="mini pv-side"></button></div><div class="pv-body"></div>`;
  slot.appendChild(el);
  const body = el.querySelector(".pv-body");
  const title = el.querySelector(".pv-title");
  let shown = null;
  let timer = 0;
  let text = null;

  const on = () => !!S.settings.preview?.on;
  const side = () => (S.settings.preview?.side === "bottom" ? "bottom" : "right");
  const fileUrl = (uri) => `lazy://file/${encodeURIComponent(pathOf(uri))}`;
  const duration = (s) => {
    const t = Math.round(s);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const sec = String(t % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  };
  const rate = (bits) => (bits >= 1e6 ? `${(bits / 1e6).toLocaleString(locale(), { maximumFractionDigits: 1 })} Mbit/s` : `${Math.round(bits / 1e3)} kbit/s`);

  function apply() {
    slot.hidden = !on();
    workspace.classList.toggle("preview-bottom", side() === "bottom");
    const b = el.querySelector(".pv-side");
    b.innerHTML = icon(side() === "bottom" ? "sidebar.right" : "panel.bottom");
    b.title = t(side() === "bottom" ? "moveRight" : "moveBottom");
    $("tb-preview")?.classList.toggle("on", on());
    if (on()) update(true);
    reportGlass();
  }

  function rows(list) {
    return `<div class="pv-info">${list
      .filter(([, value]) => value != null && value !== "")
      .map(([label, value]) => `<span>${LZ.esc(t(label))}</span><b>${LZ.esc(value)}</b>`)
      .join("")}</div>`;
  }

  // The selected item of the focused pane, or the folder itself when nothing is selected.
  function update(force = false) {
    if (!on()) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const pane = Panes.focused();
      const tab = pane?.tab;
      if (!tab) return;
      const n = tab.selCount();
      if (n > 1) {
        shown = null;
        title.textContent = t("many", n);
        body.innerHTML = `<div class="pv-empty">${LZ.esc(t("many", n))}</div>`;
        return;
      }
      const entry = n === 1 ? tab.rows.get(tab.lead) || tab.selectedEntries()[0] : null;
      const uri = entry ? entry.uri : tab.uri;
      if (!uri || (!force && shown === uri)) return;
      // Text with changes not saved stays until it is saved or its changes are dropped.
      if (text?.dirty) return;
      shown = uri;
      text = null;
      title.textContent = entry ? entry.name : placeName(uri);
      body.innerHTML = entry ? `<div class="pv-media"><img class="pv-icon" src="${iconUrl(entry, 128)}" alt=""></div>` : "";
      LZ.call("preview.info", { uri }).catch(() => {});
    }, 90);
  }

  LZ.on("preview.ready", (d) => {
    if (d.uri !== shown) return;
    if (d.error) {
      body.innerHTML = `<div class="pv-empty">${LZ.esc(d.error)}</div>`;
      return;
    }
    const e = d.entry;
    const common = [
      ["pv.kind", d.type || e.type || ""],
      ["pv.size", d.kind === "folder" ? null : fmtSize(e.size)],
      ["pv.items", d.kind === "folder" && d.items != null ? String(d.items) : null],
      ["pv.created", fmtDate(e.ctime)],
      ["pv.modified", fmtDate(e.mtime)],
    ];
    // An item inside an archive is shown from its copy on this Mac.
    const src = fileUrl(d.local || d.uri);
    let media = "";
    const extra = [];
    if (d.kind === "image") {
      media = `<img class="pv-picture" src="${src}" alt="">`;
    } else if (d.kind === "video") {
      media = `<video class="pv-video" src="${src}" controls preload="metadata"></video>`;
      const v = d.media?.video;
      if (v) extra.push(["pv.dims", `${v.width} × ${v.height}`], ["pv.fps", `${v.fps} fps`], ["pv.rate", rate(v.dataRate)]);
      if (d.media?.duration) extra.push(["pv.duration", duration(d.media.duration)]);
      if (d.media?.audio) extra.push(["pv.audio", rate(d.media.audio.dataRate)]);
    } else if (d.kind === "audio") {
      media = `<img class="pv-icon" src="${iconUrl(e, 128)}" alt=""><audio class="pv-audio" src="${src}" controls preload="metadata"></audio>`;
      if (d.media?.duration) extra.push(["pv.duration", duration(d.media.duration)]);
      if (d.media?.audio) extra.push(["pv.rate", rate(d.media.audio.dataRate)]);
    } else if (d.kind === "pdf") {
      media = `<embed class="pv-pdf" src="${src}" type="application/pdf">`;
    } else if (d.kind === "text") {
      media = `<div class="pv-textwrap"><textarea class="pv-text" spellcheck="false" readonly></textarea><div class="pv-textbar"><span class="pv-note"></span><span><button class="push pv-drop" hidden>${LZ.esc(t("dropChanges"))}</button> <button class="push primary pv-save" hidden>${LZ.esc(t("save"))}</button></span></div></div>`;
    } else if (d.kind === "folder") {
      media = `<img class="pv-icon" src="${iconUrl(e, 128)}" alt="">`;
    } else {
      const thumb = `lazy://thumb/${512 * pixelRatio()}/${encodeURIComponent(pathOf(d.local || d.uri))}`;
      media = thumbImg(thumb, iconUrl(e, 128), "pv-thumb", "pv-icon");
    }
    body.innerHTML = `<div class="pv-media ${d.kind}">${media}</div>${rows([...common, ...extra])}`;
    if (d.kind === "image") {
      const img = body.querySelector(".pv-picture");
      img.addEventListener("load", () => {
        const info = body.querySelector(".pv-info");
        info.insertAdjacentHTML("beforeend", `<span>${LZ.esc(t("pv.dims"))}</span><b>${img.naturalWidth} × ${img.naturalHeight}</b>`);
      });
    }
    if (d.kind === "text") loadText(d, e);
  });

  // Text is read through the app; a small file of a folder that can be written is editable, and saved only if the
  // file did not change elsewhere since it was read.
  function loadText(d, e) {
    const area = body.querySelector(".pv-text");
    const save = body.querySelector(".pv-save");
    const note = body.querySelector(".pv-note");
    const writable = d.editable && Panes.focused()?.tab.capabilities.write;
    LZ.call("fs.read_text", { uri: d.uri, max: 1048576 })
      .then((r) => {
        if (shown !== d.uri) return;
        area.value = r.text;
        area.readOnly = !writable || r.truncated;
        note.textContent = r.truncated ? t("truncated") : "";
        text = { uri: d.uri, mtime: r.mtime, dirty: false };
      })
      .catch((error) => (note.textContent = String(error)));
    const drop = body.querySelector(".pv-drop");
    area.addEventListener("input", () => {
      if (!text) return;
      text.dirty = true;
      save.hidden = drop.hidden = false;
      note.textContent = t("unsaved");
    });
    drop.addEventListener("click", () => {
      text = null;
      update(true);
    });
    const doSave = () => {
      if (!text?.dirty) return;
      LZ.call("fs.write_text", { uri: text.uri, text: area.value, mtime: text.mtime })
        .then((entry) => {
          text = { ...text, mtime: entry.mtime, dirty: false };
          save.hidden = drop.hidden = true;
          note.textContent = t("saved");
        })
        .catch(LZ.say);
    };
    save.addEventListener("click", doSave);
    area.addEventListener("keydown", (ev) => {
      if (ev.key === "s" && ev.metaKey) {
        ev.preventDefault();
        doSave();
      }
    });
  }

  function toggle() {
    setSetting({ preview: { on: !on() } });
  }

  el.querySelector(".pv-side").addEventListener("click", () => setSetting({ preview: { side: side() === "bottom" ? "right" : "bottom" } }));
  // The preview's width (or height below the panes) follows a drag of its edge.
  el.querySelector(".pv-grip").addEventListener("mousedown", (e) => {
    e.preventDefault();
    const bottom = side() === "bottom";
    const start = bottom ? e.clientY : e.clientX;
    const size = bottom ? slot.getBoundingClientRect().height : slot.getBoundingClientRect().width;
    const move = (m) => {
      const value = Math.min(bottom ? 600 : 720, Math.max(bottom ? 140 : 220, size - ((bottom ? m.clientY : m.clientX) - start)));
      slot.style.setProperty(bottom ? "--pv-h" : "--pv-w", `${value}px`);
    };
    const up = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  });

  LZ.toolbar.add({ id: "preview", side: "right", icon: "sidebar.right", label: "previewToggle", run: toggle });
  Panes.actions.togglePreview = toggle;
  Keys.add({ "Cmd+Shift+P": "togglePreview" });
  Panes.on("selection", () => update());
  LZ.on("view.changed", () => update(true));
  LZ.on("settings.changed", apply);
  LZ.on("app.hello", apply);
  return { update, toggle };
})();
