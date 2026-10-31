// What features build on (design.md section 6.4): the context menu as a registry of items shown as a native menu,
// toolbar buttons, sidebar sections, settings sections, ways to open a kind of item, and the pane layouts, drag and
// drop and Quick Look of the core.
words({
  vi: {
    layout: "Bố cục", "layout.single": "Một khung", "layout.h2": "Hai khung cạnh nhau", "layout.v2": "Hai khung trên dưới",
    "layout.h3": "Ba khung cạnh nhau", "layout.l1r2": "Một trái, hai phải", "layout.grid": "Bốn khung (lưới 2x2)",
  },
  en: {
    layout: "Layout", "layout.single": "One Pane", "layout.h2": "Two Panes Side by Side", "layout.v2": "Two Panes Stacked",
    "layout.h3": "Three Panes Side by Side", "layout.l1r2": "One Left, Two Right", "layout.grid": "Four Panes (2x2 Grid)",
  },
});

const LAYOUTS = { single: 1, h2: 2, v2: 2, h3: 3, l1r2: 3, grid: 4 };

const LZ = (() => {
  const items = [];
  const openers = [];
  let menuCtx = null;
  let menuItems = new Map();

  // The keymap's chord for an action, to show beside a menu item.
  function shortcutOf(action) {
    if (!action) return undefined;
    const map = Keys.map();
    return Object.keys(map).find((chord) => map[chord] === action);
  }

  // The items that fit `ctx`, in their groups, as the tree src/contextmenu.rs takes; each item is kept by id for the
  // answer.
  function nodes(list, ctx) {
    const fits = list.filter((item) => !item.when || item.when(ctx)).sort((a, b) => (a.group ?? 50) - (b.group ?? 50) || (a.order ?? 50) - (b.order ?? 50));
    const out = [];
    let group = null;
    for (const item of fits) {
      if (group !== null && item.group !== group) out.push({ separator: true });
      group = item.group;
      menuItems.set(item.id, item);
      const sub = typeof item.submenu === "function" ? item.submenu(ctx) : item.submenu;
      out.push({
        id: item.id,
        label: typeof item.label === "function" ? item.label(ctx) : t(item.label),
        icon: item.icon,
        enabled: item.enabled ? !!item.enabled(ctx) : true,
        checked: item.checked ? !!item.checked(ctx) : false,
        shortcut: shortcutOf(item.action),
        submenu: sub ? nodes(sub, ctx) : [],
      });
    }
    return out;
  }

  const menu = {
    // An item of the context menu: { id, label, icon (an SF Symbol), group, order, when(ctx), run(ctx), action (the
    // keymap action whose chord is shown), checked(ctx), enabled(ctx), submenu }.
    add(item) {
      const at = items.findIndex((i) => i.id === item.id);
      if (at >= 0) items.splice(at, 1);
      items.push(item);
    },
    // Every top-level item, in the order of the groups, for the menu editor.
    list() {
      return [...items].sort((a, b) => (a.group ?? 50) - (b.group ?? 50) || (a.order ?? 50) - (b.order ?? 50)).map((i) => ({ id: i.id, label: t(typeof i.label === "string" ? i.label : i.id), icon: i.icon, group: i.group ?? 50 }));
    },
    // Shows the menu for `ctx` at the point of `event` (or `x`, `y`).
    show(ctx, x, y) {
      menuItems = new Map();
      const tree = nodes(items, ctx);
      if (!tree.length) return;
      menuCtx = ctx;
      const uris = (ctx.entries || []).map((e) => e.uri);
      call("menu.show", { items: tree, x, y, uris }).catch(say);
    },
  };
  on("menu.chosen", (d) => {
    const item = menuItems.get(d.id);
    if (item?.run && menuCtx) item.run(menuCtx);
    menuCtx = null;
  });
  on("menu.closed", () => (menuCtx = null));

  // A small native menu of choices (the layout button, a sort): `choices` are { id, label, icon, checked }.
  function choose(choices, x, y) {
    return new Promise((resolve) => {
      const done = (id) => {
        off();
        resolve(id);
      };
      const chosen = (d) => done(d.id);
      const closed = () => done(null);
      const off = () => {
        handlers["menu.chosen"] = (handlers["menu.chosen"] || []).filter((f) => f !== chosen);
        handlers["menu.closed"] = (handlers["menu.closed"] || []).filter((f) => f !== closed);
      };
      on("menu.chosen", chosen);
      on("menu.closed", closed);
      const items = choices.map((c) => (c.separator ? { separator: true } : { id: c.id, label: c.label, icon: c.icon, checked: !!c.checked, enabled: c.enabled !== false }));
      call("menu.show", { items, x, y }).catch(() => done(null));
    });
  }

  const toolbar = {
    // A button in the toolbar: { id, side: "left" | "right", icon, label, run }. Returns the button.
    add({ id, side = "right", icon: iconName, label, run }) {
      const slot = document.querySelector(`[data-slot="toolbar.${side}"]`);
      const b = document.createElement("button");
      b.className = "tb";
      b.id = `tb-${id}`;
      b.dataset.tt = label;
      b.dataset.sym = iconName;
      b.innerHTML = icon(iconName);
      // The overflow menu of a folded toolbar runs it from its own button (04-core-toolbar.js).
      b.run = run;
      b.addEventListener("click", (e) => run(e, b));
      slot.appendChild(b);
      applyLang();
      return b;
    },
  };

  const sidebar = {
    // A section of the sidebar between the bookmarks and the disks: render(el) fills it, and again on refresh().
    section({ id, render }) {
      const el = document.createElement("div");
      el.dataset.section = id;
      document.querySelector('[data-slot="sidebar.sections"]').appendChild(el);
      const refresh = () => render(el);
      refresh();
      return { el, refresh };
    },
  };

  const settings = {
    // A group of Settings: build(el) fills it.
    section({ id, title, build }) {
      const slot = document.querySelector('[data-slot="settings.sections"]');
      const head = document.createElement("div");
      head.className = "group-title";
      head.dataset.t = title;
      const el = document.createElement("div");
      el.className = "group";
      el.dataset.section = id;
      slot.append(head, el);
      build(el);
      applyLang();
      return el;
    },
  };

  const sheet = {
    // A sheet of its own: the panel element, to fill and to open with LZ.sheet.open(id).
    create(id, { small = false, modal = false } = {}) {
      const wrap = document.createElement("div");
      wrap.className = "modal";
      wrap.id = id;
      if (modal) wrap.dataset.modal = "1";
      wrap.innerHTML = `<div class="panel${small ? " small" : ""}" role="dialog"></div>`;
      document.querySelector('[data-slot="sheets"]').appendChild(wrap);
      return wrap.firstElementChild;
    },
    open: (id) => {
      applyLang();
      openSheet(id);
    },
    close: () => closeSheets(),
  };

  const vfs = {
    // A way to open a kind of item that is not a folder (an archive opens as a folder): opener(entry) returns the URI
    // to browse, or null to let the next one, and in the end the system, open it.
    opener(fn) {
      openers.push(fn);
    },
    browse(entry) {
      for (const fn of openers) {
        const uri = fn(entry);
        if (uri) return uri;
      }
      return null;
    },
  };

  // A question with a typed answer, as a sheet: resolves the text, or null when cancelled. `secret` hides what is
  // typed (a password). The page has no prompt() of its own in the app's web view.
  const promptPanel = sheet.create("promptSheet", { small: true, modal: true });
  promptPanel.innerHTML = `<h2></h2><p></p><input class="prompt-input" spellcheck="false"><div class="buttons"><button class="push" data-a="no"></button><button class="push primary" data-a="yes"></button></div>`;
  function prompt(title, { text = "", value = "", secret = false, ok = t("ok") } = {}) {
    return new Promise((resolve) => {
      const input = promptPanel.querySelector("input");
      promptPanel.querySelector("h2").textContent = title;
      promptPanel.querySelector("p").textContent = text;
      promptPanel.querySelector('[data-a="no"]').textContent = t("cancel");
      promptPanel.querySelector('[data-a="yes"]').textContent = ok;
      input.type = secret ? "password" : "text";
      input.value = value;
      openSheet("promptSheet");
      setTimeout(() => {
        input.focus();
        input.select();
      }, 30);
      const done = (answer) => {
        promptPanel.onclick = input.onkeydown = null;
        closeSheets();
        resolve(answer);
      };
      promptPanel.onclick = (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        if (a) done(a === "yes" ? input.value : null);
      };
      input.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Enter") done(input.value);
        if (e.key === "Escape") done(null);
      };
    });
  }

  return { menu, choose, prompt, toolbar, sidebar, settings, sheet, vfs, words, icons, on, call, t, esc, toast, say, confirm: confirmSheet };
})();

