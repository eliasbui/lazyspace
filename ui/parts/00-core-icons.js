// Line icons in the manner of SF Symbols, by name, for the toolbar, the sidebar and the path bar. A feature adds its
// own with icons.add({ name: "<svg ...>" }). File icons are not here: they come from the system (lazy://icon).
const ICONS = {
  "chevron.left": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  "chevron.right": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  "chevron.down": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  "chevron.up": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
  "triangle.right": '<svg viewBox="0 0 6 7"><path d="M0 0l6 3.5L0 7z" fill="currentColor"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.8" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.8" cy="17.5" r="1.1" fill="currentColor" stroke="none"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/></svg>',
  "folder.plus": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="M3.5 7.5a2 2 0 012-2h3.6l2 2h7.4a2 2 0 012 2v8a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/><path d="M12 11v5M9.5 13.5h5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15M9.5 4h5M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18.5" r="1.6"/></svg>',
  ellipsis: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/><circle cx="8" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1.1" fill="currentColor" stroke="none"/></svg>',
  xmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  house: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 11.5L12 4.5l8 7"/><path d="M6.5 9.8V19.5h4v-5.5h3v5.5h4V9.8"/></svg>',
  desktop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="5" width="18" height="12.5" rx="2"/><path d="M3 14.5h18"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v8.5M8.5 12.8l3.5 3.5 3.5-3.5"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M6.5 3.5h7l4.5 4.5v12.5h-11.5z"/><path d="M13.5 3.5V8H18"/></svg>',
  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M9 17.5V6.5l10-2.2v11"/><circle cx="6.8" cy="17.5" r="2.2"/><circle cx="16.8" cy="15.3" r="2.2"/></svg>',
  photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-4.5-4.5-8 7.5"/></svg>',
  app: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5l-6.5 15M12 4.5l6.5 15M7.6 14.5h8.8"/></svg>',
  drive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="8" width="18" height="8.5" rx="2"/><circle cx="17" cy="12.25" r="0.9" fill="currentColor" stroke="none"/></svg>',
  "drive.external": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="7" width="18" height="10" rx="3"/><path d="M6.5 12h6"/></svg>',
  eject: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5l7 8H5z"/><rect x="5" y="16" width="14" height="2.4" rx="1"/></svg>',
  icloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M7.2 18.5h10.3a4 4 0 00.4-7.98 6 6 0 00-11.5-1.3A4.7 4.7 0 007.2 18.5z"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c-2.6 2.6-3.8 5.4-3.8 8.5s1.2 5.9 3.8 8.5M12 3.5c2.6 2.6 3.8 5.4 3.8 8.5s-1.2 5.9-3.8 8.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.7 7.7 0 000-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 00-1.7-1l-.4-2.5h-4l-.4 2.5a7.6 7.6 0 00-1.7 1l-2.4-1-2 3.4L4.6 11a7.7 7.7 0 000 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4z"/></svg>',
  sidebar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M9.5 5v14"/></svg>',
  "layout.single": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="5" width="17" height="14" rx="2"/></svg>',
  "layout.h2": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M12 5v14"/></svg>',
  "layout.v2": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 12h17"/></svg>',
  "layout.grid": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M12 5v14M3.5 12h17"/></svg>',
};
const icons = {
  add(more) {
    Object.assign(ICONS, more);
  },
};
// An icon's markup by name; a name nobody drew gives nothing.
const icon = (name) => ICONS[name] || "";

// Fills each element marked data-icon with its icon, keeping the element's own content after it.
function paintIcons(scope = document) {
  for (const el of scope.querySelectorAll("[data-icon]")) {
    if (el.dataset.painted === el.dataset.icon) continue;
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
    el.dataset.painted = el.dataset.icon;
  }
}
