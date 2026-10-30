// The window's icons are SF Symbols, as Finder's are: the system draws each (lazy://symbol) and the page paints it in
// the colour of the place it sits in (a CSS mask over currentColor), so it follows the text, the accent and dark mode.
// A name maps to a symbol, with a weight before a slash and stand-ins for an older macOS after commas
// ("medium/chevron.left", "menubar.dock.rectangle,desktopcomputer"). A feature adds its own with icons.add; a value
// that starts with "<" is markup used as it is. File icons are not here: they come from the system (lazy://icon).
const ICONS = {
  "chevron.left": "medium/chevron.left",
  "chevron.right": "medium/chevron.right",
  "chevron.right.2": "medium/chevron.right.2",
  "chevron.left.2": "medium/chevron.left.2",
  "chevron.down": "semibold/chevron.down",
  "chevron.up": "semibold/chevron.up",
  "triangle.right": "semibold/chevron.right",
  list: "list.bullet",
  grid: "square.grid.2x2",
  columns: "rectangle.split.3x1",
  gallery: "photo.on.rectangle",
  "folder.plus": "folder.badge.plus",
  trash: "trash",
  search: "magnifyingglass",
  more: "ellipsis",
  ellipsis: "ellipsis.circle",
  xmark: "semibold/xmark",
  plus: "plus",
  house: "house",
  desktop: "menubar.dock.rectangle,desktopcomputer",
  download: "arrow.down.circle",
  doc: "doc",
  film: "film",
  music: "music.note",
  photo: "photo",
  app: "square.grid.3x3",
  drive: "internaldrive",
  "drive.external": "externaldrive",
  eject: "eject",
  icloud: "icloud",
  globe: "globe",
  gear: "gearshape",
  sidebar: "sidebar.left",
  "layout.single": "rectangle",
  "layout.h2": "rectangle.split.2x1",
  "layout.v2": "rectangle.split.1x2",
  "layout.grid": "rectangle.split.2x2",
  history: "clock.arrow.circlepath",
  clock: "clock",
  pause: "pause.fill",
  play: "play.fill",
  refresh: "medium/arrow.clockwise",
  up: "medium/arrow.up",
  pin: "pin",
  folder: "folder",
};
const icons = {
  add(more) {
    Object.assign(ICONS, more);
  },
};
// The symbols are drawn once at this many pixels and scaled down by WebKit: sharp up to a 21-point icon on a 3x screen.
const SYMBOL_PX = 64;
// An icon's markup by name; a name nobody gave gives nothing. It is an empty <svg>, so the size each place gives the
// svg of its icon applies to it.
function icon(name) {
  const value = ICONS[name];
  if (!value) return "";
  if (value.startsWith("<")) return value;
  const spec = value.includes("/") ? value : `regular/${value}`;
  return `<svg class="sym" style="--sym:url('lazy://symbol/${SYMBOL_PX}/${spec}')"></svg>`;
}

// Fills each element marked data-icon with its icon, keeping the element's own content after it.
function paintIcons(scope = document) {
  for (const el of scope.querySelectorAll("[data-icon]")) {
    if (el.dataset.painted === el.dataset.icon) continue;
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
    el.dataset.painted = el.dataset.icon;
  }
}
