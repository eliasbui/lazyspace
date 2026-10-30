// The Enhanced Archiver (W6): an archive opens as a folder (read only), "Extract Here" and "Extract To" take it out
// beside it or anywhere, items inside it are extracted where you choose, and "Compress" makes a zip, 7z or tar archive,
// with a password and split volumes where the format allows. An archive that wants a password asks for it.
LZ.words({
  vi: {
    extractHere: "Giải nén tại đây", extractTo: "Giải nén vào...", extractSelected: "Giải nén mục đã chọn vào...", compress: "Nén...", compressTitle: "Nén {0} mục",
    archiveName: "Tên", archiveFormat: "Định dạng", archivePassword: "Mật khẩu (không bắt buộc)", archivePasswordAgain: "Nhập lại mật khẩu", archiveLevel: "Mức nén",
    levelFast: "Nhanh", levelNormal: "Bình thường", levelBest: "Nhỏ nhất", splitVolumes: "Chia nhỏ", splitNone: "Không chia", passwordMismatch: "Hai mật khẩu không khớp",
    passwordOnlyZip7z: "Chỉ zip và 7z đặt được mật khẩu", chooseExtractFolder: "Chọn thư mục để giải nén", archivePasswordTitle: "Tệp nén có mật khẩu", doCompress: "Nén",
  },
  en: {
    extractHere: "Extract Here", extractTo: "Extract To...", extractSelected: "Extract Selected Items To...", compress: "Compress...", compressTitle: "Compress {0} Items",
    archiveName: "Name", archiveFormat: "Format", archivePassword: "Password (optional)", archivePasswordAgain: "Password again", archiveLevel: "Compression",
    levelFast: "Fast", levelNormal: "Normal", levelBest: "Smallest", splitVolumes: "Split", splitNone: "Do not split", passwordMismatch: "The two passwords differ",
    passwordOnlyZip7z: "Only zip and 7z take a password", chooseExtractFolder: "Choose a folder to extract into", archivePasswordTitle: "This archive has a password", doCompress: "Compress",
  },
});

