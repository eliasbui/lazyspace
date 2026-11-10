# MIGRATION: LazySpace to Tauri 2, React, shadcn/ui and Liquid Glass

Branch `tauri-react`, from `main` = `c1994a1` (Release 0.4.6). This file is the memory of the migration: re-read it, and `PARITY.md`, after any compaction before doing anything else.

Owner rule (set during Stage 1): the agent writes code and compiles (`cargo check --all-targets`, `pnpm typecheck`); it does not run tests, builds, the app or any window. Master runs every test, build and visual check at the gates. Each stage report lists what was not verified.

## 0. Baseline (before any change)

- `cargo test` on the untouched branch at `c1994a1` (run before the owner rule above): `test result: ok. 166 passed; 0 failed; 4 ignored` (170 tests; log kept at `/tmp/ls-stage0/baseline-test.log`, not in the repository).
- Rust 1.99.0, Cargo 1.99.0, Node 26.13.0, pnpm 12.18.0. Edition 2024, `rust-version = "1.93"` unchanged.
- Size of the old front end: `ui/index.html` 67 585 bytes (CSS, shell markup, core script) plus 61 files in `ui/parts/` (total 504 870 bytes with the index); 18 000 lines of Rust in 64 files.
- Protocol: 132 methods in 32 areas (the brief says about 137; the dispatcher registers 132 real ones, three more exist only in unit tests), 34 distinct events from Rust.
- Words: 621 keys in the Vietnamese table and the same 621 in the English one (checked by a script over `index.html` and all `words({...})` calls: no key is missing on either side).

## 1. How Stage 1 is built (decisions)

1. Layout: `git mv` of `src`, `Cargo.toml`, `Cargo.lock`, `build.rs` into `src-tauri/`. `assets/` and `ui/` stay at the root (the release scripts and the classic page read them) until Stage 3.
2. The event loop is Tauri's. The `App` and the `Dispatcher` live in a thread-local on the main thread (`Host` in `main.rs`); `with_host` runs a closure with them and then makes the windows that were asked for. Other threads reach them through `Proxy::send`, which is `AppHandle::run_on_main_thread`. A call that arrives while the host is in use waits in a queue and runs after (a window made inside a handler can raise an event at once).
3. `WindowId` is the app's own type (a number); Tauri's label for the window is `lz-<id>`. `UserEvent::Ipc` is gone: the page calls one synchronous Tauri command, `ipc(body)`, which runs on the main thread and feeds `Dispatcher::handle`. Answers and events still go back as `app.receive(...)` evaluated in the page.
4. The classic page is served by Tauri from `src-tauri/classic/index.html`, written by `src-tauri/build.rs` from `ui/index.html` and `ui/parts` (not committed). The look attributes that `page()` used to write on `<html>` are set by a script injected before the page (`compat_script`).
5. Finding: wry puts a frozen, non-writable `window.ipc` on every page and Tauri reads what it receives as its own messages, so `window.ipc.postMessage` cannot be replaced from a script. `build.rs` rewrites the page's five calls to `window.lazyHost.postMessage(`, and `compat_script` defines `window.lazyHost`. This is the whole compatibility layer; it goes in Stage 3.
6. Glass: `glass::attach` calls `window_vibrancy::apply_liquid_glass` (macOS 26 and later) or `apply_vibrancy` with the Sidebar material, on main windows only, as `glass.rs` did. It lays one view over the whole window under the page, where the old code laid a 420 pt strip along the left; the page is opaque everywhere but its sidebar, so they look the same. Not looked at (rule above).
7. `Info.plist` keys of `scripts/bundle-macos.sh` are all in `src-tauri/Info.plist`; the three `*.strings` files are bundle resources (`bundle.resources`). Tauri adds `LSRequiresCarbon`, `CSResourcesFileMapped` and `LSApplicationCategoryType` (new, harmless).

## 2. (a) Protocol inventory

Request `{id, method: "area.verb", args}`, answer `{id, ok, data | error}`, event `{event, data}` through `window.app.receive`. Arguments are the fields of the typed struct each handler reads with `ipc::args` (nothing means no arguments or the whole value is read as it comes). "Result hint" is the last `Ok(...)` of the handler, a pointer for Stage 2; the source is the truth. "Page" says whether the classic page calls the method with a literal name.

