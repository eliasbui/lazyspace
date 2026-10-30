// Small helpers the core parts share: places as paths and back, sizes and dates in Finder's manner, and the URLs of
// the system's icons and thumbnails.
words({
  vi: { today: "Hôm nay", yesterday: "Hôm qua", bytes: "{0} byte", items: "{0} mục", selectedOf: "Đã chọn {0} trên {1}", available: "{0} trống" },
  en: { today: "Today", yesterday: "Yesterday", bytes: "{0} bytes", items: "{0} items", selectedOf: "{0} of {1} selected", available: "{0} available" },
});

const isLocal = (uri) => typeof uri === "string" && uri.startsWith("file://");
// The path of a local place, decoded; for any other scheme the part after the authority.
function pathOf(uri) {
  const rest = uri.replace(/^[a-z0-9+-]+:\/\/[^/]*/, "");
  try {
    return decodeURIComponent(rest) || "/";
  } catch {
    return rest || "/";
  }
}
const nameOf = (uri) => pathOf(uri).split("/").filter(Boolean).pop() || "/";
// The names, and the crumbs of the path bar ([uri, name, icon] from the top down), of places that are not folders of
// a disk (the shelf, a server), by scheme; features add theirs.
const placeNames = {};
const placeCrumbs = {};
const schemeOf = (uri) => (typeof uri === "string" ? uri.split("://")[0] : "");
// The part between `scheme://` and the path, decoded: the id of a server's connection.
function authorityOf(uri) {
  const raw = (uri.split("://")[1] || "").split("/")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
// What a place is called in a title, a tab and the path bar.
const placeName = (uri) => (placeNames[schemeOf(uri)] ? placeNames[schemeOf(uri)](uri) : nameOf(uri));
// A place as a list of places writes it: the path from the home folder (~) on this Mac, the name of the server or the
// shelf with the path in it elsewhere.
function placeLabel(uri) {
  const path = pathOf(uri);
  if (!isLocal(uri)) return path === "/" ? placeName(uri) : `${placeName(withPath(uri, "/"))}: ${path}`;
  const home = S.places.home ? pathOf(S.places.home) : null;
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}
// Finder's tags of an item as dots of their colours, after its name as Finder draws them (ui/parts/26-tags.js).
const tagDots = (e) => (e?.tags?.length ? `<span class="tags">${e.tags.slice(0, 3).map(([name, c]) => `<i class="tag-${Number(c) || 0}" title="${esc(name)}"></i>`).join("")}</span>` : "");
const samePlace = (a, b) => !!a && !!b && schemeOf(a) === schemeOf(b) && authorityOf(a) === authorityOf(b) && pathOf(a) === pathOf(b);

const locale = () => (lang === "vi" ? "vi-VN" : "en-US");
let dateFormats = {};
function fmtDate(seconds) {
  if (!seconds) return "--";
  const key = locale();
  dateFormats[key] ||= {
    time: new Intl.DateTimeFormat(key, { hour: "2-digit", minute: "2-digit" }),
    day: new Intl.DateTimeFormat(key, { day: "numeric", month: "short", year: "numeric" }),
  };
  const f = dateFormats[key];
  const d = new Date(seconds * 1000);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const diff = (start - new Date(d).setHours(0, 0, 0, 0)) / 86400000;
  const day = diff === 0 ? t("today") : diff === 1 ? t("yesterday") : f.day.format(d);
  return `${day}, ${f.time.format(d)}`;
}

// Sizes as Finder writes them: in thousands, one decimal under ten.
function fmtSize(bytes) {
  if (bytes == null) return "--";
  if (bytes < 1000) return t("bytes", bytes);
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value.toLocaleString(locale(), { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

const pixelRatio = () => Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 2)));
const iconUrl = (entry, points = 16) => `lazy://icon/${points * pixelRatio()}/${encodeURIComponent(entry.icon)}`;
const THUMBNAILED = /^(jpe?g|png|gif|heic|heif|webp|tiff?|bmp|psd|mov|mp4|m4v|avi|pdf|key|pages|numbers|cr2|nef|arw|dng|raf|orf)$/i;
// A picture that fails to load (a thumbnail Quick Look could not make) shows the URL in its data-fallback instead, with
// the class in data-fallback-class. No handler is ever written into the markup, where a file's name could become code.
document.addEventListener(
  "error",
  (e) => {
    const img = e.target;
    if (img?.tagName !== "IMG" || !img.dataset.fallback) return;
    const url = img.dataset.fallback;
    delete img.dataset.fallback;
    img.className = img.dataset.fallbackClass || "";
    img.src = url;
  },
  true,
);
// An <img> of a thumbnail that falls back to `fallback`, both URLs escaped for an attribute.
const thumbImg = (thumb, fallback, cls = "", fallbackClass = "") =>
  `<img${cls ? ` class="${cls}"` : ""} src="${esc(thumb)}" data-fallback="${esc(fallback)}"${fallbackClass ? ` data-fallback-class="${fallbackClass}"` : ""} draggable="false" alt="">`;
// A Quick Look thumbnail for a picture, a film or a document, or null when the icon will do.
const thumbUrl = (entry, points) =>
  entry.kind === "file" && THUMBNAILED.test(entry.ext) && isLocal(entry.uri) ? `lazy://thumb/${points * pixelRatio()}/${encodeURIComponent(pathOf(entry.uri))}` : null;
