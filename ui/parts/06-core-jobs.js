// Jobs on the page: a row with a bar for each one that takes more than a moment, and the questions a job asks while it
// waits (an item already there, a password, a yes or no).
words({
  vi: {
    conflictTitle: "Đã có một mục tên \"{0}\" ở đây.", conflictText: "Bạn muốn thay thế nó, giữ cả hai, hay bỏ qua mục này?",
    conflictFolder: "Đã có một thư mục tên \"{0}\" ở đây. Gộp sẽ đưa nội dung vào thư mục có sẵn và hỏi với từng mục trùng tên.",
    incoming: "Mục mới", existing: "Mục đang có", applyAll: "Áp dụng cho tất cả", stop: "Dừng", skip: "Bỏ qua", merge: "Gộp",
    pauseJob: "Tạm dừng", resumeJob: "Chạy tiếp", jobPaused: "Đã tạm dừng",
    replace: "Thay thế", keepBoth: "Giữ cả hai", working: "Đang làm...", password: "Nhập mật khẩu cho {0}", ok: "OK", yes: "Có",
  },
  en: {
    conflictTitle: "An item named \"{0}\" is already here.", conflictText: "Do you want to replace it, keep both, or skip this item?",
    conflictFolder: "A folder named \"{0}\" is already here. Merging puts the contents into it and asks about each item with the same name.",
    incoming: "Incoming", existing: "Already here", applyAll: "Apply to all", stop: "Stop", skip: "Skip", merge: "Merge",
    pauseJob: "Pause", resumeJob: "Resume", jobPaused: "Paused",
    replace: "Replace", keepBoth: "Keep Both", working: "Working...", password: "Enter the password for {0}", ok: "OK", yes: "Yes",
  },
});

const Jobs = (() => {
  const rows = new Map();
  const questions = [];
  let asking = null;
  $("conflictSheet").dataset.modal = "1";

  function row(id) {
    return rows.get(id);
  }

  on("jobs.started", (d) => {
    const el = document.createElement("div");
    el.className = "job";
    el.innerHTML = `<div class="what"></div><div class="job-tools"><button class="stop pause" title="${esc(t("pauseJob"))}">${icon("pause")}</button><button class="stop" data-stop title="${esc(t("stop"))}">${icon("xmark")}</button></div><div class="bar wait"><i></i></div><div class="now"></div>`;
    el.querySelector(".what").textContent = d.title;
    el.querySelector("[data-stop]").addEventListener("click", () => call("jobs.cancel", { id: d.id }).catch(() => {}));
    // A job is paused at its next step and goes on where it was.
    el.querySelector(".pause").addEventListener("click", () => call("jobs.pause", { id: d.id, paused: !el.classList.contains("paused") }).catch(() => {}));
    // A job over in a moment never shows.
    const timer = setTimeout(() => $("jobs").appendChild(el), 450);
    rows.set(d.id, { el, timer });
  });

  on("jobs.paused", (d) => {
    const r = row(d.id);
    if (!r) return;
    r.el.classList.toggle("paused", d.paused);
    const b = r.el.querySelector(".pause");
    b.innerHTML = icon(d.paused ? "play" : "pause");
    b.title = t(d.paused ? "resumeJob" : "pauseJob");
    if (d.paused) r.el.querySelector(".now").textContent = t("jobPaused");
  });

  on("jobs.progress", (d) => {
    const r = row(d.id);
    if (!r) return;
    const bar = r.el.querySelector(".bar");
    if (d.total > 0) {
      bar.classList.remove("wait");
      bar.querySelector("i").style.width = `${Math.min(100, (100 * d.done) / d.total)}%`;
    }
    r.el.querySelector(".now").textContent = d.current || "";
  });

  on("jobs.finished", (d) => {
    const r = row(d.id);
    if (r) {
      clearTimeout(r.timer);
      r.el.remove();
      rows.delete(d.id);
    }
    if (!d.ok && !d.cancelled && d.error) say(d.error);
    // A question of a job that ended is no longer asked.
    for (let i = questions.length - 1; i >= 0; i--) if (questions[i].id === d.id) questions.splice(i, 1);
    if (asking?.id === d.id) {
      asking = null;
      closeSheets();
      next();
    }
  });

  on("jobs.ask", (d) => {
    questions.push(d);
    if (!asking) next();
  });

  function answer(value, all = false) {
    const q = asking;
    asking = null;
    closeSheets();
    if (q) call("jobs.answer", { id: q.id, answer: value, applyAll: all }).catch(say);
    setTimeout(next, 30);
  }

  function next() {
    if (asking || !questions.length) return;
    asking = questions.shift();
    const q = asking.question;
    if (q.type === "conflict") {
      $("conflictTitle").textContent = t("conflictTitle", q.name);
      $("conflictText").textContent = q.folder ? t("conflictFolder", q.name) : t("conflictText");
      const side = (x) => (x ? `${x.isDir ? "--" : fmtSize(x.size)}, ${fmtDate(x.mtime)}` : "");
      $("conflictCompare").innerHTML = `<span>${esc(t("incoming"))}</span><b>${esc(side(q.source))}</b><span>${esc(t("existing"))}</span><b>${esc(side(q.target))}</b>`;
      $("conflictSheet").querySelector('[data-answer="merge"]').hidden = !q.folder;
      $("conflictAll").checked = false;
      openSheet("conflictSheet");
      setTimeout(() => $("conflictSheet").querySelector('[data-answer="keepBoth"]').focus(), 30);
    } else if (q.type === "confirm") {
      confirmSheet(q.text, "", t("yes")).then((yes) => answer(yes ? "yes" : "no"));
    } else if (q.type === "password") {
      LZ.prompt(t("password", q.what), { secret: true }).then((text) => answer(text == null ? "stop" : { text }));
    }
  }

  $("conflictSheet").addEventListener("click", (e) => {
    const b = e.target.closest("[data-answer]");
    if (b) answer(b.dataset.answer, $("conflictAll").checked);
  });
  document.addEventListener("keydown", (e) => {
    if (!asking || !$("conflictSheet").classList.contains("open")) return;
    if (e.key === "Escape") answer("stop");
  });

  return { answer };
})();
