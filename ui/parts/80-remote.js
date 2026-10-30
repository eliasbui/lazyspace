// Server connections (W8): the Servers section of the sidebar (saved connections, and the clouds rclone has), the
// sheet that adds or edits a connection, and what a server asks for on the way in: a password, or trust in a key it
// shows for the first time. Cmd+K opens the sheet, as Finder's "Connect to Server".
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
    hostKeyNew: "Máy chủ này chưa được tin.", cloudKind: "Dịch vụ", cloudName: "Tên (chữ không dấu)", openTerminal: "Mở Terminal để đăng nhập",
    rcloneMissing: "Cần cài rclone để dùng Google Drive, Dropbox, OneDrive. Mở Terminal và chạy:", copyCommand: "Chép lệnh",
    rcloneNext: "Hoàn tất đăng nhập trong Terminal; đám mây sẽ hiện trong mục Máy chủ.", rcloneNote: "rclone đăng nhập bằng trình duyệt và giữ tài khoản trong cấu hình của nó.",
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
    hostKeyNew: "This server is not trusted yet.", cloudKind: "Service", cloudName: "Name (plain letters)", openTerminal: "Open Terminal to Sign In",
    rcloneMissing: "rclone is needed for Google Drive, Dropbox and OneDrive. Open Terminal and run:", copyCommand: "Copy Command",
    rcloneNext: "Finish signing in in Terminal; the cloud then shows under Servers.", rcloneNote: "rclone signs in with the browser and keeps the account in its own configuration.",
  },
});
LZ.icons.add({
  server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4.5" width="16" height="6.5" rx="1.8"/><rect x="4" y="13" width="16" height="6.5" rx="1.8"/><path d="M7.5 7.75h.01M7.5 16.25h.01" stroke-width="2.4" stroke-linecap="round"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="5" width="17" height="11" rx="2"/><path d="M12 16v3.5M7 19.5h10"/></svg>',
  bucket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><ellipse cx="12" cy="6.5" rx="7.5" ry="2.5"/><path d="M4.5 6.5l1.8 11.2c.2 1.3 2.7 2.3 5.7 2.3s5.5-1 5.7-2.3l1.8-11.2"/></svg>',
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
  let loaded = null;

  const byId = (id) => conns.find((c) => c.id === id);
  const kindOf = (c) => (c.scheme === "s3" && c.endpoint ? "s3c" : c.scheme);
  const iconOf = (c) => (["s3", "oss"].includes(c.scheme) ? "bucket" : ["smb", "afp", "nfs", "dav", "davs"].includes(c.scheme) ? "share" : "server");

  function load() {
    loaded = LZ.call("remote.list")
      .then((d) => {
        conns = d.connections;
        rclone = d.rclone;
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

  // The sidebar section.
  const section = LZ.sidebar.section({
    id: "remote",
    render(el) {
      if (S.window.role !== "main") return;
      const head = `<div class="side-head"><span>${LZ.esc(t("servers"))}</span><span class="end" data-rm-add title="${LZ.esc(t("connectServer"))}">${icon("plus")}</span></div>`;
      const saved = conns
        .map((c) => {
          const off = c.live ? `<span class="end" data-rm-off="${LZ.esc(c.id)}" title="${LZ.esc(t("disconnect"))}">${icon("eject")}</span>` : "";
          return `<button class="side-item" data-conn="${LZ.esc(c.id)}"><span class="ico">${icon(iconOf(c))}</span><span class="label">${LZ.esc(c.name)}</span>${off}</button>`;
        })
        .join("");
      const clouds = (rclone.remotes || []).map((r) => `<button class="side-item" data-uri="rclone://${encodeURIComponent(r)}/"><span class="ico">${icon("icloud")}</span><span class="label">${LZ.esc(r)}</span></button>`).join("");
      el.innerHTML = head + saved + clouds;
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
      cloud: kind === "rclone" && rclone.installed,
      cloudName: kind === "rclone" && rclone.installed,
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
    q('[data-rm="save"]').dataset.t = kind === "rclone" ? "openTerminal" : "saveConnect";
    q('[data-rm="save"]').disabled = kind === "rclone" && !rclone.installed;
    const help = q(".rm-help");
    if (kind === "rclone" && !rclone.installed) {
      help.innerHTML = `<p>${LZ.esc(t("rcloneMissing"))}</p><div class="rm-command"><code>brew install rclone</code><button class="push" data-rm="copy" data-t="copyCommand"></button></div>`;
    } else help.innerHTML = kind === "rclone" ? `<p>${LZ.esc(t("rcloneNote"))}</p>` : "";
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
      const name = q(".rm-cloud-name").value.trim();
      return LZ.call("remote.rclone_add", { kind: q(".rm-cloud").value, name })
        .then(() => {
          LZ.sheet.close();
          LZ.toast(t("rcloneNext"));
        })
        .catch((e) => (note.textContent = String(e)));
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
    else if (act === "copy") LZ.call("clipboard.text", { text: "brew install rclone" }).then(() => LZ.toast(t("copied")), LZ.say);
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
  // Clouds added in Terminal, and connections made in another window, show when the window comes forward.
  window.addEventListener("focus", () => S.window.role === "main" && load());
  return { load, open };
})();
