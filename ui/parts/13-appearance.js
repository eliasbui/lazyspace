// The look of the app beyond light and dark: the accent colour, the font of the app's text, the sidebar's icons in grey
// or in colour, the size of icons in the icon view (Cmd+= and Cmd+- too), and the size of the text of lists. Each is a setting, put on the
// root of the page, where the styles of 13-appearance.css read it.
LZ.words({
  vi: {
    colorsIcons: "Màu sắc, chữ và biểu tượng", font: "Phông chữ", fontHint: "Phông của toàn bộ cửa sổ, menu trong trang và bảng.",
    fontSystem: "Hệ thống (SF Pro)", fontRounded: "SF Pro Rounded", fontSerif: "New York", fontMono: "SF Mono", fontsMac: "Đã cài trên máy", fontsApple: "Của Apple",
    accentColor: "Màu nhấn", accentHint: "Màu của mục được chọn, nút bấm và viền tiêu điểm.",
    sidebarIcons: "Biểu tượng thanh bên", sidebarIconsHint: "Xám như Finder, hoặc mỗi nơi một màu.", iconsMono: "Đơn sắc", iconsColor: "Có màu",
    iconSize: "Cỡ biểu tượng", iconSizeHint: "Ở chế độ lưới. Cmd+= và Cmd+- để đổi nhanh.", textSize: "Cỡ chữ danh sách", textSizeHint: "Chữ và chiều cao dòng ở chế độ danh sách.",
    sizeSmall: "Nhỏ", sizeMedium: "Vừa", sizeLarge: "Lớn", sizeHuge: "Rất lớn",
    "accent.system": "Theo hệ thống", "accent.blue": "Xanh dương", "accent.purple": "Tím", "accent.pink": "Hồng", "accent.red": "Đỏ", "accent.orange": "Cam",
    "accent.yellow": "Vàng", "accent.green": "Xanh lá", "accent.graphite": "Than chì",
  },
  en: {
    colorsIcons: "Colours, Text and Icons", font: "Font", fontHint: "The font of the whole window, its menus and its sheets.",
    fontSystem: "System (SF Pro)", fontRounded: "SF Pro Rounded", fontSerif: "New York", fontMono: "SF Mono", fontsMac: "Installed on this Mac", fontsApple: "Apple's",
    accentColor: "Accent colour", accentHint: "The colour of selected items, buttons and focus rings.",
    sidebarIcons: "Sidebar icons", sidebarIconsHint: "Grey as in Finder, or a colour for each place.", iconsMono: "Grey", iconsColor: "Colour",
    iconSize: "Icon size", iconSizeHint: "In the icon view. Cmd+= and Cmd+- change it quickly.", textSize: "List text size", textSizeHint: "The text and the row height of the list view.",
    sizeSmall: "Small", sizeMedium: "Medium", sizeLarge: "Large", sizeHuge: "Huge",
    "accent.system": "System", "accent.blue": "Blue", "accent.purple": "Purple", "accent.pink": "Pink", "accent.red": "Red", "accent.orange": "Orange",
    "accent.yellow": "Yellow", "accent.green": "Green", "accent.graphite": "Graphite",
  },
});

