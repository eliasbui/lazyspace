// Disks and devices as they come and go (src/features/devices.rs). The sidebar follows a disk mounted, unmounted or
// renamed, and a tab on a disk that went goes home; a note in the corner of the main window in front says what came,
// with what can be done with it: open or eject a disk, install the app a disk image holds and eject the image, or open
// the apps that read a phone or a camera, which macOS mounts as no disk. Settings can turn the notes off; what an eject
// the user asked for has to say is shown either way.
LZ.words({
  vi: {
    "dev.kind.usb": "Ổ USB", "dev.kind.card": "Thẻ nhớ", "dev.kind.thunderbolt": "Ổ Thunderbolt", "dev.kind.external": "Ổ ngoài",
    "dev.kind.internal": "Ổ trong", "dev.kind.network": "Ổ mạng", "dev.kind.image": "Ảnh đĩa",
    "dev.ready": "{0}, còn trống {1} trên {2}", "dev.open": "Mở", "dev.close": "Đóng",
    "dev.eject": "Đẩy ra", "dev.ejecting": "Đang đẩy ra...", "dev.ejectFailed": "Chưa đẩy ra được {0}", "dev.tryAgain": "Thử lại",
    "dev.forceEject": "Đẩy ra bắt buộc", "dev.forceTitle": "Đẩy ra bắt buộc {0}?",
    "dev.forceText": "Ứng dụng đang mở tệp trên ổ này có thể mất phần chưa lưu. Chỉ làm khi đã lưu hết, hoặc không thoát được ứng dụng đó.",
    "dev.notEjectable": "Không có ổ nào đẩy ra được ở đây",
    "dev.inImage": "Trong ảnh đĩa {0}", "dev.appsInImage": "{0} ứng dụng trong ảnh đĩa {1}", "dev.package": "Gói cài đặt trong ảnh đĩa {0}",
    "dev.install": "Cài vào Ứng dụng", "dev.update": "Cập nhật lên {0}", "dev.installThis": "Cài bản {0}", "dev.replace": "Thay bản đang có",
    "dev.hasOlder": "Ứng dụng đang có bản {0}", "dev.hasNewer": "Ứng dụng đang có bản mới hơn ({0})", "dev.hasSame": "Bản này đã có trong Ứng dụng",
    "dev.hasSome": "Đã có một bản trong Ứng dụng", "dev.openApp": "Mở ứng dụng", "dev.runInstaller": "Mở trình cài đặt",
    "dev.installing": "Đang cài...", "dev.installStopped": "Đã dừng cài đặt", "dev.installed": "Đã cài {0}", "dev.installedIn": "Trong {0}.",
    "dev.installedEjected": "Trong {0}. Ảnh đĩa đã được đẩy ra.", "dev.installedNotEjected": "Trong {0}. Chưa đẩy ra được ảnh đĩa: {1}",
    "dev.launch": "Mở {0}", "dev.trashImage": "Bỏ tệp DMG vào Thùng rác",
    "dev.connected": "{0} đã kết nối",
    "dev.appleText": "macOS không mở {0} như một ổ đĩa. Ảnh và video lấy bằng các ứng dụng dưới đây; tệp của ứng dụng chép trong Finder.",
    "dev.cameraText": "Thiết bị gửi ảnh qua PTP nên không hiện thành ổ đĩa. Chép ảnh bằng các ứng dụng dưới đây.",
    "dev.mtpText": "Điện thoại chia sẻ tệp qua MTP, macOS không đọc được. Trên điện thoại, chọn chế độ truyền ảnh (PTP) để chép ảnh bằng ứng dụng dưới đây.",
  },
  en: {
    "dev.kind.usb": "USB drive", "dev.kind.card": "Memory card", "dev.kind.thunderbolt": "Thunderbolt drive", "dev.kind.external": "External drive",
    "dev.kind.internal": "Internal volume", "dev.kind.network": "Network volume", "dev.kind.image": "Disk image",
    "dev.ready": "{0}, {1} free of {2}", "dev.open": "Open", "dev.close": "Close",
    "dev.eject": "Eject", "dev.ejecting": "Ejecting...", "dev.ejectFailed": "{0} was not ejected", "dev.tryAgain": "Try Again",
    "dev.forceEject": "Force Eject", "dev.forceTitle": "Force eject {0}?",
    "dev.forceText": "Apps with files open on this disk may lose what they have not saved. Do it only when all is saved, or when the app cannot be quit.",
    "dev.notEjectable": "There is no disk to eject here",
    "dev.inImage": "In the disk image {0}", "dev.appsInImage": "{0} apps in the disk image {1}", "dev.package": "An installer in the disk image {0}",
    "dev.install": "Install in Applications", "dev.update": "Update to {0}", "dev.installThis": "Install {0}", "dev.replace": "Replace the Installed One",
    "dev.hasOlder": "Applications has {0}", "dev.hasNewer": "Applications has a newer one ({0})", "dev.hasSame": "This version is in Applications already",
    "dev.hasSome": "Applications has a copy already", "dev.openApp": "Open the App", "dev.runInstaller": "Open the Installer",
    "dev.installing": "Installing...", "dev.installStopped": "The install was stopped", "dev.installed": "{0} is installed", "dev.installedIn": "In {0}.",
    "dev.installedEjected": "In {0}. The disk image was ejected.", "dev.installedNotEjected": "In {0}. The disk image was not ejected: {1}",
    "dev.launch": "Open {0}", "dev.trashImage": "Move the DMG to the Trash",
    "dev.connected": "{0} connected",
    "dev.appleText": "macOS does not open the {0} as a disk. Photos and videos come in through the apps below; the files of apps are copied in Finder.",
    "dev.cameraText": "It sends pictures over PTP, so it shows as no disk. Copy them with the apps below.",
    "dev.mtpText": "The phone shares its files over MTP, which macOS cannot read. Set it to transfer photos (PTP) to copy them with the app below.",
  },
});
LZ.icons.add({ iphone: "iphone", ipad: "ipad", camera: "camera", "phone.other": "candybarphone,iphone" });

