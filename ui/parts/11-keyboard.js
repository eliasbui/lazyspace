// The keys of Windows (W1): a switch in Settings between the keys of a Mac and those of Windows Explorer, for someone
// coming from Windows (Ctrl+C, Ctrl+X, Ctrl+V copy, cut and paste files; Enter opens; F2 renames; Delete trashes).
LZ.words({
  vi: {
    keyboard: "Bàn phím", keyStyle: "Kiểu phím tắt", keyStyleHint: "Kiểu Windows: Ctrl+C/X/V để chép, cắt, dán tệp; Enter để mở; F2 để đổi tên; Delete để chuyển vào Thùng rác; Backspace để lên thư mục cha.",
    keysMac: "macOS", keysWindows: "Windows",
  },
  en: {
    keyboard: "Keyboard", keyStyle: "Shortcut style", keyStyleHint: "Windows style: Ctrl+C/X/V copy, cut and paste files; Enter opens; F2 renames; Delete moves to the Trash; Backspace goes to the enclosing folder.",
    keysMac: "macOS", keysWindows: "Windows",
  },
});

(() => {
  const group = LZ.settings.section({
    id: "keyboard",
    title: "keyboard",
    build(el) {
      el.innerHTML = `<div class="item"><div class="label"><span data-t="keyStyle"></span><small data-t="keyStyleHint"></small></div>
        <div class="control"><div class="segmented" id="keyStyle"><button type="button" class="seg" data-keys="mac" data-t="keysMac"></button><button type="button" class="seg" data-keys="windows" data-t="keysWindows"></button></div></div></div>`;
    },
  });
  const paint = () => {
    for (const seg of group.querySelectorAll("[data-keys]")) seg.classList.toggle("on", seg.dataset.keys === (S.settings.keymap || "mac"));
  };
  group.addEventListener("click", (e) => {
    const seg = e.target.closest("[data-keys]");
    if (seg) setSetting({ keymap: seg.dataset.keys });
  });
  LZ.on("settings.changed", paint);
  LZ.on("app.hello", paint);
})();