(() => {
  const ACCENTS = { system: "", blue: "#007aff", purple: "#a550a7", pink: "#f74f9e", red: "#e0383e", orange: "#f7821b", yellow: "#e8a500", green: "#62ba46", graphite: "#8c8c8c" };
  const SIZES = [
    [48, "sizeSmall"],
    [64, "sizeMedium"],
    [96, "sizeLarge"],
    [128, "sizeHuge"],
  ];
  // The system's own designs, which CSS names by keyword, then the families installed on the Mac (native.fonts).
  const DESIGNS = [
    ["", "fontSystem"],
    ["ui-rounded", "fontRounded"],
    ["ui-serif", "fontSerif"],
    ["ui-monospace", "fontMono"],
  ];
  const fontValue = (font) => (!font ? "" : font.startsWith("ui-") ? `${font}, ` : `"${font}", `) + "-apple-system, BlinkMacSystemFont, system-ui, sans-serif";
  const seg = (attr, value, word) => `<button type="button" class="seg" data-${attr}="${value}" data-t="${word}"></button>`;
  const group = LZ.settings.section({
    id: "appearance",
    title: "colorsIcons",
    build(el) {
      el.innerHTML = `
        <div class="item"><div class="label"><span data-t="accentColor"></span><small data-t="accentHint"></small></div>
          <div class="control"><div class="swatches">${Object.entries(ACCENTS)
            .map(([name, color]) => `<button type="button" class="swatch" data-accent="${name}" data-tt="accent.${name}" style="${color ? `background:${color};` : ""}--swatch:${color || "#8e8e93"}"></button>`)
            .join("")}</div></div></div>
        <div class="item"><div class="label"><span data-t="font"></span><small data-t="fontHint"></small></div>
          <div class="control"><select class="font-choice"><optgroup data-label="fontsApple">${DESIGNS.map(([value, word]) => `<option value="${value}" data-t="${word}"></option>`).join("")}</optgroup><optgroup class="fonts-mac" data-label="fontsMac"></optgroup></select></div></div>
        <div class="item"><div class="label"><span data-t="sidebarIcons"></span><small data-t="sidebarIconsHint"></small></div>
          <div class="control"><div class="segmented">${seg("sidebar-icons", "mono", "iconsMono")}${seg("sidebar-icons", "color", "iconsColor")}</div></div></div>
        <div class="item"><div class="label"><span data-t="iconSize"></span><small data-t="iconSizeHint"></small></div>
          <div class="control"><div class="segmented">${SIZES.map(([size, word]) => seg("icon-size", size, word)).join("")}</div></div></div>
        <div class="item"><div class="label"><span data-t="textSize"></span><small data-t="textSizeHint"></small></div>
          <div class="control"><div class="segmented">${seg("text-size", "small", "sizeSmall")}${seg("text-size", "medium", "sizeMedium")}${seg("text-size", "large", "sizeLarge")}</div></div></div>`;
    },
  });

  // The group goes right under Appearance, the group of light and dark it goes with.
  document.querySelector('#settingsSheet .group-title[data-t="appearance"]')?.nextElementSibling?.after(group.previousElementSibling, group);

  // Puts the look of the settings on the page, and draws the panes again when a size changed.
  function apply(s) {
    const root = document.documentElement;
    const before = `${root.dataset.iconSize}|${root.dataset.textSize}`;
    root.dataset.accent = s.accent || "system";
    root.dataset.sidebarIcons = s.sidebar_icons || "mono";
    root.dataset.iconSize = String(s.icon_size || 64);
    root.dataset.textSize = s.text_size || "medium";
    if (s.font) root.style.setProperty("--ui-font", fontValue(s.font));
    else root.style.removeProperty("--ui-font");
    showFont(s.font || "");
    for (const b of group.querySelectorAll("[data-accent]")) b.classList.toggle("on", b.dataset.accent === root.dataset.accent);
    for (const b of group.querySelectorAll("[data-sidebar-icons]")) b.classList.toggle("on", b.dataset.sidebarIcons === root.dataset.sidebarIcons);
    for (const b of group.querySelectorAll("[data-icon-size]")) b.classList.toggle("on", b.dataset.iconSize === root.dataset.iconSize);
    for (const b of group.querySelectorAll("[data-text-size]")) b.classList.toggle("on", b.dataset.textSize === root.dataset.textSize);
    setMetrics(s);
    if (before !== `${root.dataset.iconSize}|${root.dataset.textSize}`) for (const pane of Panes.all()) pane.renderAll();
  }

  // The installed families are asked for once, the first time Settings shows them; the chosen one is kept in the list
  // even before then, or when it was removed from the Mac.
  const choice = group.querySelector(".font-choice");
  const mac = group.querySelector(".fonts-mac");
  let families = null;
  function showFont(font) {
    if (font && !choice.querySelector(`option[value="${CSS.escape(font)}"]`)) mac.insertAdjacentHTML("afterbegin", `<option value="${LZ.esc(font)}">${LZ.esc(font)}</option>`);
    choice.value = font;
  }
  function loadFamilies() {
    if (families) return;
    families = LZ.call("native.fonts")
      .then((list) => {
        const kept = choice.value;
        mac.innerHTML = list.map((f) => `<option value="${LZ.esc(f)}">${LZ.esc(f)}</option>`).join("");
        showFont(kept);
      })
      .catch(() => (families = null));
  }
  new MutationObserver(() => $("settingsSheet").classList.contains("open") && loadFamilies()).observe($("settingsSheet"), { attributes: true, attributeFilter: ["class"] });
  choice.addEventListener("change", () => setSetting({ font: choice.value }));
  // Optgroup labels are attributes, which data-t does not reach.
  const labelGroups = () => {
    for (const g of group.querySelectorAll("optgroup[data-label]")) g.label = t(g.dataset.label);
  };
  labelGroups();
  LZ.on("settings.changed", labelGroups);

  group.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.accent) setSetting({ accent: b.dataset.accent });
    else if (b.dataset.sidebarIcons) setSetting({ sidebar_icons: b.dataset.sidebarIcons });
    else if (b.dataset.iconSize) setSetting({ icon_size: Number(b.dataset.iconSize) });
    else if (b.dataset.textSize) setSetting({ text_size: b.dataset.textSize });
  });

  // Bigger and smaller icons from the keyboard, as in Finder.
  const step = (by) => {
    const sizes = SIZES.map(([size]) => size);
    const at = sizes.indexOf(S.settings.icon_size || 64);
    const next = sizes[Math.min(sizes.length - 1, Math.max(0, at + by))];
    if (next !== S.settings.icon_size) setSetting({ icon_size: next });
  };
  Panes.actions.iconsBigger = () => step(1);
  Panes.actions.iconsSmaller = () => step(-1);
  Keys.add({ "Cmd+=": "iconsBigger", "Cmd+-": "iconsSmaller" });

  LZ.on("settings.changed", apply);
  LZ.on("app.hello", (d) => apply(d.settings));
})();
