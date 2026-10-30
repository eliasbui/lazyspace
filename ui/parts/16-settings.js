// Settings in pages, as System Settings has them: each group title of the sheet (the core's and those parts add with
// LZ.settings.section) starts a page, listed on the left with an icon on a coloured tile; the search on top of the
// list shows the settings whose words hold what is typed, from every page at once.
LZ.words({
  vi: { searchSettings: "Tìm cài đặt", noSettingMatch: "Không có cài đặt nào khớp" },
  en: { searchSettings: "Search", noSettingMatch: "No setting matches" },
});
LZ.icons.add({
  "set.general": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 7h8M17 7h2M5 12h2M11 12h8M5 17h10M19 17h0"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/></svg>',
  "set.appearance": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="7.5"/><path d="M12 4.5v15a7.5 7.5 0 000-15z" fill="currentColor"/></svg>',
  "set.colours": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 4.5a7.5 7.5 0 100 15c1.2 0 1.6-.9 1.2-1.8-.5-1-.1-2.2 1.2-2.2H17a2.5 2.5 0 002.5-2.5c0-4.7-3.4-8.5-7.5-8.5z"/><circle cx="8.5" cy="11" r="1" fill="currentColor"/><circle cx="11.5" cy="8" r="1" fill="currentColor"/><circle cx="15.5" cy="9.5" r="1" fill="currentColor"/></svg>',
  "set.keyboard": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="6.5" width="17" height="11" rx="2"/><path d="M7 10h0M10 10h0M13 10h0M16 10h0M7 13.5h0M17 13.5h0M10 14h4"/></svg>',
  "set.menu": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="4.5" width="14" height="15" rx="2.5"/><path d="M8.5 9h7M8.5 12h7M8.5 15h4"/></svg>',
  "set.finder": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4.5" width="16" height="15" rx="3"/><path d="M12 4.5c-1.5 3-1.8 6.5-1 9.5H12M8.5 9v1M15.5 9v1M8.5 15.5c2 1.3 5 1.3 7 0"/></svg>',
  "set.desktop": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="11.5" rx="2"/><path d="M9 19.5h6M12 16.5v3"/></svg>',
  "set.about": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h0"/></svg>',
  "set.other": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/></svg>',
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
