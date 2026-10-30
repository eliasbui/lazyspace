// Server connections (W8): the Cloud section of the sidebar (the folders of the clouds' own apps, and the clouds rclone
// signs in to from here), the Servers section (saved connections), the sheet that adds or edits a connection, and what
// a server asks for on the way in: a password, or trust in a key it shows for the first time. Cmd+K opens the sheet,
// as Finder's "Connect to Server".
LZ.words({
  vi: {
    servers: "Máy chủ", connectServer: "Kết nối máy chủ", editServer: "Sửa kết nối", newServer: "Kết nối mới", serverKind: "Loại", serverName: "Tên",
    serverHost: "Máy chủ", serverPort: "Cổng", serverUser: "Người dùng", serverAccessKey: "Access key ID", serverPassword: "Mật khẩu", serverSecretKey: "Secret access key",
    serverPassphrase: "Mật khẩu hoặc passphrase", serverKeyFile: "Tệp khóa SSH", serverFolder: "Thư mục mở đầu", serverShare: "Thư mục chia sẻ", serverPath: "Đường dẫn",
    serverRegion: "Vùng (region)", serverEndpoint: "Địa chỉ dịch vụ", serverBucket: "Bucket", serverGuest: "Vào với tư cách khách", s3Compatible: "S3 tương thích (MinIO, R2...)",
    cloudRclone: "Đám mây qua rclone", optional: "không bắt buộc", keepSecret: "Để trống để giữ mật khẩu đã lưu", tryConnect: "Thử", saveConnect: "Lưu và kết nối",
    connect: "Kết nối", disconnect: "Ngắt kết nối", deleteServer: "Xóa kết nối", deleteServerText: "Xóa kết nối \"{0}\" và mật khẩu của nó trong Keychain?",
    connectionWorks: "Kết nối được", secretNotKept: "Keychain không giữ được mật khẩu; LazySpace chỉ nhớ nó tới khi thoát",
    passwordFor: "Mật khẩu cho \"{0}\"", trustTitle: "Máy chủ lần đầu gặp", trust: "Tin máy chủ này",
    trustText: "LazySpace chưa từng kết nối tới {0}. Dấu vân tay khóa của nó là:\n{1}\nHãy so với dấu vân tay mà người quản trị máy chủ cho bạn trước khi tin.",
    hostKeyNew: "Máy chủ này chưa được tin.", cloudKind: "Dịch vụ", cloudName: "Tên (chữ không dấu)", signIn: "Đăng nhập",
    rcloneNote: "Trình duyệt sẽ mở để bạn đăng nhập. rclone giữ tài khoản trong cấu hình của nó; chưa có rclone thì LazySpace cài bằng Homebrew trước.",
    clouds: "Đám mây", addCloud: "Thêm đám mây", addService: "Thêm {0}", otherCloud: "Dịch vụ khác...", signInBrowser: "Đăng nhập trong trình duyệt vừa mở",
    rcloneNeeded: "Cần rclone", installRclone: "Cài rclone",
    rcloneNeededText: "LazySpace đăng nhập Google Drive, OneDrive, Dropbox qua rclone, một công cụ miễn phí và mã nguồn mở. Cài nó bằng Homebrew bây giờ?",
  },
  en: {
    servers: "Servers", connectServer: "Connect to Server", editServer: "Edit Connection", newServer: "New Connection", serverKind: "Kind", serverName: "Name",
    serverHost: "Server", serverPort: "Port", serverUser: "User", serverAccessKey: "Access key ID", serverPassword: "Password", serverSecretKey: "Secret access key",
    serverPassphrase: "Password or passphrase", serverKeyFile: "SSH key file", serverFolder: "Start folder", serverShare: "Shared folder", serverPath: "Path",
    serverRegion: "Region", serverEndpoint: "Service address", serverBucket: "Bucket", serverGuest: "Connect as a guest", s3Compatible: "S3 compatible (MinIO, R2...)",
    cloudRclone: "Cloud through rclone", optional: "optional", keepSecret: "Leave empty to keep the saved password", tryConnect: "Try", saveConnect: "Save and Connect",
    connect: "Connect", disconnect: "Disconnect", deleteServer: "Delete Connection", deleteServerText: "Delete the connection \"{0}\" and its password in the Keychain?",
    connectionWorks: "The connection works", secretNotKept: "The Keychain could not keep the password; LazySpace remembers it until it quits",
    passwordFor: "Password for \"{0}\"", trustTitle: "A server never seen before", trust: "Trust This Server",
    trustText: "LazySpace has never connected to {0}. The fingerprint of its key is:\n{1}\nCompare it with the one the server's administrator gave you before trusting it.",
    hostKeyNew: "This server is not trusted yet.", cloudKind: "Service", cloudName: "Name (plain letters)", signIn: "Sign In",
    rcloneNote: "The browser opens for you to sign in. rclone keeps the account in its own configuration; without rclone, LazySpace installs it with Homebrew first.",
    clouds: "Cloud", addCloud: "Add a Cloud", addService: "Add {0}", otherCloud: "Other Service...", signInBrowser: "Sign in in the browser that opened",
    rcloneNeeded: "rclone is needed", installRclone: "Install rclone",
    rcloneNeededText: "LazySpace signs in to Google Drive, OneDrive and Dropbox through rclone, a free and open source tool. Install it with Homebrew now?",
  },
});
LZ.icons.add({
  server: "server.rack",
  share: "externaldrive.connected.to.line.below",
  bucket: "cylinder",
});