| Method | Rust (src-tauri/src) | Arguments | Result hint | Page |
|---|---|---|---|---|
| `actions.list` | `features/actions.rs:133` | - | `` | yes |
| `actions.run` | `features/actions.rs:144` | id: String, folder: String, uris: Vec<String> | `Ok(json!({ "job": job }))` | yes |
| `actions.save` | `features/actions.rs:134` | actions: Vec<Action> | `Ok(json!(actions))` | yes |
| `app.drag` | `ipc.rs:139` | - | `Ok(Value::Null)` | no literal call |
| `app.drawn` | `ipc.rs:126` | - | `Ok(Value::Null)` | yes |
| `app.log` | `ipc.rs:131` | message: String | `Ok(Value::Null)` | no literal call |
| `app.new_window` | `ipc.rs:151` | uri: Option<String> | `Ok(json!({ "window": id.0 }))` | yes |
| `app.open_url` | `ipc.rs:160` | url: String | `Ok(Value::Null)` | yes |
| `app.ready` | `ipc.rs:122` | - | `Ok(Value::Null)` | yes |
| `app.zoom` | `ipc.rs:145` | - | `Ok(Value::Null)` | no literal call |
| `archive.create` | `features/archive/mod.rs:619` | format: String, name: Option<String>, password: Option<String>, level: Option<u8>, split_mb: u64 | `Ok(json!({ "job": job }))` | yes |
| `archive.extract` | `features/archive/mod.rs:579` | to: Option<String> | `Ok(json!({ "job": job }))` | yes |
| `archive.password` | `features/archive/mod.rs:564` | uri: String, password: String | `Ok(Value::Null)` | yes |
| `clipboard.copy` | `browse.rs:661` | - | `Ok(Value::Null)` | yes |
| `clipboard.cut` | `browse.rs:667` | - | `Ok(Value::Null)` | yes |
| `clipboard.paste` | `browse.rs:673` | to: String, mv: bool | `Ok(json!({ "job": job }))` | yes |
| `clipboard.state` | `browse.rs:695` | - | `Ok(json!({ "cut": cut }))` | yes |
| `clipboard.text` | `interact.rs:129` | text: String | `Ok(Value::Null)` | yes |
| `desktop.enable` | `features/desktop.rs:136` | on: bool, hide_finder_icons: bool | `Ok(Value::Null)` | yes |
| `desktop.move` | `features/desktop.rs:169` | view: String, names: Vec<String>, col: u32, row: u32, cols: u32, rows: u32 | `Ok(json!({ "cells": cells }))` | yes |
| `desktop.place` | `features/desktop.rs:157` | view: String, cols: u32, rows: u32 | `Ok(json!({ "cells": cells }))` | yes |
| `desktop.state` | `features/desktop.rs:135` | - | `` | no literal call |
| `devices.install` | `features/devices.rs:37` | app: String, eject: bool | `Ok(json!({ "job": job }))` | yes |
| `devices.open_app` | `features/devices.rs:66` | app: String | `let Ok(dir) = fs::read_dir(volume) else { return (Vec::new(), Vec::new()) };` | yes |
| `devices.phones` | `features/phones.rs:147` | - | `Ok(Box::new(DeviceFile { key: phone.key, path: uri.path.clone(), size: node.size, offset: ...` | yes |
| `disk.map` | `features/disk.rs:181` | - | `Ok(json!({ "job": job }))` | no literal call |
| `disk.twins` | `features/disk.rs:191` | - | `Ok(json!({ "job": job }))` | no literal call |
| `drag.arm` | `interact.rs:39` | - | `Ok(Value::Null)` | yes |
| `drag.disarm` | `interact.rs:45` | - | `Ok(Value::Null)` | no literal call |
| `fs.complete` | `browse.rs:429` | text: String | `Ok(json!({ "items": complete(&args::<Complete>(a)?.text) }))` | yes |
| `fs.copy` | `browse.rs:533` | from: Vec<String>, to: String, mv: bool, mode: Option<String> | `Ok(json!({ "job": job }))` | yes |
| `fs.create_file` | `browse.rs:481` | uri: String, name: String, text: String | `Ok(entry)` | no literal call |
| `fs.delete` | `browse.rs:590` | - | `Ok(json!({ "job": job }))` | no literal call |
| `fs.list` | `browse.rs:326` | view: String, uri: String, sort: Option<Sort>, show_hidden: Option<bool> | `Ok(json!({ "request": request }))` | yes |
| `fs.mkdir` | `browse.rs:453` | uri: String, name: Option<String> | `` | yes |
| `fs.read_text` | `browse.rs:621` | uri: String, max: u64 | `Ok(json!({ "text": String::from_utf8_lossy(&bytes), "truncated": truncated, "mtime": entry...` | yes |
| `fs.rename` | `browse.rs:508` | uri: String, name: String | `Ok(entry)` | yes |
| `fs.sizes` | `browse.rs:414` | view: String, on: bool | `Ok(Value::Null)` | yes |
| `fs.stat` | `browse.rs:445` | uri: String | `` | yes |
| `fs.subfolders` | `browse.rs:437` | uri: String | `off_main(app, &uri.clone(), move // Ok(json!({ "items": subfolders(&uri)? })))` | yes |
| `fs.trash` | `browse.rs:558` | - | `Ok(json!({ "job": job }))` | yes |
| `fs.undo` | `browse.rs:612` | - | `Ok(json!({ "job": job }))` | yes |
| `fs.undo_title` | `browse.rs:620` | - | `` | no literal call |
| `fs.write_text` | `browse.rs:639` | uri: String, text: String, mtime: Option<i64> | `if let (Some(expected), Ok(now)) = (a.mtime, provider.stat(&uri)) {` | yes |
| `git.status` | `features/git.rs:79` | uri: String | `defer(app, move // Ok(status(&folder)))` | yes |
| `hash.start` | `features/hash.rs:103` | - | `Ok(json!({ "job": job }))` | yes |
| `history.add` | `features/history.rs:58` | uri: String, typed: bool | `Ok(Value::Null)` | yes |
| `history.clear` | `features/history.rs:84` | - | `Ok(json!([]))` | yes |
| `history.list` | `features/history.rs:57` | - | `` | yes |
| `history.remove` | `features/history.rs:73` | uri: String | `Ok(json!(places))` | yes |
| `index.rebuild` | `features/index.rs:369` | - | `Ok(Value::Null)` | yes |
| `index.search` | `features/index.rs:348` | q: String, under: Option<String>, limit: Option<usize> | `Ok(json!({ "items": items, "ready": hits.is_some() }))` | yes |
| `index.state` | `features/index.rs:365` | - | `Ok(json!({ "ready": s.ready, "building": s.building, "count": s.items.len() }))` | yes |
| `jobs.answer` | `browse.rs:720` | id: u64, answer: Answer, apply_all: bool | `Ok(Value::Null)` | yes |
| `jobs.cancel` | `browse.rs:712` | id: u64 | `Ok(Value::Null)` | yes |
| `jobs.list` | `browse.rs:700` | - | `` | no literal call |
| `jobs.pause` | `browse.rs:701` | id: u64, paused: bool | `Ok(Value::Null)` | yes |
| `lanes.available` | `features/lanes.rs:82` | - | `` | yes |
| `lanes.send` | `features/lanes.rs:83` | uris: Vec<String> | `Ok(json!({ "sent": send(&paths)? }))` | yes |
| `menu.show` | `interact.rs:92` | items: Vec<MenuNode>, x: f64, y: f64, uris: Vec<String> | `Ok(Value::Null)` | yes |
| `menuedit.get` | `features/menuedit.rs:39` | - | `` | yes |
| `menuedit.set` | `features/menuedit.rs:40` | layout: MenuLayout | `Ok(Value::Null)` | yes |
| `native.apps_for` | `browse.rs:776` | uri: String | `` | no literal call |
| `native.eject` | `browse.rs:795` | path: String, force: bool | `` | yes |
| `native.fonts` | `browse.rs:810` | - | `` | yes |
| `native.full_disk` | `browse.rs:760` | - | `Ok(json!({ "granted": full_disk_granted(&[user.as_path(), Path::new("/Library/Application ...` | yes |
| `native.get_info` | `browse.rs:788` | - | `Ok(Value::Null)` | yes |
| `native.home` | `browse.rs:811` | - | `Ok(_) => return true,` | yes |
| `native.office_apps` | `browse.rs:772` | - | `Ok(json!({ "word": at("com.microsoft.Word"), "excel": at("com.microsoft.Excel"), "powerpoi...` | yes |
| `native.open` | `browse.rs:732` | - | `Ok(Value::Null)` | yes |
| `native.open_full_disk` | `browse.rs:764` | - | `if opened.success() { Ok(Value::Null) } else { Err(tr("Kh?ng m? ?c C?i ?t h? th?ng", "Syst...` | yes |
| `native.open_with` | `browse.rs:748` | app: String | `Ok(Value::Null)` | yes |
| `native.quicklook` | `interact.rs:49` | index: usize | `Ok(Value::Null)` | yes |
| `native.reveal` | `browse.rs:784` | - | `Ok(Value::Null)` | yes |
| `native.share` | `interact.rs:71` | uris: Vec<String>, x: f64, y: f64 | `Ok(Value::Null)` | yes |
| `native.volumes` | `browse.rs:794` | - | `` | yes |
| `openin.add` | `features/openin.rs:152` | path: String, kind: String | `Ok(Value::Null)` | no literal call |
| `openin.open` | `features/openin.rs:125` | tool: Option<String>, kind: Option<String>, uri: String | `Ok(Value::Null)` | yes |
| `openin.tools` | `features/openin.rs:124` | - | `` | yes |
| `panes.state` | `ipc.rs:186` | state: Value | `Ok(Value::Null)` | yes |
| `preview.info` | `features/preview.rs:124` | uri: String | `Ok(Value::Null)` | yes |
| `remote.clouds` | `features/remote/mod.rs:464` | - | `Ok(json!(storage::clouds(&home).into_iter().map(/c/ json!({ "name": c.name, "account": c.a...` | yes |
| `remote.connect` | `features/remote/mod.rs:390` | id: String | `` | yes |
| `remote.delete` | `features/remote/mod.rs:377` | id: String | `Ok(Value::Null)` | yes |
| `remote.disconnect` | `features/remote/mod.rs:398` | id: String | `None => Ok(Value::Null),` | yes |
| `remote.list` | `features/remote/mod.rs:335` | - | `Ok(json!({ "connections": list, "rclone": { "installed": installed, "remotes": remotes, "a...` | yes |
| `remote.onedrive_app` | `features/remote/mod.rs:472` | - | `` | yes |
| `remote.onedrive_open` | `features/remote/mod.rs:473` | - | `` | yes |
| `remote.password` | `features/remote/mod.rs:420` | id: String, password: String | `Ok(json!({ "kept": keep(&a.id, &a.password) }))` | yes |
| `remote.rclone_add` | `features/remote/mod.rs:479` | kind: String, name: String, advanced: rclone::Advanced | `Ok(json!({ "job": job }))` | yes |
| `remote.rclone_install` | `features/remote/mod.rs:499` | - | `Ok(std::cell::Cell::new(true))` | yes |
| `remote.rclone_remove` | `features/remote/mod.rs:492` | name: String | `` | yes |
| `remote.save` | `features/remote/mod.rs:353` | connection: Connection, secret: Option<String> | `Ok(json!({ "connection": saved, "kept": kept }))` | yes |
| `remote.test` | `features/remote/mod.rs:411` | connection: Connection, secret: Option<String> | `` | yes |
| `remote.trust` | `features/remote/mod.rs:449` | host: String, port: Option<u16>, fingerprint: String | `Ok(Value::Null)` | yes |
| `rename.apply` | `features/rename.rs:312` | - | `Ok(json!({ "job": job }))` | yes |
| `rename.preview` | `features/rename.rs:302` | - | `Ok(json!({ "rows": shown, "total": rows.len(), "problems": problems, "changed": changed })...` | yes |
| `settings.choose_folder` | `ipc.rs:178` | prompt: String | `` | yes |
| `settings.get` | `ipc.rs:168` | - | `` | no literal call |
| `settings.set` | `ipc.rs:169` | patch: Value | `` | yes |
| `stash.add` | `features/stash.rs:255` | uris: Vec<String> | `change(app, /items/ Ok(json!({ "added": add(items, &paths, false) })))` | yes |
| `stash.add_clipboard` | `features/stash.rs:276` | - | `Ok(json!({ "added": added }))` | yes |
| `stash.add_data` | `features/stash.rs:263` | name: Option<String>, text: Option<String>, url: Option<String>, base64: Option<String> | `change(app, /items/ Ok(json!({ "added": add(items, &[path], true) })))` | yes |
| `stash.clear` | `features/stash.rs:297` | - | `Ok(Value::Null)` | yes |
| `stash.count` | `features/stash.rs:304` | - | `` | yes |
| `stash.items` | `features/stash.rs:305` | - | `` | yes |
| `stash.remove` | `features/stash.rs:286` | uris: Vec<String> | `Ok(Value::Null)` | yes |
| `stash.show` | `features/stash.rs:313` | on: Option<bool> | `Ok(Value::Null)` | yes |
| `sync.apply` | `features/sync.rs:318` | left: String, right: String, steps: Vec<Step> | `Ok(json!({ "job": job }))` | yes |
| `sync.compare` | `features/sync.rs:291` | left: String, right: String, options: Options | `Ok(json!({ "job": job }))` | yes |
| `tags.set` | `features/tags.rs:14` | uris: Vec<String>, colour: u8, on: bool | `Ok(Value::Null)` | yes |
| `templates.add` | `features/templates.rs:147` | uri: String | `Ok(Value::Null)` | yes |
| `templates.create` | `features/templates.rs:122` | uri: String, id: String | `` | yes |
| `templates.folder` | `features/templates.rs:142` | - | `Ok(json!(Uri::file(&dir).to_string()))` | yes |
| `templates.list` | `features/templates.rs:121` | - | `` | yes |
| `update.check` | `ipc.rs:194` | manual: bool | `Ok(Value::Null)` | yes |
| `update.install` | `ipc.rs:203` | - | `Ok(Value::Null)` | yes |
| `update.relaunch` | `ipc.rs:207` | - | `` | yes |
| `view.close` | `browse.rs:401` | view: String | `Ok(Value::Null)` | yes |
| `view.filter` | `browse.rs:363` | view: String, text: String | `Ok(json!({ "generation": generation, "count": count, "groups": app.views.get(&a.view, wind...` | yes |
| `view.find` | `browse.rs:383` | view: String, prefix: String | `Ok(json!({ "index": app.views.find(&a.view, window, &a.prefix)? }))` | yes |
| `view.hidden` | `browse.rs:373` | view: String, show: bool | `Ok(json!({ "generation": generation, "count": count, "groups": app.views.get(&a.view, wind...` | yes |
| `view.index_of` | `browse.rs:392` | view: String, name: String | `Ok(json!({ "index": app.views.index_of(&a.view, window, &a.name)? }))` | yes |
| `view.rows` | `browse.rs:342` | view: String, start: usize, count: usize, generation: u64 | `` | yes |
| `view.sort` | `browse.rs:353` | view: String, sort: Sort | `Ok(json!({ "generation": generation, "groups": app.views.get(&a.view, window)?.groups() })...` | yes |
| `viewer.enable` | `features/viewer.rs:112` | on: bool | `` | yes |
| `viewer.reveal` | `features/viewer.rs:128` | uris: Vec<String> | `Ok(Value::Null)` | yes |
| `viewer.state` | `features/viewer.rs:111` | - | `` | yes |
| `workspaces.delete` | `features/workspaces.rs:97` | id: String | `Ok(Value::Null)` | yes |
| `workspaces.list` | `features/workspaces.rs:70` | - | `` | yes |
| `workspaces.rename` | `features/workspaces.rs:83` | id: String, name: String | `Ok(Value::Null)` | yes |
| `workspaces.save` | `features/workspaces.rs:71` | name: String, state: Value | `` | yes |

