// The hashes of the selected files (W2), in a sheet: every algorithm for each file, a button to copy one, and a field
// to paste a hash into, which marks the one that matches.
LZ.words({
  vi: {
    hashTitle: "Mã băm", hashMenu: "Tính mã băm", hashCompare: "Dán mã băm để đối chiếu", hashMatch: "Khớp {0} của \"{1}\"",
    hashNoMatch: "Không khớp mã nào", hashWorking: "Đang tính...", copied: "Đã sao chép", copy: "Sao chép",
  },
  en: {
    hashTitle: "Hashes", hashMenu: "Calculate Hashes", hashCompare: "Paste a hash to compare", hashMatch: "Matches the {0} of \"{1}\"",
    hashNoMatch: "Matches none of them", hashWorking: "Working...", copied: "Copied", copy: "Copy",
  },
});

const Hash = (() => {
  const ALGOS = [
    ["md5", "MD5"],
    ["sha1", "SHA-1"],
    ["sha224", "SHA-224"],
    ["sha256", "SHA-256"],
    ["sha384", "SHA-384"],
    ["sha512", "SHA-512"],
    ["crc32", "CRC32"],
  ];
  const panel = LZ.sheet.create("hashSheet");
  panel.classList.add("hash-panel");
  panel.innerHTML = `
    <h2 data-t="hashTitle"></h2>
    <input class="hash-compare" type="text" spellcheck="false" data-tp="hashCompare" />
    <div class="hash-verdict"></div>
    <div class="hash-files"></div>
    <div class="buttons"><button class="push primary" data-t="done"></button></div>`;
  const files = panel.querySelector(".hash-files");
  const compare = panel.querySelector(".hash-compare");
  const verdict = panel.querySelector(".hash-verdict");
  let job = null;
  let results = [];

  // A hash as typed or pasted: lower case, without spaces, colons or dashes.
  const normal = (text) => text.toLowerCase().replace(/[\s:-]/g, "");

  function check() {
    const want = normal(compare.value);
    for (const row of panel.querySelectorAll(".hash-row")) row.classList.toggle("match", !!want && row.dataset.value === want);
    if (!want) return (verdict.textContent = "");
    const hit = results.flatMap((r) => ALGOS.filter(([key]) => r.hashes[key] === want).map(([, label]) => [label, r.name]))[0];
    verdict.textContent = hit ? t("hashMatch", hit[0], hit[1]) : t("hashNoMatch");
    verdict.className = `hash-verdict ${hit ? "yes" : "no"}`;
  }

  function add(result) {
    results.push(result);
    const el = document.createElement("div");
    el.className = "hash-file";
    el.innerHTML = `<div class="hash-name"><b>${LZ.esc(result.name)}</b> <span>${fmtSize(result.size)}</span></div>${ALGOS.map(
      ([key, label]) => `<div class="hash-row" data-value="${result.hashes[key]}"><span>${label}</span><code>${result.hashes[key]}</code><button class="push" data-copy="${result.hashes[key]}">${LZ.esc(t("copy"))}</button></div>`,
    ).join("")}`;
    files.querySelector(".hash-wait")?.remove();
    files.appendChild(el);
    check();
  }

  function start(pane) {
    results = [];
    files.innerHTML = `<p class="hash-wait">${LZ.esc(t("hashWorking"))}</p>`;
    compare.value = "";
    verdict.textContent = "";
    LZ.sheet.open("hashSheet");
    LZ.call("hash.start", pane.tab.selection())
      .then((d) => (job = d.job))
      .catch((error) => {
        files.innerHTML = `<p>${LZ.esc(error)}</p>`;
      });
  }

  panel.addEventListener("click", (e) => {
    const copy = e.target.closest("[data-copy]");
    if (copy) LZ.call("clipboard.text", { text: copy.dataset.copy }).then(() => LZ.toast(t("copied")), LZ.say);
    if (e.target.closest(".buttons .push")) LZ.sheet.close();
  });
  compare.addEventListener("input", check);
  LZ.on("hash.started", (d) => (job = d.job));
  LZ.on("hash.result", (d) => {
    if (d.job === job) add(d.result);
  });
  LZ.on("jobs.finished", (d) => {
    if (d.id === job && !d.ok && !d.cancelled) files.innerHTML = `<p>${LZ.esc(d.error || "")}</p>`;
  });

  LZ.menu.add({ id: "hash", label: "hashMenu", icon: "number", group: 20, order: 5, when: (c) => c.count > 0 && c.entries.some((e) => e.kind === "file"), run: (c) => start(c.pane) });
  return { start };
})();
