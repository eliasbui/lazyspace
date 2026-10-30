// Git in the list (src/features/git.rs): in a folder of a repository each item changed shows a letter after its name, as
// the editors show them (M changed, A added, D gone, R renamed, U new, C in conflict), and the branch shows at the end of
// the path bar. It is asked again whenever the folder changes.
LZ.words({ vi: { gitBranch: "Nhánh git: {0}" }, en: { gitBranch: "Git branch: {0}" } });
LZ.icons.add({ branch: "arrow.triangle.branch" });

(() => {
  const timers = new WeakMap();
  function ask(pane) {
    const tab = pane.tab;
    clearTimeout(timers.get(tab));
    if (!isLocal(tab.uri)) return paint(pane, null);
    timers.set(
      tab,
      setTimeout(() => {
        const uri = tab.uri;
        LZ.call("git.status", { uri })
          .then((state) => {
            if (tab.uri !== uri) return;
            tab.marks = state?.items || null;
            tab.branch = state?.branch || null;
            if (pane.tab === tab) paint(pane, tab);
          })
          .catch(() => {});
      }, 250),
    );
  }

  function paint(pane, tab) {
    let pill = pane.box.querySelector(".git-branch");
    const branch = tab?.branch;
    if (!branch) pill?.remove();
    else {
      if (!pill) {
        pill = document.createElement("span");
        pill.className = "git-branch";
        pane.box.querySelector('[data-act="history"]').before(pill);
      }
      pill.innerHTML = `${icon("branch")}<span>${LZ.esc(branch)}</span>`;
      pill.title = t("gitBranch", branch);
    }
    pane.render();
  }

  LZ.on("view.changed", (d) => {
    const found = Panes.findTab(d.view);
    if (found && found[0].tab === found[1]) ask(found[0]);
  });
  // A tab shown again shows its own state, and asks again in case it moved on.
  Panes.on("render", ({ pane }) => {
    const pill = pane.box.querySelector(".git-branch");
    if (!pane.tab.branch && pill) pill.remove();
    else if (pane.tab.branch && pill?.textContent !== pane.tab.branch) paint(pane, pane.tab);
  });
})();
