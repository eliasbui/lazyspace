// The current folder in a terminal or an editor (W2): two toolbar buttons open it in the default of each kind, and
// the context menu lists every one on this Mac; the one used last becomes the default.
LZ.words({
  vi: { openTerminal: "Mở trong Terminal", openEditor: "Mở trong trình soạn thảo", otherApp: "Ứng dụng khác..." },
  en: { openTerminal: "Open in Terminal", openEditor: "Open in Editor", otherApp: "Other App..." },
});
LZ.icons.add({
  terminal: "terminal",
  editor: "chevron.left.forwardslash.chevron.right",
});

const OpenIn = (() => {
  let tools = [];
  const load = async () => (tools = await LZ.call("openin.tools").catch(() => tools));

  // The folder the pane shows, or the selected item for an editor when one is selected.
  function target(pane, kind) {
    const tab = pane.tab;
    const one = tab.selCount() === 1 ? tab.selectedEntries()[0] : null;
    return kind === "editor" && one ? one.uri : tab.uri;
  }

  function open(pane, kind, tool) {
    if (!isLocal(pane.tab.uri)) return;
    LZ.call("openin.open", { kind, tool, uri: target(pane, kind) })
      .then(load)
      .catch(LZ.say);
  }

  async function chooseTool(pane, kind, x, y) {
    await load();
    const own = tools.filter((t) => t.kind === kind);
    const id = await LZ.choose(own.map((tool) => ({ id: tool.id, label: tool.name, checked: tool.default })), x, y);
    if (id) open(pane, kind, id);
  }

  for (const kind of ["terminal", "editor"]) {
    const b = LZ.toolbar.add({
      id: kind,
      side: "left",
      icon: kind,
      label: kind === "terminal" ? "openTerminal" : "openEditor",
      run: (e, button) => {
        const pane = Panes.focused();
        if (!pane) return;
        // Option-click picks another app; a click uses the default.
        if (e.altKey) {
          const r = button.getBoundingClientRect();
          chooseTool(pane, kind, r.left, r.bottom + 6);
        } else open(pane, kind, null);
      },
    });
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const r = b.getBoundingClientRect();
      chooseTool(Panes.focused(), kind, r.left, r.bottom + 6);
    });
  }

  for (const [kind, label, symbol] of [
    ["terminal", "openTerminal", "terminal"],
    ["editor", "openEditor", "chevron.left.forwardslash.chevron.right"],
  ]) {
    LZ.menu.add({
      id: `openin.${kind}`,
      label,
      icon: symbol,
      group: 55,
      order: kind === "terminal" ? 1 : 2,
      when: (c) => isLocal(c.tab.uri) && tools.some((t) => t.kind === kind),
      submenu: () =>
        tools
          .filter((t) => t.kind === kind)
          .map((tool) => ({ id: `openin.${kind}.${tool.id}`, label: () => tool.name, checked: () => tool.default, run: (c) => open(c.pane, kind, tool.id) })),
    });
  }

  LZ.on("app.hello", load);
  return { load, open };
})();