### Events from the app to the page

| Event | Sent from | Payload (first line) |
|---|---|---|
| `app.hello` | `main.rs:493` | `json!({` |
| `desktop.screens` | `features/desktop.rs:131` | `Value::Null));` |
| `devices.files` | `features/phones.rs:143` | `json!({ "key": key, "uri": uri_of(&key) })) });` |
| `devices.installed` | `features/devices.rs:59` | `done.clone()));` |
| `devices.phones` | `features/phones.rs:116` | `json!(phones())) });` |
| `devices.removed` | `features/devices.rs:99` | `json!({ "id": id })) });` |
| `drop` | `interact.rs:179` | `json!({ "x": position.x, "y": position.y, "uris": uris, "mode": mode })));` |
| `drop.leave` | `interact.rs:183` | `Value::Null));` |
| `drop.over` | `interact.rs:162` (+1) | `json!({ "x": position.x, "y": position.y })));` |
| `hash.started` | `features/hash.rs:110` | `json!({ "job": job })));` |
| `jobs.ask` | `jobs.rs:112` | `json!({ "id": self.id, "question": question.to_json() })));` |
| `jobs.finished` | `jobs.rs:195` (+1) | `finished)),` |
| `jobs.paused` | `browse.rs:709` | `json!({ "id": a.id, "paused": a.paused })));` |
| `jobs.progress` | `jobs.rs:103` | `json!({ "id": self.id, "done": done, "total": total, "current": current })));` |
| `jobs.started` | `jobs.rs:176` | `json!({ "id": id, "kind": kind, "title": title })) });` |
| `menu.action` | `main.rs:606` | `json!({ "id": other })));` |
| `menu.chosen` | `interact.rs:122` | `json!({ "id": id })),` |
| `menu.closed` | `interact.rs:120` (+1) | `Value::Null)` |
| `preview.ready` | `features/preview.rs:133` (+1) | `info),` |
| `remote.changed` | `features/remote/mod.rs:302` | `Value::Null) });` |
| `settings.changed` | `main.rs:554` | `settings));` |
| `stash.changed` | `features/stash.rs:233` | `json!({ "count": count })));` |
| `theme.changed` | `main.rs:660` | `json!({ "theme": theme_name(theme) }))));` |
| `toast` | `browse.rs:740` (+1) | `json!(tr("?ang m? b?n sao t?m; s?a trong ? kh?ng ?c l?u ng?c l?n m?y ch?", "Opening a temporary copy; chan` |
| `update.available` | `main.rs:622` | `json!({ "current": check.current, "latest": check.latest, "notes": check.notes, "installable": check.installab` |
| `update.error` | `main.rs:624` (+1) | `json!({ "error": error })),` |
| `update.none` | `main.rs:623` | `json!({ "current": check.current })),` |
| `update.progress` | `main.rs:638` | `json!(percent)) });` |
| `update.ready` | `main.rs:642` | `Value::Null),` |
| `view.changed` | `browse.rs:134` | `changed));` |
| `view.error` | `browse.rs:142` | `json!({ "view": view, "error": error })));` |
| `view.sizes` | `sizes.rs:96` | `json!({ "view": view, "generation": generation, "sizes": sizes })));` |
| `viewer.show` | `features/viewer.rs:59` | `json!({ "uri": Uri::file(&r.folder).to_string(), "names": r.names }))).collect();` |
| `volumes.changed` | `features/devices.rs:117` | `data) });` |