// The layout button: a native menu of the layouts, the current one checked.
(() => {
  const b = LZ.toolbar.add({
    id: "layout",
    side: "left",
    icon: "layout.single",
    label: "layout",
    run: async (_, button) => {
      const r = button.getBoundingClientRect();
      const now = $("paneGrid").dataset.layout;
      const id = await LZ.choose(
        Object.keys(LAYOUTS).map((l) => ({ id: l, label: t(`layout.${l}`), icon: { single: "rectangle", h2: "rectangle.split.2x1", v2: "rectangle.split.1x2", h3: "rectangle.split.3x1", l1r2: "rectangle.righthalf.inset.filled", grid: "rectangle.split.2x2" }[l], checked: l === now })),
        r.left,
        r.bottom + 6,
      );
      if (id) Panes.setLayout(id);
    },
  });
  // The toolbar slot of the layout button sits before the actions.
  document.querySelector('[data-slot="toolbar.layout"]').appendChild(b);
  Panes.layoutButton = b;
})();

// Dragging out: a press on a selected item readies a native drag of the selection; dropping in: files dragged over a
// window light up the folder under the pointer and are copied or moved there.
(() => {
  Panes.on("pointerdown", ({ pane, event, index }) => {
    if (event.button !== 0 || event.shiftKey || event.metaKey) return;
    const tab = pane.tab;
    const e = tab.rows.get(index);
    if (!e || !tab.isSel(e.name) || !isLocal(e.uri)) return;
    call("drag.arm", tab.selection()).catch(() => {});
  });
  let lit = null;
  const light = (el) => {
    if (lit === el) return;
    lit?.classList.remove("drop");
    lit = el;
    lit?.classList.add("drop");
  };
  // The folder under the point: a folder row, else the folder of the pane, a tab, or a place of the sidebar.
  function targetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const side = el.closest(".side-item[data-uri]");
    if (side) return { el: side, uri: side.dataset.uri };
    const paneEl = el.closest(".pane");
    const pane = paneEl && Panes.all().find((p) => p.el === paneEl);
    if (!pane) return null;
    const tabEl = el.closest(".tab");
    if (tabEl) {
      const tab = pane.tabs[Number(tabEl.dataset.i)];
      return tab ? { el: tabEl, uri: tab.uri } : null;
    }
    const rowEl = el.closest("[data-index]");
    const entry = rowEl && pane.tab.rows.get(Number(rowEl.dataset.index));
    if (entry?.isDir) return { el: rowEl, uri: entry.uri };
    return pane.tab.capabilities.write ? { el: pane.list, uri: pane.tab.uri } : null;
  }
  on("drop.over", (d) => light(targetAt(d.x, d.y)?.el || null));
  on("drop.leave", () => light(null));
  on("drop", (d) => {
    const target = targetAt(d.x, d.y);
    light(null);
    if (!target) return;
    // A feature may take a drop itself: the desktop moves its own icons where they are dropped.
    if (Panes.onDrop?.(d, target)) return;
    call("fs.copy", { from: d.uris, to: target.uri, mode: d.mode }).catch(say);
  });

  // Items not on this Mac (in a cloud through rclone, on a server, in an archive) have no file a drag of the system
  // could carry; within the window the page drags them itself, onto the same targets: a pane, a folder, a tab, a
  // place of the sidebar. As with a drop of files, Option copies, Command moves, and otherwise a move stays on one
  // disk and anything else is copied.
  Panes.on("pointerdown", ({ pane, event, index }) => {
    if (event.button !== 0 || event.shiftKey || event.metaKey) return;
    const tab = pane.tab;
    const e = tab.rows.get(index);
    if (!e || !tab.isSel(e.name) || isLocal(e.uri)) return;
    const from = tab.selectedEntries().map((x) => x.uri);
    const source = tab.uri;
    let ghost = null;
    const fits = (target) => target && !samePlace(target.uri, source) && !from.some((u) => samePlace(u, target.uri));
    const move = (m) => {
      if (!ghost && Math.hypot(m.clientX - event.clientX, m.clientY - event.clientY) < 4) return;
      if (!ghost) {
        ghost = document.createElement("div");
        ghost.textContent = from.length > 1 ? `${e.name} +${from.length - 1}` : e.name;
        ghost.style.cssText =
          "position:fixed;z-index:1000;pointer-events:none;max-width:240px;padding:3px 8px;border-radius:6px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:var(--accent);color:#fff;opacity:0.9";
        document.body.appendChild(ghost);
      }
      ghost.style.left = `${m.clientX + 12}px`;
      ghost.style.top = `${m.clientY + 8}px`;
      const target = targetAt(m.clientX, m.clientY);
      light(fits(target) ? target.el : null);
    };
    const end = (u) => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", end);
      removeEventListener("keydown", escape, true);
      light(null);
      if (!ghost) return;
      ghost.remove();
      if (u.type !== "mouseup") return;
      const target = targetAt(u.clientX, u.clientY);
      if (!fits(target)) return;
      const mode = u.altKey ? "copy" : u.metaKey ? "move" : "auto";
      call("fs.copy", { from, to: target.uri, mode }).catch(say);
    };
    const escape = (k) => {
      if (k.key !== "Escape" || !ghost) return;
      k.stopPropagation();
      end(k);
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", end);
    addEventListener("keydown", escape, true);
  });
})();
