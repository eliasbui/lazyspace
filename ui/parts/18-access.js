// Full Disk Access, asked for once. Without it macOS asks, folder by folder, whether LazySpace may read the Desktop,
// Documents and Downloads, external and network drives; with it, nothing more is asked, and as every build is signed
// with the same certificate (scripts/make-signing-identity.sh), it holds across updates. macOS never offers it in a
// dialog of its own: the window explains it once and opens the pane in System Settings.
words({
  vi: {
    fullDiskTitle: "Cho phép một lần cho mọi thư mục",
    fullDiskText:
      "macOS đang hỏi quyền từng thư mục một (Màn hình nền, Tài liệu, Tải xuống, ổ ngoài, ổ mạng). Cho LazySpace quyền Truy cập toàn bộ ổ đĩa một lần là hết hỏi, kể cả sau khi cập nhật.\n\nTrong Cài đặt sắp mở: bật LazySpace trong danh sách (chưa có thì bấm + rồi chọn LazySpace trong thư mục Ứng dụng), sau đó mở lại LazySpace.",
    fullDiskOpen: "Mở Cài đặt", fullDiskDone: "LazySpace đã có quyền Truy cập toàn bộ ổ đĩa", fullDiskLater: "Lúc khác",
    fullDiskReopen: "Mở lại LazySpace để quyền mới có hiệu lực",
  },
  en: {
    fullDiskTitle: "Allow once for every folder",
    fullDiskText:
      "macOS asks about each folder in turn (Desktop, Documents, Downloads, external and network drives). Give LazySpace Full Disk Access once and nothing more is asked, after updates too.\n\nIn the Settings that open: turn LazySpace on in the list (if it is not there, click + and choose LazySpace in Applications), then open LazySpace again.",
    fullDiskOpen: "Open Settings", fullDiskDone: "LazySpace has Full Disk Access", fullDiskLater: "Later",
    fullDiskReopen: "Open LazySpace again for the new access to take effect",
  },
});

const Access = (() => {
  let waiting = false;

  const granted = () =>
    LZ.call("native.full_disk")
      .then((d) => !!d?.granted)
      .catch(() => true);

  // Explains Full Disk Access and opens its pane; asked at the start until it is given or put off.
  async function ask() {
    if (await granted()) return LZ.toast(t("fullDiskDone"));
    if (!(await LZ.confirm(t("fullDiskTitle"), t("fullDiskText"), t("fullDiskOpen")))) return setSetting({ full_disk_later: true });
    await LZ.call("native.open_full_disk").catch(LZ.say);
    waiting = true;
  }

  // Back from System Settings: macOS gives the access to the next launch of the app.
  window.addEventListener("focus", async () => {
    if (!waiting) return;
    waiting = false;
    LZ.toast(t((await granted()) ? "fullDiskDone" : "fullDiskReopen"));
  });

  LZ.on("app.hello", async (d) => {
    if (d.windowRole !== "main" || S.settings.full_disk_later) return;
    // After the window has drawn, so the question comes over a window that is there.
    setTimeout(async () => {
      if (!(await granted())) ask();
    }, 1500);
  });

  Panes.actions.fullDiskAccess = ask;
  return { ask, granted };
})();
