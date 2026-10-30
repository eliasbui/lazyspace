// The toolbar: back and forward with the folder's name, the view, new folder and Trash, and the filter of the focused
// pane. It follows the focused pane, and the window's title is the names of the panes' folders.
const Toolbar = (() => {
  // Each button keeps the name of its icon, which the overflow menu shows beside it.
  const set = (id, name) => {
    $(id).insertAdjacentHTML("afterbegin", icon(name));
    $(id).dataset.sym = name;
  };
  set("tbBack", "chevron.left");
  set("tbForward", "chevron.right");
  set("tbNewFolder", "folder.plus");
  set("tbTrash", "trash");
  set("tbMore", "chevron.right.2");
  $("tbSearchIcon").innerHTML = icon("search");
  // The four views of Finder, in Finder's order; the action of each is "view" and its name.
  const VIEWS = { icons: ["grid", "viewIcons"], list: ["list", "viewList"], columns: ["columns", "viewColumns"], gallery: ["gallery", "viewGallery"] };
  for (const b of $("tbView").querySelectorAll("[data-view]")) {
    b.dataset.sym = VIEWS[b.dataset.view][0];
    b.insertAdjacentHTML("afterbegin", icon(b.dataset.sym));
  }

  // Too narrow a toolbar folds as NSToolbar does: the title goes first, then the search becomes a button, then the
  // groups of buttons go into the overflow menu one by one, the actions before the view. Each width is worked out
  // from nothing, so the toolbar unfolds as it widens.
  const FOLDS = ["fold-title", "fold-search", "fold-actions", "fold-view", "fold-right"];
  const GROUPS = { "fold-actions": () => $("tbActions"), "fold-view": () => $("tbView"), "fold-right": () => document.querySelector('.toolbar > [data-slot="toolbar.right"]') };
  function fit() {
    const bar = $("toolbar");
    bar.classList.remove(...FOLDS);
    $("tbOverflow").hidden = true;
    for (const fold of FOLDS) {
      if (bar.scrollWidth <= bar.clientWidth) break;
      bar.classList.add(fold);
      if (GROUPS[fold]) $("tbOverflow").hidden = false;
    }
  }
  new ResizeObserver(fit).observe($("toolbar"));
  // Buttons that features add come after this part.
  window.addEventListener("DOMContentLoaded", fit);

  // The SF Symbol of an icon's name, for a native menu.
  const symbolOf = (name) => {
    const value = ICONS[name] || "";
    return value && !value.startsWith("<") ? value.split("/").pop().split(",")[0] : undefined;
  };
  // The folded buttons as a native menu, a line between groups; the one chosen runs as if clicked, its own menu (if it
  // has one) opening under the overflow button.
  $("tbMore").addEventListener("click", async () => {
    const bar = $("toolbar");
    const buttons = [];
    const choices = [];
    for (const fold of FOLDS) {
      if (!GROUPS[fold] || !bar.classList.contains(fold)) continue;
      const group = [...GROUPS[fold]().querySelectorAll(".tb")];
      if (!group.length) continue;
      if (choices.length) choices.push({ separator: true });
      for (const b of group) {
        choices.push({ id: String(buttons.length), label: b.title || b.getAttribute("aria-label") || "", icon: symbolOf(b.dataset.sym), enabled: !b.disabled, checked: b.classList.contains("on") });
        buttons.push(b);
      }
    }
    const r = $("tbMore").getBoundingClientRect();
    const id = await LZ.choose(choices, r.left, r.bottom + 6);
    const b = id == null ? null : buttons[Number(id)];
    if (!b) return;
    if (b.run) b.run(new MouseEvent("click"), $("tbMore"));
    else b.click();
  });

  // A folded search is a button that opens the field over the end of the toolbar.
  function openSearch() {
    if ($("toolbar").classList.contains("fold-search")) $("tbSearch").classList.add("open");
    $("searchInput").focus();
    $("searchInput").select();
  }
  $("tbSearch").addEventListener("mousedown", (e) => {
    if (!$("toolbar").classList.contains("fold-search") || $("tbSearch").classList.contains("open")) return;
    e.preventDefault();
    openSearch();
  });
  $("searchInput").addEventListener("blur", () => {
    if (!$("searchInput").value) $("tbSearch").classList.remove("open");
  });

  let shownTitle = null;
  function update() {
    const pane = Panes.focused();
    const tab = pane?.tab;
    if (!tab) return;
    const title = tab.uri ? placeName(tab.uri) : "LazySpace";
    $("title").textContent = title;
    if (title !== shownTitle) {
      shownTitle = title;
      fit();
    }
    $("tbBack").disabled = !tab.back.length;
    $("tbForward").disabled = !tab.forward.length;
    for (const b of $("tbView").querySelectorAll("[data-view]")) b.classList.toggle("on", b.dataset.view === tab.mode);
    $("tbNewFolder").disabled = !tab.capabilities.write;
    $("tbTrash").disabled = !tab.selCount();
    // Search results show their words in the field.
    const words = schemeOf(tab.uri) === "search" ? new URLSearchParams(authorityOf(tab.uri)).get("q") || "" : "";
    if (document.activeElement !== $("searchInput")) $("searchInput").value = tab.filter || words;
    document.title = Panes.all().map((p) => (p.tab?.uri ? placeName(p.tab.uri) : "")).filter(Boolean).join(" | ") || "LazySpace";
  }

  $("tbBack").addEventListener("click", () => Panes.action("back"));
  $("tbForward").addEventListener("click", () => Panes.action("forward"));
  // Right-clicked, they list where they go, as Finder's do.
  for (const [id, way] of [["tbBack", "back"], ["tbForward", "forward"]]) {
    $(id).addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const r = $(id).getBoundingClientRect();
      if (Panes.focused()) Panes.stackMenu(Panes.focused(), way, r.left, r.bottom + 6);
    });
  }
  $("tbNewFolder").addEventListener("click", () => Panes.action("newFolder"));
  $("tbTrash").addEventListener("click", () => Panes.action("trash"));
  $("tbView").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) Panes.action(VIEWS[b.dataset.view][1]);
  });

  // The filter narrows the focused pane to the items whose name holds what is typed.
  let filterTimer;
  $("searchInput").addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      const pane = Panes.focused();
      const tab = pane?.tab;
      if (!tab?.generation) return;
      // Search results are searched again with Enter (19-search.js): filtered as typed, they would lose the matches
      // found without their accents.
      if (schemeOf(tab.uri) === "search") return;
      tab.filter = $("searchInput").value;
      call("view.filter", { view: tab.id, text: tab.filter })
        .then((d) => pane.tab === tab && pane.regenerate(d.generation, d.count, d.groups))
        .catch(say);
    }, 120);
  });
  $("searchInput").addEventListener("keydown", (e) => {
    // The offers of a search under the field take their keys first (19-search.js).
    if (typeof Search !== "undefined" && Search.keydown(e)) return;
    if (e.key === "Escape") {
      $("searchInput").value = "";
      $("searchInput").dispatchEvent(new Event("input"));
      $("tbSearch").classList.remove("open");
      Panes.focused()?.list.focus();
    } else if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      Panes.focused()?.list.focus();
      Panes.focused()?.move(1, false);
    }
  });

  // What the menu bar asks for, by the ids of src/menus.rs.
  const MENU = {
    "file.new_tab": "newTab",
    "file.new_folder": "newFolder",
    "file.eject": "eject",
    "file.close_tab": "closeTab",
    "view.list": "viewList",
    "view.icons": "viewIcons",
    "view.columns": "viewColumns",
    "view.gallery": "viewGallery",
    "view.hidden": "toggleHidden",
    "go.back": "back",
    "go.forward": "forward",
    "go.enclosing": "enclosing",
    "go.home": "home",
    "go.desktop": "desktop",
    "go.downloads": "downloads",
    "go.applications": "applications",
  };
  on("menu.action", (d) => {
    if (MENU[d.id]) Panes.action(MENU[d.id]);
  });
  Panes.on("selection", update);

  return { update, fit, openSearch };
})();
