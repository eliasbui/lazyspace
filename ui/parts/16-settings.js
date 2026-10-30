// Settings in pages, as System Settings has them: each group title of the sheet (the core's and those parts add with
// LZ.settings.section) starts a page, listed on the left with an icon on a coloured tile; the search on top of the
// list shows the settings whose words hold what is typed, from every page at once.
LZ.words({
  vi: { searchSettings: "Tìm cài đặt", noSettingMatch: "Không có cài đặt nào khớp" },
  en: { searchSettings: "Search", noSettingMatch: "No setting matches" },
});
LZ.icons.add({
  "set.general": "gearshape.fill",
  "set.appearance": "circle.lefthalf.filled",
  "set.colours": "paintpalette.fill",
  "set.keyboard": "keyboard.fill",
  "set.menu": "contextualmenu.and.cursorarrow",
  "set.finder": "folder.fill",
  "set.desktop": "menubar.dock.rectangle,desktopcomputer",
  "set.about": "info.circle.fill",
  "set.other": "puzzlepiece.extension.fill",
  "set.search": "magnifyingglass",
  "set.actions": "terminal.fill",
});

const SettingsNav = (() => {
  // The icon and the tile colour of each page, by the word of its title; a page a new part adds gets the last one.
  const LOOK = {
    general: ["set.general", "#8e8e93"],
    appearance: ["set.appearance", "#636366"],
    colorsIcons: ["set.colours", "#ff9500"],
    keyboard: ["set.keyboard", "#8e8e93"],
    contextMenu: ["set.menu", "#007aff"],
    finderTitle: ["set.finder", "#0a84ff"],
    searchTitle: ["set.search", "#8e8e93"],
    actionsTitle: ["set.actions", "#34c759"],
    desktop: ["set.desktop", "#30b0c7"],
    about: ["set.about", "#8e8e93"],
  };
  const OTHER = ["set.other", "#5856d6"];
  const body = $("settingsBody");
  const nav = $("settingsNav");
  const search = $("settingsSearch");
  $("settingsSearchIcon").innerHTML = icon("search");
  let pages = [];
  let current = "general";

  // Accents and case aside, as the command palette compares words.
  const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

  // The pages from the titles and groups of the sheet, in the order they stand: each title, then the groups after it.
  function build() {
    pages = [];
    for (const el of body.querySelectorAll(".group-title, .group")) {
      if (el.classList.contains("group-title")) pages.push({ key: el.dataset.t || el.textContent, els: [el] });
      else if (pages.length) pages[pages.length - 1].els.push(el);
    }
    for (const page of pages) for (const el of page.els) el.dataset.page = page.key;
    nav.innerHTML = pages
      .map(({ key }) => {
        const [name, colour] = LOOK[key] || OTHER;
        return `<button class="set-item" data-page="${esc(key)}"><span class="set-tile" style="background:${colour}">${icon(name)}</span><span data-t="${esc(key)}"></span></button>`;
      })
      .join("");
    if (!pages.some((p) => p.key === current)) current = pages[0]?.key || "";
    applyLang();
  }

  function show(key) {
    current = key;
    search.value = "";
    filter();
  }

  // One page, or with words in the search, every setting that holds them under the title of its page.
  function filter() {
    const words = fold(search.value.trim());
    body.classList.toggle("searching", !!words);
    let any = false;
    for (const page of pages) {
      let shown = false;
      for (const el of page.els.slice(1)) {
        let groupShown = false;
        for (const item of el.querySelectorAll(".item")) {
          const hit = !words || fold(item.textContent).includes(words) || fold(t(page.key)).includes(words);
          item.hidden = !hit;
          groupShown ||= hit;
        }
        // A group without items (a part's own layout) goes with its page.
        if (!el.querySelector(".item")) groupShown = !words;
        el.hidden = words ? !groupShown : page.key !== current;
        shown ||= !el.hidden;
      }
      page.els[0].hidden = words ? !shown : page.key !== current;
      any ||= shown;
    }
    $("settingsNone").hidden = any;
    $("settingsTitle").dataset.t = words ? "settings" : current;
    for (const b of nav.children) b.classList.toggle("on", !words && b.dataset.page === current);
    applyLang();
    body.scrollTop = 0;
  }

  nav.addEventListener("click", (e) => {
    const b = e.target.closest("[data-page]");
    if (b) show(b.dataset.page);
  });
  search.addEventListener("input", filter);
  search.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape" && search.value) {
      e.preventDefault();
      show(current);
    }
  });
  // Up and down move between pages while the list has the focus, as in a sidebar.
  nav.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = pages.findIndex((p) => p.key === current) + (e.key === "ArrowDown" ? 1 : -1);
    if (pages[i]) {
      show(pages[i].key);
      nav.querySelector(`[data-page="${CSS.escape(pages[i].key)}"]`)?.focus();
    }
  });

  // Built again each time the sheet opens, from the menu, the palette or a part, so a section a part added late has its
  // page; a search left from before is cleared.
  const sheet = $("settingsSheet");
  let wasOpen = false;
  new MutationObserver(() => {
    const open = sheet.classList.contains("open");
    if (open && !wasOpen) {
      build();
      show(current);
    }
    wasOpen = open;
  }).observe(sheet, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("DOMContentLoaded", () => build());
  // Opens the settings at a page, by the word of its title.
  return {
    open(page) {
      if (page) current = page;
      if (sheet.classList.contains("open")) show(current);
      else openSheet("settingsSheet");
    },
  };
})();
