// Phones and cameras as places (src/features/phones.rs): a Devices section under the disks lists each one for as long
// as it is plugged in, those plugged in before the app started too, and a click opens it in the pane as device://,
// its folders and files as Image Capture reads them. A pane on a device lists again once the device has read its whole
// catalog, or is unlocked; one on a device that was unplugged goes home, as a tab on an ejected disk does.
LZ.words({
  vi: {
    "ph.devices": "Thiết bị", "ph.opening": "Đang mở...", "ph.reading": "Đang đọc danh sách tệp ({0}%)", "ph.ready": "Sẵn sàng",
    "ph.locked": "Đang khóa hoặc chưa tin cậy máy Mac này", "ph.failed": "Không mở được", "ph.mtp": "Chia sẻ qua MTP, macOS không đọc được",
    "ph.waiting": "Đang chờ Image Capture nhận ra", "ph.closed": "Bấm để xem tệp", "ph.device": "Thiết bị",
  },
  en: {
    "ph.devices": "Devices", "ph.opening": "Opening...", "ph.reading": "Reading the list of files ({0}%)", "ph.ready": "Ready",
    "ph.locked": "Locked, or does not trust this Mac yet", "ph.failed": "Could not be opened", "ph.mtp": "Shares over MTP, which macOS cannot read",
    "ph.waiting": "Waiting for Image Capture to recognise it", "ph.closed": "Click to see its files", "ph.device": "Device",
  },
});

const Phones = (() => {
  const SCHEME = "device";
  let phones = [];
  const byKey = (key) => phones.find((p) => p.key === key);
  const onDevice = (uri) => schemeOf(uri) === SCHEME;
  const symbolOf = (p) => (p.kind === "apple" ? (/^ipad/i.test(p.name) ? "ipad" : "iphone") : p.kind === "camera" ? "camera" : "phone.other");

  // A device's place is named after the device at its top, then by its folders.
  const rootName = (uri) => byKey(authorityOf(uri))?.name || t("ph.device");
  placeNames[SCHEME] = (uri) => (pathOf(uri) === "/" ? rootName(uri) : nameOf(uri));
  placeCrumbs[SCHEME] = (uri) => {
    const items = [[withPath(uri, "/"), rootName(uri), null]];
    let at = "";
    for (const part of pathOf(uri).split("/").filter(Boolean)) items.push([withPath(uri, (at = `${at}/${part}`)), part, null]);
    return items;
  };

  // What a device is up to, as its tooltip says.
  function status(p) {
    if (!p.readable) return t(p.kind === "mtp" ? "ph.mtp" : "ph.waiting");
    if (p.state === "reading") return t("ph.reading", p.percent);
    return t({ opening: "ph.opening", ready: "ph.ready", locked: "ph.locked", failed: "ph.failed" }[p.state] || "ph.closed");
  }

  const section = LZ.sidebar.section({
    id: "phones",
    render(el) {
      if (S.window.role !== "main" || !phones.length) {
        el.innerHTML = "";
        return;
      }
      el.innerHTML =
        `<div class="side-head"><span>${LZ.esc(t("ph.devices"))}</span></div>` +
        phones
          .map((p) => {
            const symbol = symbolOf(p);
            const count = p.state === "reading" ? `${p.percent}%` : "";
            return `<button class="side-item${p.readable ? "" : " dim"}" data-uri="${LZ.esc(p.uri)}" title="${LZ.esc(`${p.name}: ${status(p)}`)}"><span class="ico" data-ico="${symbol}">${icon(symbol)}</span><span class="label">${LZ.esc(p.name)}</span><span class="side-count">${count}</span></button>`;
          })
          .join("");
      Sidebar.mark();
    },
  });
  // Under the disks, where Finder lists the devices it sees.
  $("sideLocations").after(section.el);
  LZ.on("settings.changed", section.refresh);

  // Every pane showing a place on the device `key`, with each tab of it.
  function each(key, fn) {
    for (const pane of Panes.all()) pane.tabs.forEach((tab, i) => onDevice(tab.uri) && authorityOf(tab.uri) === key && fn(pane, tab, i));
  }

  function set(list) {
    const before = new Map(phones.map((p) => [p.key, p]));
    phones = Array.isArray(list) ? list : [];
    section.refresh();
    const now = new Map(phones.map((p) => [p.key, p]));
    for (const [key, was] of before) {
      const p = now.get(key);
      if (!p) {
        // Unplugged: its tabs go home.
        each(key, (pane, tab, i) => {
          if (i === pane.active) pane.navigate(S.places.home, { history: false });
          else {
            tab.uri = S.places.home;
            tab.requested = false;
          }
        });
        continue;
      }
      // Found by Image Capture, unlocked, or stopped: what its panes said may be out of date.
      const moved = p.readable !== was.readable || (p.state !== was.state && ["locked", "failed", "ready"].some((s) => s === p.state || s === was.state));
      if (moved) each(key, (pane, tab, i) => i === pane.active && pane.refresh());
      if (p.name !== was.name) each(key, (pane, tab, i) => i === pane.active && pane.renderPath());
    }
    Panes.saveSoon();
  }

  LZ.on("devices.phones", set);
  // The files of a device changed or were all read; its panes list again, once for a burst of changes.
  const pending = new Map();
  LZ.on("devices.files", (d) => {
    clearTimeout(pending.get(d.key));
    pending.set(
      d.key,
      setTimeout(() => {
        pending.delete(d.key);
        each(d.key, (pane, tab, i) => i === pane.active && pane.refresh());
      }, 400),
    );
  });
  LZ.on("app.hello", () => LZ.call("devices.phones").then(set).catch(() => {}));

  return { list: () => phones, symbolOf };
})();