Events the page handles that Rust does not name literally: `devices.device`, `devices.volume` (sent through a helper with the name as an argument) and `hash.result` (named in a format string). `contextmenu`, `pointerdown`, `render` and `selection` are the page's own events (`LZ.emit`).

## 3. (b) Host inventory

| Id | Host item | Old code (c1994a1) | New code |
|---|---|---|---|
| H01 | Main window: size 1100x720 or the saved size, minimum 640x420, transparent title bar, hidden title, full-size content view, traffic lights at (20, 20), theme from Settings | src/main.rs `create_surface` | src-tauri/src/main.rs `create_surface` (WebviewWindowBuilder, TitleBarStyle::Overlay) |
| H02 | Desktop window: no decorations, transparent, on every Space, pinned to the desktop icon level, one per run | src/main.rs, src/native/panel.rs `pin_to_desktop`, src/features/desktop.rs | same files; `pin_to_desktop` takes a Tauri window |
| H03 | Shelf window: no decorations, transparent, always on top, right edge of the main screen, 264x440 | src/main.rs `create_surface` (Role::Shelf), src/features/stash.rs `show` | same |
| H04 | Main window hidden until the page says `app.drawn`, with a 3 s fallback | src/main.rs `page_drawn`, `create_surface` | same |
| H05 | Window drag (`app.drag`) and zoom (`app.zoom`) from the toolbar | src/ipc.rs | src-tauri/src/ipc.rs (`start_dragging`, `maximize`/`unmaximize`) |
| H06 | Menu bar: App, File, Edit, View, Go, Window, Help, both languages, rebuilt on a language change; Window and Help registered with the system | src/menus.rs (muda) | src-tauri/src/menus.rs (tauri::menu) |
| H07 | Menu actions: Settings, New Window (Cmd+N), Close Window (Cmd+Shift+W), Quit (Cmd+Q), the two Help links handled by the app; every other id is `menu.action` to the page of the front main window | src/main.rs `menu` | same, `App::menu` |
| H08 | Icon in the menu bar while Settings `background` is on: Open, New Window, Quit for Good; made again on a language change | src/menus.rs `tray`, src/main.rs `sync_tray` | src-tauri/src/menus.rs `tray`; id `lazyspace-tray`; the menu events go through the one global handler |
| H09 | Background mode: Quit and closing the last main window hide every window but the desktop; the app leaves the Dock | src/main.rs `hide_all`, `close_or_hide` | same |
| H10 | Activation policy Regular or Accessory as windows show and hide | src/main.rs `set_in_dock` (NSApplication) | same (NSApplication directly) |
| H11 | Dock icon click with no window: bring the windows back or open a main window | tao `Event::Reopen` | `RunEvent::Reopen { has_visible_windows: false }` |
| H12 | Last window closed does not quit the app | event loop never exited on window close | `RunEvent::ExitRequested { code: None }` is prevented |
| H13 | Open-documents events (reveal from another app, folders): kept until the first main window exists | tao `Event::Opened`, `opened_early` | `RunEvent::Opened`, `early()` |
| H14 | Services: "Open in LazySpace" provider object (`LZServices`) | src/native/services.rs, registered by src/features/viewer.rs `on_start` | same; the NSServices entry is in src-tauri/Info.plist |
| H15 | Custom protocol `lazy://` : `icon`, `symbol`, `thumb`, `file` (allow-listed, with ranges) | src/protocol.rs (wry asynchronous protocol) | src-tauri/src/protocol.rs (`register_asynchronous_uri_scheme_protocol`) |
| H16 | Navigation: only the page itself; web links open in the browser; new windows refused | src/main.rs `allow_navigation`, `with_new_window_req_handler` | `on_navigation`, `on_new_window` |
| H17 | Files dragged in: pointer position while over, drop with paths and copy/move mode from the modifier keys | src/interact.rs `drop_handler` (wry) | src-tauri/src/interact.rs `watch_drops` (`WebviewEvent::DragDrop`) |
| H18 | Files dragged out (Finder, other apps, other panes): armed on press, started from the first drag event | src/native/drag.rs | same; the web view comes from `native::web_view` |
| H19 | Quick Look panel on Space, per window | src/native/quicklook.rs | same; the NSWindow comes from `native::ns_window` |
| H20 | Native context menu (NSMenu) from a data tree, Open With, SF Symbols | src/native/menu.rs, src/contextmenu.rs, src/interact.rs `menu.show` | same |
| H21 | Share sheet | src/native/share.rs | same |
| H22 | Liquid Glass behind the page | src/glass.rs (own NSGlassEffectView / NSVisualEffectView strip) | src-tauri/src/glass.rs (window-vibrancy) |
| H23 | Theme: window follows Settings theme; `theme.changed` on a system change | src/main.rs `window_theme`, `WindowEvent::ThemeChanged` | `set_theme`, `WindowEvent::ThemeChanged` |
| H24 | Updater: check, download, verify SHA-256, swap the app in place, relaunch; the app's own GitHub client | src/update.rs | unchanged |
| H25 | File watcher (FSEvents through notify), debounced, one re-list per touched tab | src/fswatch.rs | unchanged except the proxy type |
| H26 | Volumes and devices: mount and unmount notifications, eject, USB and Image Capture phones and cameras | src/native/devices.rs, camera.rs, src/features/devices.rs, phones.rs | unchanged except the proxy type |
| H27 | Trash (NSFileManager), tags, workspace (reveal, open with, default apps, file viewer role), clipboard (pasteboard) | src/native/trash.rs, tags.rs, workspace.rs, src/clipboard.rs | unchanged |
| H28 | Screen changes re-pin the desktop window | src/native/panel.rs `on_screens_changed` | unchanged |
| H29 | Environment overrides: `LAZYSPACE_SETTINGS` (settings.json and layout.json beside it); `LAZYSPACE_FOLDER` for actions; tests use `LZ_TEST_*` | src/settings.rs | unchanged. New, hidden: `LAZYSPACE_NO_FOCUS`, `LAZYSPACE_TRACE_IPC` |
| H30 | Keychain items for server secrets (service `com.eliasbui.lazyspace`) | src/features/remote/keychain use | unchanged |
| H31 | External tools by absolute path: bsdtar, open, ditto, diskutil, hdiutil, defaults, osascript, mdfind, lsof, killall, rclone, unar, 7zz | various | unchanged |
| H32 | Bundle identity: id `com.eliasbui.lazyspace`, executable `lazyspace`, product `LazySpace`, version from Cargo.toml, icon `AppIcon` | scripts/bundle-macos.sh | src-tauri/tauri.conf.json (`productName`, `identifier`, `mainBinaryName`), Cargo.toml version, icons/AppIcon.icns |
| H33 | Info.plist keys: NSServices, CFBundleDocumentTypes (Folder, alternate), CFBundleLocalizations, five usage descriptions, LSMinimumSystemVersion 13.0, NSHighResolutionCapable; `en.lproj`/`vi.lproj` strings | scripts/bundle-macos.sh | src-tauri/Info.plist, src-tauri/lproj/*, `bundle.resources` |
| H34 | Content security policy (the old page had none; the brief asks for lazy: in img-src and ipc: for Tauri) | - | src-tauri/tauri.conf.json `app.security.csp` |
| H35 | Single-instance lock | none | none |
| H36 | Autostart / login item | none | none |
| H37 | Notifications of the system | none (device notes are drawn by the page) | none |
| H38 | Power actions | none | none |
| H39 | Release, signing and packaging scripts | scripts/*.sh (ad hoc or "LazySpace Code Signing" identity, universal binary, zip with ditto, latest.json) | not touched in Stage 1 (Stage 3) |

## 4. (c) UI inventory

The old page is `ui/index.html` plus `ui/parts/*` joined in file-name order; its plug-in API is `LZ` (design.md 6.4, defined in `07-core-ext.js`). Per source part: the i18n keys it adds (`words({...})`), and what it registers. The words of Vietnamese and English are identical in keys everywhere.

| Part | Bytes | Word keys | Menu items (id [label key]) | Sheets | Toolbar | Settings sections | Sidebar sections |
|---|---|---|---|---|---|---|---|
| `index.html` | 67585 | 50 | - | - | - | - | - |
| `parts/00-core-icons.js` | 2916 | 0 | - | - | - | - | - |
| `parts/01-core-format.js` | 5219 | 6 | - | - | - | - | - |
| `parts/02-core-sidebar.js` | 15193 | 28 | - | - | - | - | - |
| `parts/03-core-panes.js` | 102009 | 53 | - | - | - | - | - |
| `parts/04-core-toolbar.js` | 7975 | 0 | - | - | - | - | - |
| `parts/05-core-keys.js` | 6289 | 0 | - | - | - | - | - |
| `parts/06-core-jobs.js` | 5515 | 18 | - | - | - | - | - |
| `parts/07-core-ext.js` | 15212 | 10 | - | - | layout | - | - |
| `parts/08-core-menu.js` | 6762 | 25 | - | - | - | - | - |
| `parts/09-core-start.js` | 767 | 0 | - | - | - | - | - |
| `parts/10-workspaces.js` | 3337 | 8 | - | - | - | - | workspaces |
| `parts/11-keyboard.js` | 1686 | 5 | - | - | - | keyboard | - |
| `parts/12-menuedit.js` | 6831 | 7 | - | menuEditSheet, iconPickSheet | - | contextmenu | - |
| `parts/13-appearance.js` | 9112 | 32 | - | - | - | appearance | - |
| `parts/14-commands.js` | 13419 | 0 | copyToOther [cmd.copyToOther], moveToOther [cmd.moveToOther] | paletteSheet | - | - | - |
| `parts/15-finder.js` | 5705 | 7 | revealHere [m.revealHere] | - | - | viewer | - |
| `parts/16-settings.js` | 5729 | 2 | - | - | - | - | - |
| `parts/17-explorer.js` | 4352 | 8 | - | - | more | - | - |
| `parts/18-access.js` | 2848 | 6 | - | - | - | - | - |
| `parts/19-search.js` | 14191 | 37 | - | - | - | search | - |
| `parts/20-templates.js` | 2966 | 4 | newFile [newFile], addTemplate [addTemplate] | - | newFile | - | - |
| `parts/21-openin.js` | 2836 | 3 | - | - | - | - | - |
| `parts/22-hash.js` | 3935 | 8 | hash [hashMenu] | hashSheet | - | - | - |
| `parts/25-columns.js` | 9732 | 5 | - | - | - | - | - |
| `parts/26-tags.js` | 2680 | 9 | tags [m.tags] | - | - | - | tags |
| `parts/27-share.js` | 1409 | 2 | share [m.share] | - | share | - | - |
| `parts/28-actions.js` | 5499 | 15 | actions [m.actions] | - | - | actions | - |
| `parts/29-disk.js` | 11412 | 14 | diskMap [diskMap], findTwins [findTwins] | diskSheet, twinsSheet | - | - | - |
| `parts/30-sync.js` | 10123 | 30 | sync [syncMenu], comparePanes [comparePanes] | syncSheet | - | - | - |
| `parts/31-git.js` | 1988 | 1 | - | - | - | - | - |
| `parts/32-devices.js` | 18861 | 44 | - | - | - | - | - |
| `parts/33-phones.js` | 5283 | 10 | - | - | - | - | phones |
| `parts/40-preview.js` | 10673 | 21 | - | - | preview | - | - |
| `parts/50-rename.js` | 10706 | 39 | batchRename [batchRename] | renameSheet | - | - | - |
| `parts/60-archive.js` | 7202 | 20 | extractHere [extractHere], extractTo [extractTo], compress [compress], extractSelected [extractSelected] | compressSheet | - | - | - |
| `parts/70-stash.js` | 10840 | 13 | stashAdd [stashAdd], stashRemove [stashRemove], stashClear [stashClear], downloadLanes [downloadLanes] | - | stash | - | stash |
| `parts/80-remote.js` | 34598 | 69 | - | serverSheet | - | - | cloud, remote |
| `parts/81-office.js` | 2242 | 4 | openInOffice | - | - | - | - |
| `parts/90-desktop.js` | 7185 | 8 | - | - | - | desktop | - |

### Word keys by part

- `index.html` (50): `settings`, `done`, `general`, `appearance`, `about`, `cancel`, `language`, `languageHint`, `theme`, `themeHint`, `system`, `light`, `dark`, `glassHint`, `foldersFirst`, `foldersFirstHint`, `folderSizes`, `folderSizesHint`, `alwaysTabs`, `alwaysTabsHint`, `copyQueue`, `copyQueueHint`, `verifyCopies`, `verifyCopiesHint`, `notifyDevices`, `notifyDevicesHint`, `background`, `backgroundHint`, `autoUpdate`, `autoUpdateHint`, `checkUpdate`, `checking`, `upToDate`, `updateOut`, `update`, `updating`, `updatingPct`, `updateReady`, `restart`, `updateNow`, `download`, `later`, `back`, `forward`, `asList`, `asIcons`, `newFolder`, `moveToTrash`, `searchHere`, `moreTools`
- `parts/01-core-format.js` (6): `today`, `yesterday`, `bytes`, `items`, `selectedOf`, `available`
- `parts/02-core-sidebar.js` (28): `bookmarks`, `locations`, `unpin`, `desktop`, `downloads`, `documents`, `movies`, `music`, `pictures`, `applications`, `trashName`, `eject`, `quickAccess`, `quickEmpty`, `pinQuick`, `unpinQuick`, `pinnedQuick`, `notFolder`, `moveUp`, `moveDown`, `openWeb`, `hideItem`, `showHidden`, `signOutCloud`, `signOutTitle`, `signOutText`, `signOutDone`, `appCloudNote`
- `parts/03-core-panes.js` (53): `colName`, `colModified`, `colSize`, `colKind`, `loading`, `emptyFolder`, `colCreated`, `colExt`, `colWhere`, `columnsMenu`, `groupNone`, `groupKind`, `groupDate`, `groupSize`, `noMatch`, `newTab`, `closeTab`, `filterPane`, `openPrivacy`, `duplicateTab`, `tabToWindow`, `tabToOtherPane`, `closeOtherTabs`, `closeTabsRight`, `enclosingFolder`, `refresh`, `recentPlaces`, `noHistory`, `clearHistory`, `noSubfolders`, `hiddenCrumbs`, `renameTab`, `resetTabName`, `tabColor`, `noColor`, `color.red`, `color.orange`, `color.yellow`, `color.green`, `color.blue`, `color.purple`, `color.gray`, `splitRight`, `splitDown`, `moveToPane`, `paneN`, `closePane`, `tooManyPanes`, `pathCopied`, `deleteTitle`, `deleteText`, `deleteNow`, `notAPath`
- `parts/06-core-jobs.js` (18): `conflictTitle`, `conflictText`, `conflictFolder`, `incoming`, `existing`, `applyAll`, `stop`, `skip`, `merge`, `pauseJob`, `resumeJob`, `jobPaused`, `replace`, `keepBoth`, `working`, `password`, `ok`, `yes`
- `parts/07-core-ext.js` (10): `layout`, `layout.single`, `layout.h2`, `layout.v2`, `layout.h3`, `layout.l1r2`, `layout.grid`, `layout.h4`, `layout.g6`, `layout.custom`
- `parts/08-core-menu.js` (25): `m.open`, `m.openWith`, `m.openTab`, `m.quickLook`, `m.getInfo`, `m.rename`, `m.duplicate`, `m.copyPath`, `m.copy`, `m.cut`, `m.paste`, `m.trash`, `m.delete`, `m.newFolder`, `m.reveal`, `m.view`, `m.sort`, `m.hidden`, `m.asList`, `m.asIcons`, `m.byName`, `m.byDate`, `m.bySize`, `m.byKind`, `m.groups`
- `parts/10-workspaces.js` (8): `workspaces`, `saveWorkspace`, `workspaceName`, `workspaceNameText`, `renameWorkspace`, `overwriteWorkspace`, `deleteWorkspace`, `workspaceSaved`
- `parts/11-keyboard.js` (5): `keyboard`, `keyStyle`, `keyStyleHint`, `keysMac`, `keysWindows`
- `parts/12-menuedit.js` (7): `contextMenu`, `contextMenuHint`, `resetMenu`, `lineAfter`, `line`, `chooseIcon`, `editMenu`
- `parts/13-appearance.js` (32): `colorsIcons`, `font`, `fontHint`, `fontSystem`, `fontRounded`, `fontSerif`, `fontMono`, `fontsMac`, `fontsApple`, `accentColor`, `accentHint`, `sidebarIcons`, `sidebarIconsHint`, `iconsMono`, `iconsColor`, `iconSize`, `iconSizeHint`, `textSize`, `textSizeHint`, `sizeSmall`, `sizeMedium`, `sizeLarge`, `sizeHuge`, `accent.system`, `accent.blue`, `accent.purple`, `accent.pink`, `accent.red`, `accent.orange`, `accent.yellow`, `accent.green`, `accent.graphite`
- `parts/15-finder.js` (7): `revealHere`, `m.revealHere`, `finderTitle`, `viewerOn`, `viewerOnHint`, `viewerPartly`, `viewerUnavailable`
- `parts/16-settings.js` (2): `searchSettings`, `noSettingMatch`
- `parts/17-explorer.js` (8): `m.openWindow`, `m.pin`, `m.unpin`, `m.select`, `m.selectAll`, `selectNone`, `invertSelection`, `moreActions`
- `parts/18-access.js` (6): `fullDiskTitle`, `fullDiskText`, `fullDiskOpen`, `fullDiskDone`, `fullDiskLater`, `fullDiskReopen`
- `parts/19-search.js` (37): `searchFor`, `searchIn`, `searchMac`, `searchContent`, `thisMac`, `recents`, `quickHits`, `sWhere`, `sKind`, `sDate`, `sSize`, `sContent`, `sAny`, `kind.`, `kind.folder`, `kind.image`, `kind.movie`, `kind.audio`, `kind.pdf`, `kind.document`, `kind.archive`, `kind.app`, `kind.code`, `date.today`, `date.week`, `date.month`, `date.year`, `size.1m`, `size.100m`, `size.1g`, `searchTitle`, `quickIndex`, `quickIndexHint`, `indexCount`, `indexBuilding`, `indexNotReady`, `reindex`
- `parts/20-templates.js` (4): `newFile`, `templatesFolder`, `addTemplate`, `templateAdded`
- `parts/21-openin.js` (3): `openTerminal`, `openEditor`, `otherApp`
- `parts/22-hash.js` (8): `hashTitle`, `hashMenu`, `hashCompare`, `hashMatch`, `hashNoMatch`, `hashWorking`, `copied`, `copy`
- `parts/25-columns.js` (5): `asColumns`, `asGallery`, `m.asColumns`, `m.asGallery`, `columnTooBig`
- `parts/26-tags.js` (9): `tagsTitle`, `m.tags`, `tag.1`, `tag.2`, `tag.3`, `tag.4`, `tag.5`, `tag.6`, `tag.7`
- `parts/27-share.js` (2): `share`, `m.share`
- `parts/28-actions.js` (15): `actionsTitle`, `m.actions`, `actionsHint`, `actionName`, `actionCommand`, `addAction`, `removeAction`, `when.any`, `when.files`, `when.folders`, `when.none`, `out.toast`, `out.terminal`, `out.none`, `actionDone`
- `parts/29-disk.js` (14): `diskMap`, `findTwins`, `diskTitle`, `measuring`, `diskUp`, `diskHint`, `twinsTitle`, `twinsNone`, `twinsSum`, `twinsGroup`, `pickExtra`, `pickNone`, `trashPicked`, `finding`
- `parts/30-sync.js` (30): `syncTitle`, `syncMenu`, `comparePanes`, `modeLtr`, `modeRtl`, `modeBoth`, `byTime`, `byContent`, `ignoreHidden`, `mirror`, `compare`, `doSync`, `syncSummary`, `syncTruncated`, `s.leftNewer`, `s.rightNewer`, `s.leftOnly`, `s.rightOnly`, `s.conflict`, `a.skip`, `a.ltr`, `a.rtl`, `a.deleteLeft`, `a.deleteRight`, `syncConfirm`, `syncConfirmText`, `comparing`, `allSame`, `swap`, `filterAll`
- `parts/31-git.js` (1): `gitBranch`
- `parts/32-devices.js` (44): `dev.kind.usb`, `dev.kind.card`, `dev.kind.thunderbolt`, `dev.kind.external`, `dev.kind.internal`, `dev.kind.network`, `dev.kind.image`, `dev.ready`, `dev.open`, `dev.close`, `dev.eject`, `dev.ejecting`, `dev.ejectFailed`, `dev.tryAgain`, `dev.forceEject`, `dev.forceTitle`, `dev.forceText`, `dev.notEjectable`, `dev.inImage`, `dev.appsInImage`, `dev.package`, `dev.install`, `dev.update`, `dev.installThis`, `dev.replace`, `dev.hasOlder`, `dev.hasNewer`, `dev.hasSame`, `dev.hasSome`, `dev.openApp`, `dev.runInstaller`, `dev.installing`, `dev.installStopped`, `dev.installed`, `dev.installedIn`, `dev.installedEjected`, `dev.installedNotEjected`, `dev.launch`, `dev.trashImage`, `dev.connected`, `dev.appleText`, `dev.cameraText`, `dev.mtpText`, `dev.browse`
- `parts/33-phones.js` (10): `ph.devices`, `ph.opening`, `ph.reading`, `ph.ready`, `ph.locked`, `ph.failed`, `ph.mtp`, `ph.waiting`, `ph.closed`, `ph.device`
- `parts/40-preview.js` (21): `preview`, `previewToggle`, `moveBottom`, `moveRight`, `pv.kind`, `pv.size`, `pv.created`, `pv.modified`, `pv.dims`, `pv.duration`, `pv.fps`, `pv.rate`, `pv.audio`, `pv.items`, `save`, `saved`, `truncated`, `dropChanges`, `nothing`, `many`, `unsaved`
- `parts/50-rename.js` (39): `batchRename`, `batchTitle`, `addRule`, `doRename`, `r.replace`, `r.insert`, `r.remove`, `r.number`, `r.parent`, `r.case`, `r.ext`, `find`, `replaceWith`, `regex`, `ignoreCase`, `scopeName`, `scopeExt`, `scopeAll`, `text`, `atStart`, `atEnd`, `atIndex`, `position`, `count`, `fromEnd`, `start`, `step`, `digits`, `separator`, `lower`, `upper`, `title`, `sentence`, `newExt`, `keepCase`, `previewSummary`, `moveUp`, `moveDown`, `removeRule`
- `parts/60-archive.js` (20): `extractHere`, `extractTo`, `extractSelected`, `compress`, `compressTitle`, `archiveName`, `archiveFormat`, `archivePassword`, `archivePasswordAgain`, `archiveLevel`, `levelFast`, `levelNormal`, `levelBest`, `splitVolumes`, `splitNone`, `passwordMismatch`, `passwordOnlyZip7z`, `chooseExtractFolder`, `archivePasswordTitle`, `doCompress`
- `parts/70-stash.js` (13): `stash`, `stashShow`, `stashAdd`, `stashRemove`, `stashClear`, `stashPaste`, `stashEmpty`, `stashClose`, `stashAdded`, `revealFinder`, `openItem`, `downloadLanes`, `lanesSent`
- `parts/80-remote.js` (69): `servers`, `connectServer`, `editServer`, `newServer`, `serverKind`, `serverName`, `serverHost`, `serverPort`, `serverUser`, `serverAccessKey`, `serverPassword`, `serverSecretKey`, `serverPassphrase`, `serverKeyFile`, `serverFolder`, `serverShare`, `serverPath`, `serverRegion`, `serverEndpoint`, `serverBucket`, `serverGuest`, `s3Compatible`, `cloudRclone`, `optional`, `keepSecret`, `tryConnect`, `saveConnect`, `connect`, `disconnect`, `deleteServer`, `deleteServerText`, `connectionWorks`, `secretNotKept`, `passwordFor`, `trustTitle`, `trust`, `trustText`, `hostKeyNew`, `cloudKind`, `cloudName`, `signIn`, `rcloneNote`, `clouds`, `addCloud`, `addService`, `otherCloud`, `signInBrowser`, `rcloneNeeded`, `installRclone`, `rcloneNeededText`, `onedriveApp`, `onedriveAppTitle`, `onedriveAppText`, `onedriveInstallTitle`, `onedriveInstallText`, `openOneDrive`, `openStore`, `onedriveWaiting`, `onedriveReady`, `cloudRecent`, `onedriveWork`, `cloudSite`, `cloudAdvanced`, `clientId`, `clientSecret`, `tenantId`, `siteHint`, `workNote`, `advancedNote`
- `parts/81-office.js` (4): `openInWord`, `openInExcel`, `openInPowerPoint`, `officeSyncs`
- `parts/90-desktop.js` (8): `desktop`, `desktopOn`, `desktopOnHint`, `hideFinderIcons`, `hideFinderIconsHint`, `hideFinderIconsAsk`, `hideFinderIconsText`, `restartFinder`

### Shell elements of `ui/index.html`

Elements with an id: `app`, `sidebar`, `sideScroll`, `sideQuick`, `sideBookmarks`, `sideLocations`, `sideResizer`, `toolbar`, `tbBack`, `tbForward`, `title`, `tbView`, `tbActions`, `tbNewFolder`, `tbTrash`, `tbOverflow`, `tbMore`, `tbSearch`, `tbSearchIcon`, `searchInput`, `paneGrid`, `settingsSheet`, `settingsSearchIcon`, `settingsSearch`, `settingsNav`, `settingsTitle`, `settingsDone`, `settingsBody`, `language`, `foldersFirst`, `folderSizes`, `alwaysTabs`, `copyQueue`, `verifyCopies`, `notifyDevices`, `background`, `theme`, `glass`, `version`, `updateNote`, `updateBar`, `updateNotes`, `checkUpdate`, `autoUpdate`, `settingsNone`, `conflictSheet`, `conflictTitle`, `conflictText`, `conflictCompare`, `conflictAll`, `confirmSheet`, `confirmTitle`, `confirmText`, `confirmNo`, `confirmYes`, `jobs`, `banner`, `bannerTxt`, `bannerLater`, `bannerBtn`, `toast`.

Elements translated by `data-t`: `settings`, `done`, `general`, `language`, `languageHint`, `foldersFirst`, `foldersFirstHint`, `folderSizes`, `folderSizesHint`, `alwaysTabs`, `alwaysTabsHint`, `copyQueue`, `copyQueueHint`, `verifyCopies`, `verifyCopiesHint`, `notifyDevices`, `notifyDevicesHint`, `background`, `backgroundHint`, `appearance`, `theme`, `themeHint`, `system`, `light`, `dark`, `glassHint`, `about`, `autoUpdate`, `autoUpdateHint`, `noSettingMatch`, `applyAll`, `stop`, `skip`, `merge`, `replace`, `keepBoth`, `cancel`, `later`.

### Keyboard shortcuts (`05-core-keys.js` `KEYMAPS`, plus `Keys.add` of the parts)

**mac** (47 chords): `Enter` = rename, `Space` = quickLook, `Tab` = nextPane, `Shift+Tab` = previousPane, `Cmd+1` = viewIcons, `Cmd+2` = viewList, `Cmd+3` = viewColumns, `Cmd+4` = viewGallery, `Cmd+Alt+1` = layoutSingle, `Cmd+Alt+2` = layoutH2, `Cmd+Alt+3` = layoutV2, `Cmd+Alt+4` = layoutH3, `Cmd+Alt+5` = layoutL1R2, `Cmd+Alt+6` = layoutGrid, `Cmd+Alt+7` = layoutH4, `Cmd+Alt+8` = layoutG6, `Cmd+\` = splitRight, `Cmd+Shift+\` = splitDown, `Cmd+D` = duplicate, `Cmd+I` = getInfo, `Cmd+Alt+C` = copyPath, `Cmd+Shift+R` = reveal, `Cmd+O` = open, `Cmd+ArrowDown` = open, `Cmd+ArrowUp` = enclosing, `Cmd+[` = back, `Cmd+]` = forward, `Cmd+Backspace` = trash, `Cmd+Alt+Backspace` = delete, `Cmd+Shift+N` = newFolder, `Cmd+A` = selectAll, `Cmd+C` = copy, `Cmd+X` = cut, `Cmd+V` = paste, `Cmd+Z` = undo, `Cmd+Shift+.` = toggleHidden, `Cmd+T` = newTab, `Cmd+W` = closeTab, `Cmd+L` = editAddress, `Cmd+Shift+G` = editAddress, `Cmd+F` = find, `Cmd+Alt+S` = toggleSidebar, `Cmd+Shift+H` = home, `Cmd+Shift+D` = desktop, `Cmd+Alt+L` = downloads, `Cmd+Shift+A` = applications, `Escape` = deselect

**windows** (41 chords): `Enter` = open, `Space` = quickLook, `Tab` = nextPane, `Shift+Tab` = previousPane, `Ctrl+1` = viewIcons, `Ctrl+2` = viewList, `Ctrl+3` = viewColumns, `Ctrl+4` = viewGallery, `Cmd+Alt+1` = layoutSingle, `Cmd+Alt+2` = layoutH2, `Cmd+Alt+3` = layoutV2, `Cmd+Alt+4` = layoutH3, `Cmd+Alt+5` = layoutL1R2, `Cmd+Alt+6` = layoutGrid, `Cmd+Alt+7` = layoutH4, `Cmd+Alt+8` = layoutG6, `Cmd+\` = splitRight, `Cmd+Shift+\` = splitDown, `Ctrl+D` = duplicate, `Alt+Enter` = getInfo, `Ctrl+Shift+C` = copyPath, `F2` = rename, `Delete` = trash, `Shift+Delete` = delete, `Backspace` = enclosing, `Alt+ArrowUp` = enclosing, `Alt+ArrowLeft` = back, `Alt+ArrowRight` = forward, `Ctrl+Shift+N` = newFolder, `Ctrl+A` = selectAll, `Ctrl+C` = copy, `Ctrl+X` = cut, `Ctrl+V` = paste, `Ctrl+Z` = undo, `Ctrl+H` = toggleHidden, `Ctrl+T` = newTab, `Ctrl+W` = closeTab, `Ctrl+L` = editAddress, `Ctrl+F` = find, `Cmd+Alt+S` = toggleSidebar, `Escape` = deselect

Keys added by parts: see the `Keys.add` calls in `07-core-ext.js`, `14-commands.js`, `11-keyboard.js` and the feature parts; user overrides live in `keymap.json`.

### Screens, sheets and states (named in the page)

- Window shell: sidebar (Bookmarks, features' sections, Locations with eject, Tags), toolbar (back/forward, view, new folder, trash, filter, overflow), panes (1 to 8 by layout and custom splits) with tabs, path bar (crumbs with folder menus, editable address with completion), list/icons/columns/gallery views over the virtual list, status line, jobs panel, toast, update banner.
- Sheets: Settings (General, Appearance, features' sections), conflict, password and confirm questions of jobs, prompt, confirm, and the sheets listed per part above (menu editor, commands, hash, disk map, twins, sync, rename, compress, remote connections).
- Windows by role from `app.hello.windowRole`: `main`, `desktop`, `shelf`. All three load the same page.
- Empty states and errors are word keys (`emptyFolder`, `loading`, the per-part error keys) and the `error` strings returned by Rust in the language of `tr()`.

## 5. (d) Parity

`PARITY.md` has one row per item of sections 2 to 4 (methods, events, host items, UI parts, menu items, sheets, toolbar items, settings sections, sidebar sections, shortcuts).

## 6. (e) Risks and the order of work

Risks, most serious first:

1. Drag and drop of things that are not files. Tauri's web view handler took every drag and never handed one back to WebKit, so text, links and pictures dragged from a browser onto the shelf (`70-stash.js` `fromData`, HTML5 `drop`) would no longer reach the page. Decision of master in Stage 2: carry a small patch of `tauri-runtime-wry` in a vendored copy (section 7). Written and compiled, not run: master verifies it at Gate 2 by dragging a link onto the shelf.
2. The window-vibrancy full-window glass layer and the traffic lights could not be looked at (owner rule). The library does not reparent the content view with the options used, so a crash like window-vibrancy issue 229 is not expected, but this is unverified. `tauri-plugin-liquid-glass` was not evaluated for the same reason; `window-vibrancy` stays the choice.
3. Ordering of events. Calls from other threads now arrive through `run_on_main_thread` and a queue; if a handler held the host while another call arrived, it runs after. Same order as the old event loop in the cases read, not stress tested.
4. `RunEvent::Opened` can arrive before `setup`; handled by `early()`, not exercised.
5. Positions of drag events: Tauri labels them physical, wry sends points on macOS; they are used as points, as before. Not exercised.
6. The release scripts, `smoke.sh` and `screenshots.sh` (which `pkill -x lazyspace`) are untouched; `viewer.rs` has a unit test that reads `src-tauri/Info.plist` instead of the bundle script.
7. Universal binary and the signing identity are Stage 3 work; the dev bundle was built once ad hoc (`pnpm tauri build --debug --bundles app`, signed with `-`, `codesign --verify --strict` ok, Info.plist keys read back with `plutil -p`).

Order of work: Stage 1 host (done, see report); Stage 2 per the brief: services and mock, i18n, stores, registry, sidebar, panes, toolbar and keys, then the features in the order of the old parts; Stage 3 cleanup and release scripts.

## 7. Stage 2: the front end

### The vendored `tauri-runtime-wry` (patch for risk 1)

- Version: `tauri-runtime-wry` 2.12.3, copied from the cargo registry into `src-tauri/vendor/tauri-runtime-wry/` and wired by `[patch.crates-io] tauri-runtime-wry = { path = "vendor/tauri-runtime-wry" }` in `src-tauri/Cargo.toml`.
- Change (one file, `src/lib.rs`, the drag and drop handler given to `wry::WebViewBuilder::with_drag_drop_handler`, 14 lines added and 1 changed): the handler used to end with `true`, which tells WebKit that the app handled the drag. It now answers `true` only for a drag whose `Enter` event carried file paths; `Over`, `Drop` and `Leave` repeat the answer of `Enter` (they carry no paths), kept in an `AtomicBool`. A drag with no file (text, a link, a picture) is therefore handed back to the web view and reaches the page as an HTML5 `drop`. Files are handled exactly as before: they still produce Tauri's `DragDrop` events, which `interact.rs` `watch_drops` turns into `drop.over`, `drop` and `drop.leave`.
- The exact diff is `src-tauri/vendor/tauri-runtime-wry.diff` (33 lines). To drop the patch: delete the `[patch.crates-io]` section and the `vendor` directory when Tauri ships the same behaviour.
- Not verified: no drag was performed (owner rule). Master checks at Gate 2.

### The three host rows that were open after Stage 1

- H17 (files dragged in): the patch above plus `watch_drops`; compiled, not run.
- H22 (glass): `window-vibrancy` kept as master decided; the plugin comparison is skipped. The page paints a veil of its own colour over the window material (`html.glass body`), and `app.hello` reports `glassAvailable`. It cannot be looked at (owner rule); master looks at Gate 2.
- H39 (release scripts): Stage 3 by the brief; nothing to do in Stage 2 except that `pnpm build` now produces `dist-web`, which `tauri.conf.json` serves.

### The page

- `src/` is the React page (see `docs/frontend.md` for the layout and the rules). `index.html` holds the root div and one module script. `LAZYSPACE_CLASSIC=1` makes the app serve `dist-web/classic.html` (the old page, written by `build.rs`) instead of the new one.
- Outside the app the page talks to a mock host (`src/services/mock`) so that it can be photographed.
- `src/architecture.test.ts` and `scripts/migration/check-protocol.mjs` (also `pnpm check:protocol`) are written and not run; master runs them at Gate 2.