const Archiver = (() => {
  const EXT = /\.(zip|7z|rar|tar|tgz|gz|tbz2?|bz2|txz|xz|lzma|tlz|iso|cab|cpio|xar|lha|lzh|jar|war|apk|ipa|cbz|cbr|z)$/i;
  const isArchive = (e) => e && e.kind === "file" && isLocal(e.uri) && EXT.test(e.name);

  // An archive opens as a folder.
  LZ.vfs.opener((entry) => (isArchive(entry) ? archiveUri(pathOf(entry.uri), "") : null));

  const chooseFolder = () => LZ.call("settings.choose_folder", { prompt: t("chooseExtractFolder") }).then((path) => (path ? fileUri(path) : null));

  function extract(ctx, to) {
    const uris = ctx.entries.filter(isArchive).map((e) => e.uri);
    if (uris.length) LZ.call("archive.extract", { uris, to }).catch(LZ.say);
  }

  // The compress sheet.
  const panel = LZ.sheet.create("compressSheet", { small: true });
  panel.innerHTML = `
    <h2 class="cz-title"></h2>
    <div class="cz-grid">
      <label data-t="archiveName"></label><input class="cz-name" spellcheck="false">
      <label data-t="archiveFormat"></label><select class="cz-format"><option>zip</option><option>7z</option><option>tar.gz</option><option>tar.xz</option><option>tar.bz2</option></select>
      <label data-t="archiveLevel"></label><select class="cz-level"><option value="1" data-t="levelFast"></option><option value="5" selected data-t="levelNormal"></option><option value="9" data-t="levelBest"></option></select>
      <label data-t="archivePassword"></label><input class="cz-pw" type="password">
      <label data-t="archivePasswordAgain"></label><input class="cz-pw2" type="password">
      <label data-t="splitVolumes"></label><select class="cz-split"><option value="0" data-t="splitNone"></option><option value="100">100 MB</option><option value="700">700 MB</option><option value="1024">1 GB</option><option value="4096">4 GB</option></select>
    </div>
    <div class="cz-note"></div>
    <div class="buttons"><button class="push" data-cz="cancel" data-t="cancel"></button><button class="push primary" data-cz="go" data-t="doCompress"></button></div>`;
  let target = null;
  const q = (s) => panel.querySelector(s);

  function paintFormat() {
    const passworded = ["zip", "7z"].includes(q(".cz-format").value);
    for (const el of [q(".cz-pw"), q(".cz-pw2")]) el.disabled = !passworded;
    q(".cz-split").disabled = !passworded;
  }
  q(".cz-format").addEventListener("change", paintFormat);

  function compress(ctx) {
    const entries = ctx.entries.filter((e) => isLocal(e.uri));
    if (!entries.length) return;
    target = ctx.tab.selection();
    q(".cz-title").textContent = t("compressTitle", ctx.count);
    q(".cz-name").value = entries.length === 1 ? entries[0].name.replace(/\.[^.]+$/, "") || entries[0].name : "";
    q(".cz-pw").value = q(".cz-pw2").value = "";
    q(".cz-note").textContent = "";
    paintFormat();
    LZ.sheet.open("compressSheet");
    setTimeout(() => q(".cz-name").select(), 30);
  }

  panel.addEventListener("click", (e) => {
    const act = e.target.closest("[data-cz]")?.dataset.cz;
    if (act === "cancel") return LZ.sheet.close();
    if (act !== "go") return;
    const password = q(".cz-pw").value;
    if (password && password !== q(".cz-pw2").value) return (q(".cz-note").textContent = t("passwordMismatch"));
    LZ.call("archive.create", {
      ...target,
      format: q(".cz-format").value,
      name: q(".cz-name").value.trim() || null,
      password: password || null,
      level: Number(q(".cz-level").value),
      splitMb: Number(q(".cz-split").value),
    })
      .then(() => LZ.sheet.close())
      .catch((error) => (q(".cz-note").textContent = String(error)));
  });

  // A folder of an archive that wants a password: ask, then list it again.
  LZ.on("view.error", async (d) => {
    if (!String(d.error).startsWith("LZ-PASSWORD:")) return;
    const found = Panes.findTab(d.view);
    if (!found) return;
    const [pane, tab] = found;
    if (!tab.uri?.startsWith("archive://")) return;
    const password = await LZ.prompt(t("archivePasswordTitle"), { text: String(d.error).replace(/^LZ-PASSWORD:/, ""), secret: true });
    if (password == null) return;
    LZ.call("archive.password", { uri: tab.uri, password })
      .then(() => pane.refresh())
      .catch(LZ.say);
  });

  const local = (c) => isLocal(c.tab.uri);
  LZ.menu.add({ id: "extractHere", label: "extractHere", icon: "archivebox", group: 45, order: 1, when: (c) => c.count > 0 && c.entries.some(isArchive), run: (c) => extract(c, null) });
  LZ.menu.add({
    id: "extractTo",
    label: "extractTo",
    icon: "archivebox.circle",
    group: 45,
    order: 2,
    when: (c) => c.count > 0 && c.entries.some(isArchive),
    run: async (c) => {
      const to = await chooseFolder();
      if (to) extract(c, to);
    },
  });
  LZ.menu.add({ id: "compress", label: "compress", icon: "shippingbox", group: 45, order: 3, when: (c) => c.count > 0 && local(c), run: compress });
  LZ.menu.add({
    id: "extractSelected",
    label: "extractSelected",
    icon: "square.and.arrow.down",
    group: 45,
    order: 4,
    when: (c) => c.count > 0 && c.tab.uri?.startsWith("archive://"),
    run: async (c) => {
      const to = await chooseFolder();
      if (to) LZ.call("fs.copy", { from: c.entries.map((e) => e.uri), to, mode: "copy" }).catch(LZ.say);
    },
  });
  return { compress };
})();
