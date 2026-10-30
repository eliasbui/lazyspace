// Finder's colour tags (src/features/tags.rs): dots after a name in every view, a menu of the seven colours on the
// items selected, and a section of the sidebar where each colour is a search of the whole Mac for it.
LZ.words({
  vi: {
    tagsTitle: "Thẻ", "m.tags": "Thẻ", "tag.1": "Xám", "tag.2": "Xanh lá", "tag.3": "Tím", "tag.4": "Xanh dương", "tag.5": "Vàng", "tag.6": "Đỏ", "tag.7": "Cam",
  },
  en: {
    tagsTitle: "Tags", "m.tags": "Tags", "tag.1": "Gray", "tag.2": "Green", "tag.3": "Purple", "tag.4": "Blue", "tag.5": "Yellow", "tag.6": "Red", "tag.7": "Orange",
  },
});

const Tags = (() => {
  // Finder's names of its colours, by number, which a tag is written with (src/native/tags.rs), in Finder's order.
  const NAMES = ["", "Gray", "Green", "Purple", "Blue", "Yellow", "Red", "Orange"];
  const ORDER = [6, 7, 5, 2, 4, 3, 1];
  const colourOf = (name) => NAMES.findIndex((n, i) => i > 0 && n.toLowerCase() === String(name).toLowerCase());
  // A tag's name as the user's language says it: Finder's colours by their colour, any other as it was named.
  const label = (name) => (colourOf(name) > 0 ? t(`tag.${colourOf(name)}`) : name);
  const has = (entry, colour) => (entry.tags || []).some(([name, c]) => Number(c) === colour || colourOf(name) === colour);

  LZ.menu.add({
    id: "tags",
    label: "m.tags",
    icon: "tag",
    group: 50,
    order: 5,
    when: (ctx) => ctx.count > 0 && ctx.entries.length > 0 && ctx.entries.every((e) => isLocal(e.uri)),
    submenu: ORDER.map((colour) => ({
      id: `tag.${colour}`,
      label: `tag.${colour}`,
      checked: (ctx) => ctx.entries.every((e) => has(e, colour)),
      run: (ctx) => {
        const on = !ctx.entries.every((e) => has(e, colour));
        LZ.call("tags.set", { uris: ctx.entries.map((e) => e.uri), colour, on })
          .then(() => ctx.pane.refresh())
          .catch(LZ.say);
      },
    })),
  });

  // The sidebar's tags: each colour opens the search of the Mac for it.
  const section = LZ.sidebar.section({
    id: "tags",
    render(el) {
      el.innerHTML =
        `<div class="side-head"><span>${LZ.esc(t("tagsTitle"))}</span></div>` +
        ORDER.map((colour) => {
          const uri = Search.uriOf({ tag: NAMES[colour] }, "/");
          return `<button class="side-item" data-uri="${LZ.esc(uri)}"><span class="ico"><i class="tag-dot tag-${colour}"></i></span><span class="label">${LZ.esc(t(`tag.${colour}`))}</span></button>`;
        }).join("");
    },
  });
  // At the foot of the sidebar, after the disks, where Finder keeps them.
  $("sideLocations").after(section.el);
  LZ.on("settings.changed", section.refresh);

  return { label, colourOf };
})();
