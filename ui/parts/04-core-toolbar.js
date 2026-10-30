// The toolbar: back and forward with the folder's name, the view, new folder and Trash, and the filter of the focused
// pane. It follows the focused pane, and the window's title is the names of the panes' folders.
const Toolbar = (() => {
  const set = (id, name) => $(id).insertAdjacentHTML("afterbegin", icon(name));
  set("tbBack", "chevron.left");
  set("tbForward", "chevron.right");
  set("tbNewFolder", "folder.plus");
  set("tbTrash", "trash");
  $("tbSearchIcon").innerHTML = icon("search");
  for (const b of $("tbView").querySelectorAll("[data-view]")) b.insertAdjacentHTML("afterbegin", icon(b.dataset.view === "list" ? "list" : "grid"));

  function update() {
    const pane = Panes.focused();
    const tab = pane?.tab;
    if (!tab) return;
    $("title").textContent = tab.uri ? placeName(tab.uri) : "LazySpace";
    $("tbBack").disabled = !tab.back.length;
    $("tbForward").disabled = !tab.forward.length;
    for (const b of $("tbView").querySelectorAll("[data-view]")) b.classList.toggle("on", b.dataset.view === tab.mode);
    $("tbNewFolder").disabled = !tab.capabilities.write;
    $("tbTrash").disabled = !tab.selCount();
    if (document.activeElement !== $("searchInput")) $("searchInput").value = tab.filter || "";
    document.title = Panes.all().map((p) => (p.tab?.uri ? placeName(p.tab.uri) : "")).filter(Boolean).join(" | ") || "LazySpace";
  }

  $("tbBack").addEventListener("click", () => Panes.action("back"));
  $("tbForward").addEventListener("click", () => Panes.action("forward"));
  $("tbNewFolder").addEventListener("click", () => Panes.action("newFolder"));
  $("tbTrash").addEventListener("click", () => Panes.action("trash"));
  $("tbView").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) Panes.action(b.dataset.view === "list" ? "viewList" : "viewIcons");
  });

  // The filter narrows the focused pane to the items whose name holds what is typed.
  let filterTimer;
  $("searchInput").addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      const pane = Panes.focused();
      const tab = pane?.tab;
      if (!tab?.generation) return;
      tab.filter = $("searchInput").value;
      call("view.filter", { view: tab.id, text: tab.filter })
        .then((d) => pane.tab === tab && pane.regenerate(d.generation, d.count))
        .catch(say);
    }, 120);
  });
  $("searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $("searchInput").value = "";
      $("searchInput").dispatchEvent(new Event("input"));
      Panes.focused()?.list.focus();
    } else if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      Panes.focused()?.list.focus();
      Panes.focused()?.move(1, false);
    }
  });

  // What the menu bar asks for, by the ids of src/menus.rs.
  const MENU = {
    "file.new_folder": "newFolder",
    "file.close_tab": "closeTab",
    "view.list": "viewList",
    "view.icons": "viewIcons",
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

  return { update };
})();
