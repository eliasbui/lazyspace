// The keys of the list, as data: a chord ("Cmd+Shift+N") names an action of Panes. The Mac keys are the default; the
// Windows ones (Ctrl+C, Enter opens, F2 renames) follow settings.keymap. A feature adds keys with Keys.add.
const KEYMAPS = {
  mac: {
    Enter: "rename",
    "Cmd+O": "open",
    "Cmd+ArrowDown": "open",
    "Cmd+ArrowUp": "enclosing",
    "Cmd+[": "back",
    "Cmd+]": "forward",
    "Cmd+Backspace": "trash",
    "Cmd+Alt+Backspace": "delete",
    "Cmd+Shift+N": "newFolder",
    "Cmd+A": "selectAll",
    "Cmd+C": "copy",
    "Cmd+X": "cut",
    "Cmd+V": "paste",
    "Cmd+Z": "undo",
    "Cmd+Shift+.": "toggleHidden",
    "Cmd+T": "newTab",
    "Cmd+W": "closeTab",
    "Cmd+L": "editAddress",
    "Cmd+Shift+G": "editAddress",
    "Cmd+F": "find",
    "Cmd+Alt+S": "toggleSidebar",
    "Cmd+Shift+H": "home",
    "Cmd+Shift+D": "desktop",
    "Cmd+Alt+L": "downloads",
    "Cmd+Shift+A": "applications",
    Escape: "deselect",
  },
  windows: {
    Enter: "open",
    F2: "rename",
    Delete: "trash",
    "Shift+Delete": "delete",
    Backspace: "enclosing",
    "Alt+ArrowUp": "enclosing",
    "Alt+ArrowLeft": "back",
    "Alt+ArrowRight": "forward",
    "Ctrl+Shift+N": "newFolder",
    "Ctrl+A": "selectAll",
    "Ctrl+C": "copy",
    "Ctrl+X": "cut",
    "Ctrl+V": "paste",
    "Ctrl+Z": "undo",
    "Ctrl+H": "toggleHidden",
    "Ctrl+T": "newTab",
    "Ctrl+W": "closeTab",
    "Ctrl+L": "editAddress",
    "Ctrl+F": "find",
    "Cmd+Alt+S": "toggleSidebar",
    Escape: "deselect",
  },
};

const Keys = (() => {
  const extra = {};
  const PUNCT = { Period: ".", Comma: ",", BracketLeft: "[", BracketRight: "]", Slash: "/", Backslash: "\\", Minus: "-", Equal: "=", Semicolon: ";", Quote: "'", Backquote: "`" };

  // The chord of a key event: modifiers in a fixed order, then the key by its place on the keyboard, so Shift+. is
  // not read as ">" and a Vietnamese layout gives the same chords.
  function chord(e) {
    let key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : PUNCT[e.code] || e.key;
    if (key === " ") key = "Space";
    return `${e.metaKey ? "Cmd+" : ""}${e.ctrlKey ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey ? "Shift+" : ""}${key}`;
  }

  const map = () => ({ ...KEYMAPS[S.settings.keymap === "windows" ? "windows" : "mac"], ...extra });

  // Moves in the list: the arrows, Home, End and the pages, by one row in a list and by a line of icons in a grid.
  function moveKey(pane, e) {
    const icons = pane.tab.mode === "icons";
    const per = icons ? pane.per || 1 : 1;
    const page = Math.max(1, Math.floor(pane.list.clientHeight / (pane.rowH || ROW_H)) - 1) * per;
    const steps = {
      ArrowDown: per,
      ArrowUp: -per,
      ArrowRight: icons ? 1 : 0,
      ArrowLeft: icons ? -1 : 0,
      PageDown: page,
      PageUp: -page,
      Home: -Infinity,
      End: Infinity,
    };
    const step = steps[e.key];
    if (step === undefined || e.metaKey || e.ctrlKey || e.altKey) return false;
    if (step === 0) return true;
    if (!Number.isFinite(step)) {
      pane.tab.lead = step > 0 ? pane.tab.count : -1;
      pane.move(step > 0 ? -1 : 1, e.shiftKey);
    } else pane.move(step, e.shiftKey);
    return true;
  }

  document.addEventListener("keydown", (e) => {
    if (sheetOpen() || e.isComposing) return;
    const field = e.target.closest?.("input, textarea, select");
    if (field) return;
    const pane = Panes.focused();
    if (!pane) return;
    if (moveKey(pane, e)) {
      e.preventDefault();
      return;
    }
    const name = map()[chord(e)];
    if (name && Panes.action(name, pane)) {
      e.preventDefault();
      return;
    }
    // Typing a name finds it.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== " ") {
      e.preventDefault();
      pane.find(e.key.toLowerCase());
    }
  });

  // Selection is drawn in the accent colour only while the window is in front, as macOS draws it.
  window.addEventListener("blur", () => document.body.classList.add("inactive"));
  window.addEventListener("focus", () => document.body.classList.remove("inactive"));

  return {
    chord,
    map,
    add(chords) {
      Object.assign(extra, chords);
    },
  };
})();