const Remote = (() => {
  const SERVER_SCHEMES = ["sftp", "ftp", "ftps", "s3", "oss"];
  const PASSWORD = "LZ-PASSWORD:";
  const TRUST = "LZ-HOSTKEY:";
  // The kinds of the sheet: [kind, scheme, label]. "s3c" is S3 at an address of its own.
  const KINDS = [
    ["sftp", "sftp", "SFTP"],
    ["ftp", "ftp", "FTP"],
    ["ftps", "ftps", "FTPS (TLS)"],
    ["s3", "s3", "Amazon S3"],
    ["s3c", "s3", "s3Compatible"],
    ["oss", "oss", "Aliyun OSS"],
    ["smb", "smb", "SMB"],
    ["afp", "afp", "AFP"],
    ["nfs", "nfs", "NFS"],
    ["davs", "davs", "WebDAV (HTTPS)"],
    ["dav", "dav", "WebDAV (HTTP)"],
    ["rclone", "rclone", "cloudRclone"],
  ];
  // The labels of KINDS that are words to translate rather than names.
  const WORDS = new Set(["s3Compatible", "cloudRclone"]);
  const PORTS = { sftp: 22, ftp: 21, ftps: 21, smb: 445, afp: 548, nfs: 2049, dav: 80, davs: 443 };
  const CLOUDS = { drive: "Google Drive", dropbox: "Dropbox", onedrive: "OneDrive", box: "Box", pcloud: "pCloud", mega: "MEGA", yandex: "Yandex Disk", koofr: "Koofr", jottacloud: "Jottacloud", sharefile: "ShareFile" };
  let conns = [];
  let rclone = { installed: false, remotes: [], kinds: [] };
  // The folders of the clouds' own apps: { name, account, service, uri }.
  let local = [];
  let loaded = null;

  const byId = (id) => conns.find((c) => c.id === id);
  const kindOf = (c) => (c.scheme === "s3" && c.endpoint ? "s3c" : c.scheme);
  const iconOf = (c) => (["s3", "oss"].includes(c.scheme) ? "bucket" : ["smb", "afp", "nfs", "dav", "davs"].includes(c.scheme) ? "share" : "server");

  function load() {
    loaded = Promise.all([LZ.call("remote.list"), LZ.call("remote.clouds").catch(() => [])])
      .then(([d, clouds]) => {
        conns = d.connections;
        rclone = d.rclone;
        local = clouds;
        cloudSection.refresh();
        section.refresh();
        for (const pane of Panes.all()) if (SERVER_SCHEMES.includes(schemeOf(pane.tab.uri))) pane.renderPath();
      })
      .catch(() => {});
    return loaded;
  }

  // Names and crumbs of places on servers: the connection's name at the top, then the folders.
  const rootName = (uri) => (schemeOf(uri) === "rclone" ? authorityOf(uri) : byId(authorityOf(uri))?.name || authorityOf(uri));
  for (const scheme of [...SERVER_SCHEMES, "rclone"]) {
    placeNames[scheme] = (uri) => (pathOf(uri) === "/" ? rootName(uri) : nameOf(uri));
    placeCrumbs[scheme] = (uri) => {
      const items = [[withPath(uri, "/"), rootName(uri), null]];
      let at = "";
      for (const part of pathOf(uri).split("/").filter(Boolean)) items.push([withPath(uri, (at = `${at}/${part}`)), part, null]);
      return items;
    };
  }

  // The Cloud section, above Servers: what the clouds' own apps keep on this Mac, then what rclone signed in to. With
  // nothing yet it offers the two clouds most asked for, so signing in is found without opening a sheet.
  const cloudSection = LZ.sidebar.section({
    id: "cloud",
    render(el) {
      if (S.window.role !== "main") return;
      const item = (uri, name, title) =>
        `<button class="side-item" data-uri="${LZ.esc(uri)}"${title ? ` title="${LZ.esc(title)}"` : ""}><span class="ico" data-ico="icloud">${icon("icloud")}</span><span class="label">${LZ.esc(name)}</span></button>`;
      const head = `<div class="side-head"><span>${LZ.esc(t("clouds"))}</span><span class="end" data-cl-add title="${LZ.esc(t("addCloud"))}">${icon("plus")}</span></div>`;
      const items = [...local.map((c) => item(c.uri, c.name, c.account)), ...(rclone.remotes || []).map((r) => item(`rclone://${encodeURIComponent(r)}/`, r, "rclone"))];
      const offers = ["drive", "onedrive"]
        .map((kind) => `<button class="side-item offer" data-cl-kind="${kind}"><span class="ico">${icon("plus")}</span><span class="label">${LZ.esc(t("addService", CLOUDS[kind]))}</span></button>`)
        .join("");
      el.innerHTML = head + (items.length ? items.join("") : offers);
      Sidebar.mark();
    },
  });

  // Resolves with whether the job `id` went through once it ends; its error, if any, is shown by the jobs panel.
  function finished(id) {
    return new Promise((resolve) => {
      const done = (d) => {
        if (d.id !== id) return;
        handlers["jobs.finished"] = handlers["jobs.finished"].filter((f) => f !== done);
        resolve(!!d.ok);
      };
      LZ.on("jobs.finished", done);
    });
  }

  // Signs in to a cloud through rclone, installing rclone first when it is not there, then opens the cloud in a tab.
  async function signIn(kind, name = "") {
    try {
      if (!rclone.installed) {
        if (!(await LZ.confirm(t("rcloneNeeded"), t("rcloneNeededText"), t("installRclone")))) return;
        if (!(await finished((await LZ.call("remote.rclone_install")).job))) return;
        await load();
        if (!rclone.installed) return;
      }
      if (!name) {
        const base = CLOUDS[kind].replace(/[^A-Za-z0-9]/g, "");
        name = base;
        for (let i = 2; rclone.remotes.includes(name); i++) name = `${base}${i}`;
      }
      const { job } = await LZ.call("remote.rclone_add", { kind, name });
      LZ.toast(t("signInBrowser"));
      if (!(await finished(job))) return;
      await load();
      Panes.open(`rclone://${encodeURIComponent(name)}/`);
    } catch (e) {
      LZ.say(e);
    }
  }

  cloudSection.el.addEventListener("click", async (e) => {
    const offer = e.target.closest("[data-cl-kind]");
    if (offer) return signIn(offer.dataset.clKind);
    const add = e.target.closest("[data-cl-add]");
    if (!add) return;
    const r = add.getBoundingClientRect();
    const choice = await LZ.choose(
      [...["drive", "onedrive", "dropbox"].map((kind) => ({ id: kind, label: CLOUDS[kind], icon: "icloud" })), { separator: true }, { id: "other", label: t("otherCloud"), icon: "ellipsis.circle" }],
      r.left,
      r.bottom + 4,
    );
    if (choice === "other") {
      show(null);
      q(".rm-kind").value = "rclone";
      paint();
    } else if (choice) signIn(choice);
  });

  // The sidebar section.
  const section = LZ.sidebar.section({
    id: "remote",
    render(el) {
      if (S.window.role !== "main") return;
      const head = `<div class="side-head"><span>${LZ.esc(t("servers"))}</span><span class="end" data-rm-add title="${LZ.esc(t("connectServer"))}">${icon("plus")}</span></div>`;
      const saved = conns
        .map((c) => {
          const off = c.live ? `<span class="end" data-rm-off="${LZ.esc(c.id)}" title="${LZ.esc(t("disconnect"))}">${icon("eject")}</span>` : "";
          return `<button class="side-item" data-conn="${LZ.esc(c.id)}"><span class="ico" data-ico="${iconOf(c)}">${icon(iconOf(c))}</span><span class="label">${LZ.esc(c.name)}</span>${off}</button>`;
        })
        .join("");
      el.innerHTML = head + saved;
      mark();
    },
  });

  function mark() {
    const here = Panes.current()?.uri || "";
    const id = SERVER_SCHEMES.includes(schemeOf(here)) ? authorityOf(here) : null;
    for (const el of document.querySelectorAll('[data-section="remote"] [data-conn]')) el.classList.toggle("on", el.dataset.conn === id);
  }
  const coreMark = Sidebar.mark;
  Sidebar.mark = () => {
    coreMark();
    mark();
  };

  // What a server asks for on the way in. Resolves true when it is worth trying again. One question at a time per
  // connection, however many panes show it.
  const asking = new Map();
  function resolve(conn, error) {
    if (!asking.has(conn.id)) asking.set(conn.id, ask(conn, error).finally(() => asking.delete(conn.id)));
    return asking.get(conn.id);
  }

  async function ask(conn, error) {
    if (error.startsWith(PASSWORD)) {
      const password = await LZ.prompt(t("passwordFor", conn.name), { text: error.slice(PASSWORD.length), secret: true, ok: t("connect") });
      if (password == null) return false;
      try {
        const d = await LZ.call("remote.password", { id: conn.id, password });
        if (!d.kept) LZ.toast(t("secretNotKept"));
      } catch (e) {
        LZ.say(e);
      }
      return true;
    }
    if (error.startsWith(TRUST)) {
      const fingerprint = error.slice(TRUST.length);
      const ok = await LZ.confirm(t("trustTitle"), t("trustText", conn.port ? `${conn.host}:${conn.port}` : conn.host, fingerprint), t("trust"));
      if (!ok) return false;
      await LZ.call("remote.trust", { host: conn.host, port: conn.port || null, fingerprint }).catch(LZ.say);
      return true;
    }
    return false;
  }

  // Connects and opens the connection's folder in the focused pane, asking what the server needs on the way.
  async function open(conn) {
    for (let tries = 0; tries < 5; tries++) {
      try {
        const d = await LZ.call("remote.connect", { id: conn.id });
        Panes.open(d.uri);
        load();
        // A share mounted just now is a disk of Locations too.
        if (isLocal(d.uri)) Sidebar.loadVolumes();
        return;
      } catch (e) {
        const error = String(e);
        if (!(await resolve(conn, error))) {
          if (!error.startsWith(PASSWORD) && !error.startsWith(TRUST)) LZ.say(error);
          return;
        }
      }
    }
  }

  // A pane on a server that needs something lists again once it was given.
  LZ.on("view.error", async (d) => {
    const found = Panes.findTab(d.view);
    if (!found) return;
    const [pane, tab] = found;
    if (!SERVER_SCHEMES.includes(schemeOf(tab.uri))) return;
    const error = String(d.error);
    if (!error.startsWith(PASSWORD) && !error.startsWith(TRUST)) return;
    if (error.startsWith(TRUST)) {
      tab.error = t("hostKeyNew");
      if (pane.tab === tab) pane.renderAll();
    }
    await loaded;
    const conn = byId(authorityOf(tab.uri));
    if (conn && (await resolve(conn, error))) pane.refresh();
  });

  // The sheet that adds or edits a connection.
  const panel = LZ.sheet.create("serverSheet", { small: true });
  const row = (f, label, input) => `<div class="rm-row" data-f="${f}"><label data-t="${label}"></label>${input}</div>`;
  panel.innerHTML = `
    <h2 class="rm-title"></h2>
    <div class="rm-grid">
      ${row("kind", "serverKind", `<select class="rm-kind">${KINDS.map(([k, , label]) => `<option value="${k}"${WORDS.has(label) ? ` data-t="${label}"` : ""}>${label}</option>`).join("")}</select>`)}
      ${row("name", "serverName", '<input data-v="name" spellcheck="false">')}
      ${row("host", "serverHost", '<input data-v="host" spellcheck="false" placeholder="nas.local">')}
      ${row("port", "serverPort", '<input data-v="port" inputmode="numeric" spellcheck="false">')}
      ${row("endpoint", "serverEndpoint", '<input data-v="endpoint" spellcheck="false" placeholder="https://minio.local:9000">')}
      ${row("region", "serverRegion", '<input data-v="region" spellcheck="false">')}
      ${row("user", "serverUser", '<input data-v="user" spellcheck="false" autocomplete="off">')}
      ${row("secret", "serverPassword", '<input data-v="secret" type="password" autocomplete="off">')}
      ${row("keyFile", "serverKeyFile", '<input data-v="keyFile" spellcheck="false" placeholder="~/.ssh/id_ed25519">')}
      ${row("path", "serverFolder", '<input data-v="path" spellcheck="false">')}
      ${row("bucket", "serverBucket", '<input data-v="bucket" spellcheck="false">')}
      ${row("guest", "serverGuest", '<input data-v="guest" type="checkbox">')}
      ${row("cloud", "cloudKind", `<select class="rm-cloud">${Object.entries(CLOUDS).map(([k, label]) => `<option value="${k}">${label}</option>`).join("")}</select>`)}
      ${row("cloudName", "cloudName", '<input class="rm-cloud-name" spellcheck="false" placeholder="gdrive">')}
    </div>
    <div class="rm-help"></div>
    <div class="rm-note"></div>
    <div class="buttons"><button class="push" data-rm="test" data-t="tryConnect"></button><button class="push" data-rm="cancel" data-t="cancel"></button><button class="push primary" data-rm="save"></button></div>`;
  const q = (s) => panel.querySelector(s);
  const field = (name) => panel.querySelector(`[data-v="${name}"]`);
  let editing = null;

  // Shows the fields of the chosen kind, with the words that kind uses.
  function paint() {
    const kind = q(".rm-kind").value;
    const s3 = ["s3", "s3c", "oss"].includes(kind);
    const mounted = ["smb", "afp", "nfs", "dav", "davs"].includes(kind);
    const shown = {
      name: kind !== "rclone",
      host: !s3 && kind !== "rclone",
      port: !s3 && kind !== "rclone",
      endpoint: kind === "s3c",
      region: s3,
      user: kind !== "rclone" && kind !== "nfs",
      secret: kind !== "rclone" && kind !== "nfs",
      keyFile: kind === "sftp",
      path: kind !== "rclone" && !s3,
      bucket: s3,
      guest: kind === "smb" || kind === "afp",
      cloud: kind === "rclone",
      cloudName: kind === "rclone",
    };
    for (const el of panel.querySelectorAll(".rm-row")) el.hidden = el.dataset.f !== "kind" && !shown[el.dataset.f];
    const label = (f, word) => (panel.querySelector(`.rm-row[data-f="${f}"] label`).dataset.t = word);
    label("user", s3 ? "serverAccessKey" : "serverUser");
    label("secret", s3 ? "serverSecretKey" : kind === "sftp" ? "serverPassphrase" : "serverPassword");
    label("path", kind === "smb" || kind === "afp" ? "serverShare" : mounted ? "serverPath" : "serverFolder");
    field("port").placeholder = PORTS[kind] ? String(PORTS[kind]) : "";
    field("region").placeholder = kind === "oss" ? "cn-hangzhou" : `us-east-1 (${t("optional")})`;
    field("bucket").placeholder = t("optional");
    field("secret").placeholder = editing ? t("keepSecret") : "";
    field("path").placeholder = kind === "smb" || kind === "afp" ? "Public" : mounted ? "/" : `/ (${t("optional")})`;
    q('[data-rm="test"]').hidden = mounted || kind === "rclone";
    q('[data-rm="save"]').dataset.t = kind === "rclone" ? "signIn" : "saveConnect";
    q(".rm-help").innerHTML = kind === "rclone" ? `<p>${LZ.esc(t("rcloneNote"))}</p>` : "";
    q(".rm-note").textContent = "";
    applyLang();
  }
  q(".rm-kind").addEventListener("change", paint);

  function show(conn) {
    editing = conn || null;
    q(".rm-title").dataset.t = conn ? "editServer" : "connectServer";
    q(".rm-kind").value = conn ? kindOf(conn) : "sftp";
    q(".rm-kind").disabled = !!conn;
    for (const name of ["name", "host", "endpoint", "region", "user", "keyFile", "path", "bucket"]) field(name).value = conn?.[name] || "";
    field("port").value = conn?.port || "";
    field("secret").value = "";
    field("guest").checked = !!conn?.guest;
    LZ.sheet.open("serverSheet");
    paint();
    // Whether rclone is installed may have changed since the list was loaded.
    load().then(() => q(".rm-kind").value === "rclone" && paint());
    setTimeout(() => (conn ? field("name") : q(".rm-kind")).focus(), 30);
  }

  // The connection the form describes, as remote.save takes it.
  function described() {
    const kind = q(".rm-kind").value;
    const scheme = KINDS.find(([k]) => k === kind)[1];
    const port = parseInt(field("port").value, 10);
    const c = { id: editing?.id || "", scheme, port: port > 0 && port < 65536 ? port : null, guest: field("guest").checked };
    for (const name of ["name", "host", "region", "user", "keyFile", "path", "bucket"]) c[name] = field(name).value.trim();
    c.endpoint = kind === "s3c" ? field("endpoint").value.trim() : "";
    return c;
  }

  async function test() {
    const note = q(".rm-note");
    const connection = described();
    note.classList.remove("good");
    note.textContent = "...";
    for (let tries = 0; tries < 3; tries++) {
      try {
        await LZ.call("remote.test", { connection, secret: field("secret").value || null });
        note.textContent = t("connectionWorks");
        note.classList.add("good");
        return;
      } catch (e) {
        const error = String(e);
        if (error.startsWith(TRUST)) {
          // The question is a sheet of its own, which closes this one until it is answered.
          const trusted = await ask(connection, error);
          LZ.sheet.open("serverSheet");
          if (trusted) continue;
        }
        note.textContent = error.replace(/^LZ-[A-Z]+:/, "");
        return;
      }
    }
  }

  async function save() {
    const kind = q(".rm-kind").value;
    const note = q(".rm-note");
    if (kind === "rclone") {
      LZ.sheet.close();
      return signIn(q(".rm-cloud").value, q(".rm-cloud-name").value.trim());
    }
    if (kind === "s3c" && !field("endpoint").value.trim()) return (note.textContent = `${t("serverEndpoint")}?`);
    try {
      const secret = field("secret").value;
      const d = await LZ.call("remote.save", { connection: described(), secret: secret || null });
      if (!d.kept) LZ.toast(t("secretNotKept"));
      LZ.sheet.close();
      await load();
      open(d.connection);
    } catch (e) {
      note.textContent = String(e);
    }
  }

  panel.addEventListener("click", (e) => {
    const act = e.target.closest("[data-rm]")?.dataset.rm;
    if (act === "cancel") LZ.sheet.close();
    else if (act === "test") test();
    else if (act === "save") save();
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("input")) save();
  });

  section.el.addEventListener("click", (e) => {
    if (e.target.closest("[data-rm-add]")) return show(null);
    const off = e.target.closest("[data-rm-off]");
    if (off) {
      e.stopPropagation();
      return LZ.call("remote.disconnect", { id: off.dataset.rmOff }).then(load, LZ.say);
    }
    const item = e.target.closest("[data-conn]");
    const conn = item && byId(item.dataset.conn);
    if (conn) open(conn);
  });
  section.el.addEventListener("contextmenu", async (e) => {
    const item = e.target.closest("[data-conn]");
    const conn = item && byId(item.dataset.conn);
    if (!conn) return;
    e.preventDefault();
    const choice = await LZ.choose(
      [
        { id: "connect", label: t("connect"), icon: "server.rack" },
        { id: "edit", label: t("editServer"), icon: "pencil" },
        { id: "off", label: t("disconnect"), icon: "eject", enabled: !!conn.live },
        { separator: true },
        { id: "delete", label: t("deleteServer"), icon: "trash" },
      ],
      e.clientX,
      e.clientY,
    );
    if (choice === "connect") open(conn);
    else if (choice === "edit") show(conn);
    else if (choice === "off") LZ.call("remote.disconnect", { id: conn.id }).then(load, LZ.say);
    else if (choice === "delete" && (await LZ.confirm(t("deleteServer"), t("deleteServerText", conn.name), t("deleteServer")))) LZ.call("remote.delete", { id: conn.id }).then(load, LZ.say);
  });

  Panes.actions.connectServer = () => show(null);
  Keys.add({ "Cmd+K": "connectServer" });
  LZ.on("app.hello", () => S.window.role === "main" && load());
  // Clouds whose apps were signed in to meanwhile, and connections made in another window, show when the window comes
  // forward.
  window.addEventListener("focus", () => S.window.role === "main" && load());
  return { load, open };
})();