const Devices = (() => {
  const box = document.createElement("div");
  box.className = "notes";
  box.setAttribute("aria-live", "polite");
  document.body.appendChild(box);
  // key -> { el, key, base (what the note was given), timer }; the oldest first.
  const notes = new Map();
  const MAX = 4;
  // The install jobs that run, by job id, to the key of their note.
  const installs = new Map();
  // The phones and cameras told of in this window: one plugged in every day to charge is told of once.
  const told = new Set();

  const shown = () => S.window.role === "main" && S.settings.notify_devices !== false;
  const iconOf = (path, points = 36) => `lazy://icon/${points * pixelRatio()}/${encodeURIComponent(`path:${path}`)}`;
  const baseName = (path) => String(path).split("/").filter(Boolean).pop() || String(path);
  const imageName = (d) => (d.image ? baseName(d.image) : d.name);
  const folderName = (path) => (path === "/Applications" ? t("applications") : placeLabel(fileUri(path)));
  const nameOf = (path) => Sidebar.volumes().find((v) => v.path === path)?.name || baseName(path);
  const launch = (path) => call("native.open", { uris: [fileUri(path)] }).catch(say);

  // A note: `key` names what it is about, so a newer note of the same thing takes its place. It goes after `life` ms
  // unless the pointer is on it, or stays until closed when `life` is 0 (an eject refused, which waits for an answer).
  function note(key, base) {
    let n = notes.get(key);
    if (!n) {
      const el = document.createElement("div");
      el.className = "note";
      box.prepend(el);
      n = { el, key };
      notes.set(key, n);
      el.addEventListener("mouseenter", () => clearTimeout(n.timer));
      el.addEventListener("mouseleave", () => el.querySelector("button[disabled]") || arm(n));
      while (notes.size > MAX) close(notes.keys().next().value);
    }
    n.base = { symbol: null, img: null, text: "", bad: false, actions: [], rows: [], life: 0, ...base };
    paint(n, n.base);
    arm(n);
    return n;
  }

  function paint(n, o) {
    const head = o.img ? `<img src="${esc(o.img)}" alt="">` : icon(o.symbol);
    const button = (a, attr) => `<button class="push${a.primary ? " primary" : ""}" ${attr}${a.busy ? " disabled" : ""}>${esc(a.label)}</button>`;
    const rows = o.rows.length
      ? `<div class="note-rows">${o.rows
          .map((r, i) => `<div class="note-row"><img src="${esc(r.img)}" alt=""><span>${esc(r.title)}${r.text ? `<small>${esc(r.text)}</small>` : ""}</span>${r.action ? button({ ...r.action, busy: o.busy }, `data-row="${i}"`) : ""}</div>`)
          .join("")}</div>`
      : "";
    const actions = o.actions.length ? `<div class="note-acts">${o.actions.map((a, i) => button({ ...a, busy: o.busy }, `data-act="${i}"`)).join("")}</div>` : "";
    n.el.innerHTML = `<span class="note-ico">${head}</span><b>${esc(o.title)}</b>${o.text ? `<p${o.bad ? ' class="bad"' : ""}>${esc(o.text)}</p>` : ""}${rows}${actions}<button class="note-x" data-close title="${esc(t("dev.close"))}" aria-label="${esc(t("dev.close"))}">${icon("xmark")}</button>`;
    n.el.onclick = (e) => {
      const at = (name) => Number(e.target.closest(`[data-${name}]`)?.dataset[name]);
      if (e.target.closest("[data-close]")) close(n.key);
      else if (e.target.closest("[data-act]")) o.actions[at("act")]?.run();
      else if (e.target.closest("[data-row]")) o.rows[at("row")]?.action?.run();
    };
  }

  function arm(n) {
    clearTimeout(n.timer);
    if (n.base.life) n.timer = setTimeout(() => close(n.key), n.base.life);
  }

  function close(key) {
    const n = notes.get(key);
    if (!n) return;
    notes.delete(key);
    clearTimeout(n.timer);
    n.el.classList.add("leaving");
    setTimeout(() => n.el.remove(), 200);
  }

  // The note waits for what it asked for, its buttons off and a word of what goes on; it stays until that is over, and
  // a failure stays until it is read and closed.
  function busy(key, text) {
    const n = notes.get(key);
    if (!n) return;
    clearTimeout(n.timer);
    paint(n, { ...n.base, busy: true, text: text ?? n.base.text, bad: false });
  }
  function failed(key, error) {
    const n = notes.get(key);
    if (!n) return;
    n.base.life = 0;
    clearTimeout(n.timer);
    paint(n, { ...n.base, text: error, bad: true });
  }

  // Versions as apps write them, part by part, numbers as numbers: 1.10 is after 1.9.
  function compareVersions(a, b) {
    const pa = String(a).split(/[^0-9A-Za-z]+/);
    const pb = String(b).split(/[^0-9A-Za-z]+/);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] ?? "0";
      const y = pb[i] ?? "0";
      const c = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x.localeCompare(y);
      if (c) return Math.sign(c);
    }
    return 0;
  }

  // What a note offers for an app of a disk image, by the version Applications has of it.
  function plan(app) {
    if (app.installed == null) return { text: "", label: t("dev.install"), primary: true };
    if (!app.version || !app.installed) return { text: t("dev.hasSome"), label: t("dev.replace") };
    const order = compareVersions(app.version, app.installed);
    if (order > 0) return { text: t("dev.hasOlder", app.installed), label: t("dev.update", app.version), primary: true };
    if (order < 0) return { text: t("dev.hasNewer", app.installed), label: t("dev.installThis", app.version) };
    return { text: t("dev.hasSame"), label: null };
  }

  const openAction = (d, key) => ({ label: t("dev.open"), run: () => (Panes.focused()?.newTab(d.uri), close(key)) });
  const ejectActions = (d) => (d.ejectable ? [{ label: t("dev.eject"), run: () => eject(d.path, d.name) }] : []);

  function volumeNote(d) {
    const key = `vol:${d.path}`;
    const apps = d.apps || [];
    const packages = d.packages || [];
    const named = (app) => (app.version ? `${app.name} ${app.version}` : app.name);
    if (apps.length === 1) {
      const app = apps[0];
      const p = plan(app);
      const first = p.label ? { label: p.label, primary: p.primary, run: () => install(key, app, true) } : { label: t("dev.openApp"), run: () => launch(app.target) };
      note(key, { img: iconOf(app.path), title: named(app), text: p.text || t("dev.inImage", imageName(d)), actions: [first, openAction(d, key), ...ejectActions(d)], life: 60000 }).volume = d;
    } else if (apps.length > 1) {
      // Each app is installed on its own, and the image stays for the others.
      const rows = apps.map((app) => {
        const p = plan(app);
        return { img: iconOf(app.path, 20), title: named(app), text: p.text, action: p.label ? { label: p.label, primary: p.primary, run: () => install(key, app, false) } : null };
      });
      note(key, { img: iconOf(d.path), title: d.name, text: t("dev.appsInImage", apps.length, imageName(d)), rows, actions: [openAction(d, key), ...ejectActions(d)], life: 60000 }).volume = d;
    } else if (packages.length) {
      const pkg = packages[0];
      const run = { label: t("dev.runInstaller"), primary: true, run: () => call("native.open", { uris: [pkg.uri] }).catch(say) };
      note(key, { img: iconOf(pkg.path), title: pkg.name, text: t("dev.package", imageName(d)), actions: [run, openAction(d, key), ...ejectActions(d)], life: 60000 });
    } else {
      const kind = t(`dev.kind.${d.kind}`);
      const text = d.total > 0 ? t("dev.ready", kind, fmtSize(d.free), fmtSize(d.total)) : kind;
      note(key, { img: iconOf(d.path), title: d.name, text, actions: [{ ...openAction(d, key), primary: true }, ...ejectActions(d)], life: 12000 });
    }
  }

  async function install(key, app, eject) {
    busy(key, t("dev.installing"));
    try {
      const { job } = await call("devices.install", { app: app.path, eject });
      installs.set(job, key);
    } catch (error) {
      failed(key, String(error));
    }
  }

  // Ejects a disk, from its note, the sidebar or Cmd+E. The sidebar dims it meanwhile; a refusal comes as a note, with
  // the apps that hold it when that is why, and a way to force it.
  async function eject(path, name = nameOf(path)) {
    const key = `vol:${path}`;
    const item = [...document.querySelectorAll(".side-item [data-eject]")].find((el) => el.dataset.eject === path)?.closest(".side-item");
    item?.classList.add("ejecting");
    busy(key, t("dev.ejecting"));
    try {
      await call("native.eject", { path });
      close(key);
      Sidebar.loadVolumes();
    } catch (error) {
      item?.classList.remove("ejecting");
      refused(path, name, String(error));
    }
  }

  function refused(path, name, error) {
    note(`vol:${path}`, {
      img: iconOf(path),
      title: t("dev.ejectFailed", name),
      text: error,
      bad: true,
      actions: [
        { label: t("dev.tryAgain"), run: () => eject(path, name) },
        { label: t("dev.forceEject"), run: () => forceEject(path, name) },
      ],
    });
  }

  async function forceEject(path, name) {
    if (!(await LZ.confirm(t("dev.forceTitle", name), t("dev.forceText"), t("dev.forceEject")))) return;
    busy(`vol:${path}`, t("dev.ejecting"));
    call("native.eject", { path, force: true }).then(
      () => {
        close(`vol:${path}`);
        Sidebar.loadVolumes();
      },
      (error) => refused(path, name, String(error)),
    );
  }

  // Tabs on a disk that went go home, as Finder closes the windows of a disk it ejects; on a disk renamed they follow it
  // to its new path.
  function moveTabs(from, to) {
    const under = (uri) => {
      const path = ["file", "search", "archive"].includes(schemeOf(uri)) ? pathOf(uri) : null;
      return path === from || path?.startsWith(`${from}/`) ? path : null;
    };
    for (const pane of Panes.all()) {
      pane.tabs.forEach((tab, i) => {
        const path = under(tab.uri);
        if (path == null) return;
        const uri = to && schemeOf(tab.uri) !== "archive" ? withPath(tab.uri, to + path.slice(from.length)) : S.places.home;
        if (i === pane.active) pane.navigate(uri, { history: false });
        else {
          // A tab in the background lists its new place when it is shown.
          tab.uri = uri;
          tab.requested = false;
        }
      });
    }
    Panes.saveSoon();
  }

  on("volumes.changed", (d) => {
    Sidebar.loadVolumes();
    if (d.kind === "unmounted") {
      close(`vol:${d.path}`);
      moveTabs(d.path, null);
    } else if (d.kind === "renamed") {
      close(`vol:${d.from}`);
      moveTabs(d.from, d.path);
    }
  });
  on("devices.volume", (d) => shown() && volumeNote(d));
  on("devices.device", (d) => {
    const who = `${d.kind}:${d.name}`;
    if (!shown() || told.has(who)) return;
    told.add(who);
    const symbol = d.kind === "apple" ? (/^ipad/i.test(d.name) ? "ipad" : "iphone") : d.kind === "camera" ? "camera" : "phone.other";
    const actions = (d.helpers || []).map((h, i) => ({ label: h.name, primary: i === 0, run: () => call("devices.open_app", { app: h.id }).catch(say) }));
    note(`dev:${d.id}`, { symbol, title: t("dev.connected", d.name), text: t(`dev.${d.kind}Text`, d.name), actions, life: 20000 });
  });
  on("devices.removed", (d) => close(`dev:${d.id}`));

  on("devices.installed", (d) => {
    const volumeKey = d.volume ? `vol:${d.volume}` : null;
    const image = volumeKey && notes.get(volumeKey)?.volume;
    // An image with other apps stays, its row of this one now installed.
    if (image && !d.ejected && image.apps.length > 1) {
      for (const app of image.apps) if (app.target === d.path) app.installed = app.version || "";
      volumeNote(image);
    } else if (volumeKey) close(volumeKey);
    const where = folderName(d.folder);
    const text = d.ejected ? t("dev.installedEjected", where) : d.ejectError ? t("dev.installedNotEjected", where, d.ejectError) : t("dev.installedIn", where);
    const key = `app:${d.path}`;
    const actions = [{ label: t("dev.launch", d.name), primary: true, run: () => (launch(d.path), close(key)) }];
    if (d.image) actions.push({ label: t("dev.trashImage"), run: () => call("fs.trash", { uris: [fileUri(d.image)] }).then(() => close(key), say) });
    note(key, { img: iconOf(d.path), title: t("dev.installed", d.name), text, actions, life: 30000 });
  });
  on("jobs.finished", (d) => {
    const key = installs.get(d.id);
    if (key == null) return;
    installs.delete(d.id);
    if (!d.ok) failed(key, d.cancelled ? t("dev.installStopped") : d.error);
  });

  // Eject (Cmd+E, the File menu): the disks selected, as Finder does, else the disk of the place the pane shows.
  Panes.actions.eject = (pane) => {
    const disks = Sidebar.volumes().filter((v) => v.ejectable);
    const chosen = pane.tab.selectedEntries().flatMap((e) => disks.filter((v) => isLocal(e.uri) && pathOf(e.uri) === v.path));
    const here = isLocal(pane.tab.uri) ? pathOf(pane.tab.uri) : "";
    const holding = disks.filter((v) => here === v.path || here.startsWith(`${v.path}/`)).sort((a, b) => b.path.length - a.path.length);
    const targets = chosen.length ? chosen : holding.slice(0, 1);
    if (!targets.length) return toast(t("dev.notEjectable"));
    for (const v of targets) eject(v.path, v.name);
  };
  Keys.add({ "Cmd+E": "eject" }, "mac");

  return { eject, note, close, compareVersions, plan };
})();
