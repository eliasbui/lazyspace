// Word, Excel and PowerPoint in the context menu of their documents, when they are on this Mac. A document in the
// folder of OneDrive's app (or of another cloud's app) opened there is edited in place: Office saves it where it is, and
// the cloud's app sends each change up, so co-workers see it as on the web.
words({
  vi: { openInWord: "Mở bằng Word", openInExcel: "Mở bằng Excel", openInPowerPoint: "Mở bằng PowerPoint", officeSyncs: "Sửa xong, OneDrive tự đồng bộ lên mây" },
  en: { openInWord: "Open in Word", openInExcel: "Open in Excel", openInPowerPoint: "Open in PowerPoint", officeSyncs: "Saved changes go up to OneDrive by themselves" },
});

(() => {
  const APPS = [
    ["word", "openInWord", ["doc", "docx", "docm", "dot", "dotx", "rtf", "odt"]],
    ["excel", "openInExcel", ["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "csv", "ods"]],
    ["powerpoint", "openInPowerPoint", ["ppt", "pptx", "pptm", "pot", "potx", "pps", "ppsx", "odp"]],
  ];
  let paths = {};
  const load = () =>
    LZ.call("native.office_apps")
      .then((d) => (paths = d || {}))
      .catch(() => {});
  LZ.on("app.hello", load);
  // An app installed while LazySpace runs is found when the window comes forward.
  window.addEventListener("focus", load);

  const ext = (name) => (name.includes(".") ? name.split(".").pop().toLowerCase() : "");
  // The one app every selected file opens in, or null.
  function appOf(ctx) {
    if (!ctx.count || !ctx.entries.length || ctx.entries.some((e) => e.isDir || !isLocal(e.uri))) return null;
    const found = APPS.find(([, , exts]) => ctx.entries.every((e) => exts.includes(ext(e.name))));
    return found && paths[found[0]] ? found : null;
  }
  const inCloud = (ctx) => ctx.entries.every((e) => /\/Library\/CloudStorage\//.test(decodeURIComponent(e.uri)));

  LZ.menu.add({
    id: "openInOffice",
    label: (ctx) => t(appOf(ctx)?.[1] || "openInWord"),
    icon: "doc.richtext",
    group: 10,
    order: 1.5,
    when: (ctx) => !!appOf(ctx),
    run: (ctx) => {
      const [key] = appOf(ctx);
      LZ.call("native.open_with", { uris: ctx.entries.map((e) => e.uri), app: paths[key] })
        .then(() => inCloud(ctx) && LZ.toast(t("officeSyncs")))
        .catch(LZ.say);
    },
  });
})();
