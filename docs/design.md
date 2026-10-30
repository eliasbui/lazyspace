# LazySpace: thiết kế kiến trúc và phân rã công việc

Tài liệu này là nguồn sự thật duy nhất cho các worker triển khai: F1, F2, F3 chạy tuần tự (một người viết trên nhánh
`main`), sau đó W1 đến W9 chạy song song, mỗi worker trong một git worktree riêng rẽ nhánh từ commit sau F3. Văn xuôi
tiếng Việt, định danh và mã bằng tiếng Anh. Mọi API và crate quan trọng đã được kiểm chứng bằng cách đọc nguồn trong
`~/.cargo/registry/src` hoặc bằng thí nghiệm; chỗ nào chưa kiểm chứng được ghi rõ "chưa kiểm chứng".

Tham chiếu mã nguồn tái dùng (MIT, cùng tác giả):

- Lanes: `/Users/bdthai/Desktop/lanes` (viết tắt `lanes/`).
- figghost: `/Users/bdthai/Desktop/figghost/crates/macos-sys/src` (viết tắt `fig/`).

## 1. Mục tiêu, phạm vi, ngoài phạm vi, nền tảng

Mục tiêu: một trình quản lý tệp thay Finder trên macOS với toàn bộ danh sách tính năng của người dùng: đa khung nhìn
(1 đến 4 pane), workspaces, thanh địa chỉ breadcrumb kiêm ô nhập có gợi ý, LazySpace Desktop, tạo tệp từ mẫu, mở
Terminal và editor, hash, so sánh và đồng bộ thư mục, side preview, chế độ phím tắt Windows, menu ngữ cảnh tùy biến,
dung lượng thư mục trong danh sách, kết nối máy chủ và đám mây, trình nén nâng cao, Stash Shelf, đổi tên hàng loạt.

Phạm vi kỹ thuật: tao 0.37 + wry 0.57 + WKWebView như Lanes; giao diện HTML/CSS/JS nhúng trong binary; objc2 0.6 cho
phần native; Liquid Glass (beta) tắt mặc định; vi (mặc định) và en; dữ liệu trong
`~/Library/Application Support/LazySpace`; cập nhật tại chỗ từ GitHub release; Homebrew cask `lazyspace` trong tap
`eliasbui/homebrew-lazyspace`.

Ngoài phạm vi: Windows và Linux; notarization; ký bằng Developer ID; đăng ký OAuth app cho các dịch vụ đám mây (đi
qua rclone); client SMB, AFP, NFS, WebDAV tự viết (macOS mount hộ); nén RAR (chỉ giải nén); đồng bộ hai chiều có
phát hiện xung đột ba chiều (chỉ hai chiều "mới hơn thắng" với xem trước); plugin của bên thứ ba (mọi extension đều
built in).

Nền tảng: macOS 13.0 trở lên (`LSMinimumSystemVersion` 13.0), universal binary aarch64 + x86_64, ký ad hoc, không
notarize. NSGlassEffectView chỉ có từ macOS 26; trước đó dùng NSVisualEffectView (mục 9). Máy build: macOS 27.2,
Rust 1.99, Command Line Tools SDK 27.2 (không có Xcode đầy đủ).

## 2. Stack và danh sách phụ thuộc

Nguyên tắc: I/O chặn trên thread như Lanes; không tokio ở lõi. Async chỉ xuất hiện trong W8 cho SFTP (russh) và được
nhốt trong một runtime `current_thread` của riêng kết nối đó (mục 7.6). Không thêm crate cho việc vài chục dòng làm
được. Mọi crate dưới đây có sẵn trong registry cục bộ trừ chỗ ghi "mới"; toàn bộ tập crate mới đã được `cargo check`
trong một crate nháp ngoài repo cho cả `aarch64-apple-darwin` và `x86_64-apple-darwin` (29 s và 19 s, không lỗi).

`Cargo.toml` của LazySpace (F1 tạo; W workers chỉ thêm vào neo của mình, mục 15.4):

| Crate | Phiên bản | Ai dùng | Lý do một dòng |
|---|---|---|---|
| tao | 0.37 | F1 | Cửa sổ, event loop, `EventLoopProxy`, theme; `WindowBuilderExtMacOS` cho title bar trong suốt và traffic light inset (verified `tao-0.37.2/src/platform/macos.rs`). |
| wry | 0.57 | F1 | WKWebView: `with_html`, `with_ipc_handler`, `with_custom_protocol`, `with_asynchronous_custom_protocol`, `with_drag_drop_handler`, `with_navigation_handler`, `with_transparent`; `WebViewExtMacOS::webview()` trả `Retained<WryWebView>` (NSView) cho objc2 (verified `wry-0.57.1/src/lib.rs`). |
| muda | 0.21 | F1 | Menu bar macOS (`Menu::init_for_nsapp`, `set_as_windows_menu_for_nsapp`, `MenuEvent::set_event_handler`), cùng phiên bản tray-icon 0.26 kéo vào trong Lanes; LazySpace không có tray icon nên dùng muda trực tiếp. |
| serde, serde_json | 1 | tất cả | Settings, IPC, tệp JSON. |
| objc2 | 0.6 | F1, F3 | `define_class!`, `msg_send!`, `MainThreadMarker`. |
| objc2-foundation | 0.3 | F1, F3 | NSString, NSURL, NSArray, NSFileManager. |
| objc2-app-kit | 0.3 | F1, F3, W7, W9 | NSWindow, NSGlassEffectView, NSVisualEffectView, NSWorkspace, NSDraggingSession, NSFilePromiseProvider, NSPasteboard, NSPanel, NSImage. Feature mặc định đã bật đủ 291 module (verified `objc2-app-kit-0.3.2/Cargo.toml`), nên khai báo `objc2-app-kit = "0.3"` như figghost. |
| objc2-web-kit | 0.3 | F1 | `WKWebView`, `WKUserContentController` cho handler `glass` và `drawsBackground`. |
| objc2-core-foundation | 0.3 | W8 | `CFURL::from_string`, `CFString::from_str`, `CFMutableDictionary` cho NetFS. |
| objc2-core-graphics | 0.3 | W9 | `kCGDesktopIconWindowLevel` (verified `generated/CGWindowLevel.rs:11`). |
| objc2-uniform-type-identifiers | 0.3 | F2, W4 | `UTType::typeWithFilenameExtension` cho icon theo đuôi tệp và MIME khi phục vụ xem trước. |
| objc2-av-foundation | 0.3 | W4 | `AVURLAsset::URLAssetWithURL_options`, `tracksWithMediaType` cho frame rate và data rate của video. |
| objc2-quick-look-ui | 0.3.2 (mới) | F3 | `QLPreviewPanel::sharedPreviewPanel`, `setDataSource`, `reloadData`; protocol `QLPreviewPanelDataSource` (verified `generated/QLPreviewPanel.rs`). |
| objc2-quick-look-thumbnailing | 0.3.2 (mới) | F2 | `QLThumbnailGenerator::sharedGenerator().generateBestRepresentationForRequest_completionHandler` cho thumbnail ảnh, video, PDF. |
| block2 | 0.6 | F1, F2, F3 | Block cho completion handler của AppKit và QuickLook. |
| dispatch2 | 0.3 | F2, F3 | `DispatchQueue::main().exec_async` để chạy lời gọi AppKit trên main thread từ worker (mục 3.4). |
| notify | 8.2 | F2 | FSEvents (feature mặc định `macos_fsevent`, verified `notify-8.2.0/Cargo.toml`). |
| notify-debouncer-full | 0.7 | F2 | Gộp sự kiện FS theo 300 ms (`new_debouncer`, `Debouncer::watch/unwatch`, verified). |
| security-framework | 3.7 | W8 | `set_generic_password`, `get_generic_password`, `delete_generic_password` (verified `src/passwords.rs`): bí mật chỉ nằm trong Keychain. |
| regex | 1.13 | W5 | Đổi tên hàng loạt bằng biểu thức chính quy. |
| sha1, sha2, md-5, crc32fast | 0.10, 0.10, 0.10 (mới), 1 | F1 (sha2 cho updater), W2 | Hash: cùng họ `digest` 0.10 nên một vòng lặp đọc tệp phục vụ cả bảy thuật toán; CRC32 bằng crc32fast. |
| hmac | 0.12 | W8 | HMAC-SHA256 cho chữ ký AWS SigV4 (S3, Aliyun OSS). |
| ureq | 3.4 | F1 (updater), W8 | HTTP chặn trên rustls; Lanes dùng ureq 2, LazySpace lấy bản 3 đã có trong registry. |
| quick-xml | 0.42 | W8 | Đọc XML của S3 `ListObjectsV2`. |
| zip | 9.0 | W6 | Đọc và ghi ZIP: `ZipWriter::start_file` với `with_aes_encryption`, `by_index_decrypt`, `enclosed_name` chống zip-slip (verified `src/read/zip_archive.rs`, `src/read/zipfile.rs`). Feature: `deflate`, `bzip2`, `lzma`, `xz`, `zstd`, `aes-crypto`, `time`. |
| sevenz-rust2 | 0.24 (mới) | W6 | Đọc và ghi 7z có mật khẩu: `ArchiveReader::open(path, Password)`, `for_each_entries`, `ArchiveWriter::create`, `set_content_methods`, `AesEncoderOptions::new(password)`, `set_encrypt_header` (verified `src/reader.rs`, `src/writer.rs`, `src/encoder_options.rs`). Feature: `compress`, `aes256`, `bzip2`. Yêu cầu Rust 1.93, máy có 1.99. |
| suppaftp | 12.2 (mới) | W8 | FTP và FTPS chặn: `FtpStream::connect`, `into_secure`, `login`, `mlsd`, `list`, `retr_as_stream`, `put_with_stream`, `mkdir`, `rm`, `rmdir`, `rename`, `size` (verified `src/sync_ftp.rs`). Feature `native-tls` (Security.framework, không OpenSSL). |
| russh | 0.65 (mới) | W8 | SSH thuần Rust. Bắt buộc `default-features = false, features = ["ring", "flate2", "rsa"]`: feature mặc định `aws-lc-rs` kéo `cmake` làm build-dependency mà máy không có (verified bằng `cargo tree -i cmake`; bản ring check sạch). |
| russh-sftp | 3.0 (mới) | W8 | `SftpSession::new`, `read_dir`, `open_with_flags`, `metadata`, `rename`, `remove_file`, `remove_dir`, `create_dir`; `File` là `AsyncRead + AsyncSeek` (verified `src/client/session.rs`, `src/client/fs/file.rs`). |
| tokio | 1 | W8 | Chỉ feature `rt`, `net`, `io-util`, `time`, `sync`; một runtime `current_thread` cho mỗi kết nối SFTP, không bao giờ chạm event loop. |
| png | 0.18 | F1 | Giải mã icon cửa sổ như Lanes `decode_png`. |
| dirs | 7 | F1 | Home, Downloads, Desktop. |

Không dùng: rusqlite (mọi thứ là JSON nhỏ), tray-icon, notify-rust, unrar (bsdtar đọc RAR), rust-s3 và aws-sdk (kéo
reqwest và tokio vào lõi; SigV4 tự viết khoảng 120 dòng), walkdir (đệ quy `read_dir` vài dòng và cần hủy giữa chừng),
tar/flate2/xz2/zstd (bsdtar lo), trash (mặc định của crate là osascript tới Finder, cần quyền Automation và chậm;
cách NSFileManager của crate không trả nơi tệp đã tới, mà Undo cần; gọi thẳng `trashItemAtURL` vài dòng, mục 8.5).

Công cụ hệ thống dùng qua `Command`: `/usr/bin/bsdtar` (libarchive 3.7.4, zlib, liblzma, bz2lib; đã thử đọc mẫu
RAR4, RAR5, 7z, zip64 của bộ test libarchive và ghi 7z), `/usr/bin/open`, `/usr/bin/ditto`, `/usr/bin/plutil`,
`/usr/bin/codesign`, `/usr/bin/osascript`, `/usr/sbin/diskutil`, `rclone` nếu có trong PATH hoặc
`/opt/homebrew/bin`, `unar` hoặc `7zz` nếu có (chỉ cho RAR có mật khẩu).

`build.rs`: chép nguyên `lanes/build.rs` bỏ phần Windows và ffmpeg: ghép `ui/parts/*.js|css` theo tên vào
`$OUT_DIR/parts.html`, cấm chuỗi `</script`.

`[profile.release]`: `lto = "thin"`, `codegen-units = 1`, `strip = true`; `[profile.dev.package."*"] opt-level = 2`
như Lanes.

## 3. Mô hình tiến trình và luồng

### 3.1 Main thread

Một tiến trình. `main()` tạo `EventLoopBuilder::<UserEvent>::with_user_event()`, một `App` sở hữu mọi cửa sổ, và
chạy vòng lặp như `lanes/src/main.rs`. Mọi lời gọi tao, wry (`evaluate_script`) và AppKit đều trên main thread.

```rust
enum UserEvent {
    Ipc { window: WindowId, body: String },   // từ with_ipc_handler của từng webview
    Post { window: Option<WindowId>, message: Value }, // None = phát cho mọi cửa sổ
    Job(jobs::Event),                          // tiến độ, câu hỏi, kết thúc (mục 3.3)
    Fs(fswatch::Change),                       // thay đổi thư mục đã gộp
    Menu(muda::MenuId),
    Main(Box<dyn FnOnce(&mut App) + Send>),    // việc cần App trên main thread
}
```

`App` giữ `HashMap<WindowId, Surface>`, `Surface { role: Main | Desktop | Shelf, window, webview, glass: GlassLayer }`.
Mỗi `with_ipc_handler` closure bắt `WindowId` của mình, nên trả lời luôn về đúng webview. `Cmd+N` mở thêm `Surface`
vai `Main`; W9 thêm `Desktop`, W7 thêm `Shelf`.

Mở và đóng cửa sổ: tao chỉ tạo cửa sổ khi có `EventLoopWindowTarget`, mà handler IPC không có. Nên
`App::open_surface(role, SurfaceOptions { uri, frame, transparent, always_on_top, decorations })` chỉ xếp yêu cầu vào
hàng và trả `SurfaceId`; vòng lặp sự kiện mở mọi yêu cầu đang chờ ngay sau mỗi sự kiện bằng `target` (F1).
`App::close_surface(id)` tương tự. W7 và W9 chỉ dùng hai hàm này cộng helpers `native::panel` của F3, không sửa
`main.rs`. Đóng cửa sổ chính cuối cùng không thoát app, theo kiểu Mac: icon Dock còn, `Event::Reopen {
has_visible_windows: false }` của tao mở lại một cửa sổ chính (verified `tao-0.37.2/src/event.rs:138`); `Cmd+Q` thoát.

### 3.2 Luồng nền

- `jobs`: một pool cố định 4 thread cho các việc dài (bảng dưới) cộng 2 thread cho dung lượng thư mục và thumbnail.
  Không đặt QoS (sẽ phải thêm libc); hai thread này chỉ `yield_now()` giữa các thư mục con để nhường.
- `fswatch`: thread của notify.
- `list`: liệt kê thư mục chạy trong `jobs` nhưng là job ngắn không hiện trong bảng tiến độ.
- W8: mỗi kết nối từ xa một thread sở hữu socket (và runtime tokio riêng với SFTP); lệnh gửi qua `mpsc`.

### 3.3 Hệ thống job chung (`src/jobs.rs`, F2)

Một hệ cho copy, move, trash, delete, dung lượng thư mục, hash (W2), sync (W3), batch rename (W5), nén và giải nén
(W6), truyền tệp từ xa (W8), gom Stash (W7).

```rust
pub struct JobId(u64);
pub struct Ctx {
    id: JobId,
    cancel: Arc<AtomicBool>,
    proxy: EventLoopProxy<UserEvent>,
    asks: Receiver<Answer>,           // câu trả lời của người dùng cho job này
    last_progress: Cell<Instant>,     // tiết lưu progress 10 lần/giây
}
impl Ctx {
    pub fn cancelled(&self) -> bool;
    pub fn progress(&self, done: u64, total: u64, current: &str);  // gửi Event::Progress nếu đã quá 100 ms
    pub fn ask(&self, question: Question) -> Answer;               // chặn thread job cho tới khi page trả lời
}
pub enum Question { Conflict { source: String, target: String, kinds: ConflictKinds }, Password { what: String }, Confirm { text: String } }
pub enum Answer { Replace, Skip, KeepBoth, Merge, Cancel, Text(String), Yes, No }  // kèm apply_all: bool
pub enum Event { Started { id, kind, title }, Progress { id, done, total, current }, Ask { id, question }, Finished { id, result: Result<Value, String> } }
pub fn spawn(kind: &'static str, title: String, f: impl FnOnce(&Ctx) -> Result<Value, String> + Send + 'static) -> JobId;
pub fn cancel(id: JobId);
pub fn answer(id: JobId, answer: Answer, apply_all: bool);
```

Luồng hỏi đáp: job gọi `ctx.ask(Conflict)`, `Event::Ask` lên main thread, `App` đẩy event `jobs.ask` cho cửa sổ đã
khởi tạo job, page mở sheet, người dùng chọn, page gọi `jobs.answer`, `App` gọi `jobs::answer`, thread job tiếp tục.
`apply_all` được `Ctx` nhớ nên các xung đột cùng loại sau đó không hỏi lại. Một job luôn kết thúc bằng
`Event::Finished`, kể cả khi bị hủy (`Err("cancelled")`), để page dọn hàng tiến độ.

### 3.4 Gọi AppKit chỉ trên main thread

Ba cách, chọn theo tình huống:

1. Trong handler IPC (đã ở main thread): gọi thẳng, có `MainThreadMarker::new().unwrap()`.
2. Từ thread job cần AppKit và `App`: `proxy.send_event(UserEvent::Main(Box::new(|app| ...)))`.
3. Từ thread job chỉ cần AppKit (icon, thumbnail): `dispatch2::DispatchQueue::main().exec_async(move || ...)` với
   `MainThreadMarker::new()` bên trong, kết quả trả về qua `mpsc` hoặc `RequestAsyncResponder` của wry.

`NSWorkspace.iconForFile` và `QLThumbnailGenerator` thực ra an toàn ngoài main thread theo tài liệu Apple, nhưng icon
của app gói (.app) đôi lúc cần main; để một quy tắc: `native::icon` luôn chạy qua cách 3, kết quả cache nên chi phí
không đáng kể.

## 4. Bố cục mã nguồn

Mỗi tệp một trách nhiệm. Lõi (F1 đến F3) ở `src/` và `ui/`; mỗi W worker sở hữu `src/features/<name>.rs` (hoặc thư
mục `src/features/<name>/`) và `ui/parts/<nn>-<name>.{js,css}`.

```
Cargo.toml                 F1; neo phụ thuộc cho từng W (mục 15.4)
build.rs                   F1; ghép ui/parts
assets/icon.png            F1; 1024x1024, nguồn cho iconutil
assets/icon-256.png        F1; icon cửa sổ
src/main.rs                F1; main(), App, Surface, vòng lặp sự kiện, mở cửa sổ, page(), tr(), ENGLISH
src/settings.rs            F1; Settings serde(default), load/save, data_dir()
src/ipc.rs                 F1; phong bì IPC, Dispatcher, đăng ký handler theo tiền tố, validate đối số
src/menus.rs               F1; menu bar macOS bằng muda (port lanes/src/menus.rs phần MenuBar)
src/update.rs              F1; port lanes/src/update.rs bỏ Windows, REPO/BUNDLE_ID/APP đổi tên
src/glass.rs               F1; GlassLayer: NSGlassEffectView hoặc NSVisualEffectView sau webview, veil, lay_glass
src/protocol.rs            F1; custom protocol lazy:// (icon, thumb, file, preview) và danh sách được phép
src/native/mod.rs          F1; helpers objc2 dùng chung: main thread, NSString/NSURL, png_of, ns_window(tao)
src/native/icons.rs        F2; icon và thumbnail có cache
src/native/workspace.rs    F2; reveal, open, open_with, apps_for, volumes, eject, launch terminal/editor
src/native/trash.rs        F2; trashItemAtURL, ghi nơi tệp tới cho Undo
src/native/drag.rs         F3; NSDraggingSession từ WKWebView, NSFilePromiseProvider
src/native/quicklook.rs    F3; QLPreviewPanel data source
src/native/panel.rs        F3; cửa sổ phụ: NSPanel nổi (W7) và cấp desktop (W9), từ tao Window
src/native/menu.rs         F3; NSMenu từ cây MenuNode, icon SF Symbols, Open With động, event menu.chosen
src/vfs/mod.rs             F2; Uri, Entry, Provider trait, Registry, capabilities
src/vfs/local.rs           F2; provider file://
src/vfs/copy.rs            F2; copy/move xuyên provider, xung đột, tiến độ
src/vfs/temp.rs            F2; bản sao tạm cục bộ cho mục từ xa hoặc trong archive
src/views.rs               F2; View = listing đã sắp xếp của một tab, cửa sổ hàng, sizes, lọc
src/fswatch.rs             F2; notify + debouncer, map đường dẫn -> views
src/jobs.rs                F2; mục 3.3
src/sizes.rs               F2; dung lượng thư mục nền, cache, hủy
src/clipboard.rs           F2; pasteboard tệp (copy/cut/paste với Finder)
src/keymap.rs              F3; bảng phím mặc định mac và windows, serde
src/contextmenu.rs         F3; MenuNode (serde, kiểm tra), MenuLayout từ menu.json, apply_layout (thứ tự, ẩn, icon)
src/features/mod.rs        F3; `pub fn register(d: &mut Dispatcher)` gọi register của từng feature
src/features/workspaces.rs W1
src/features/winkeys.rs    W1 (chế độ phím Windows: chỉ dữ liệu keymap + settings)
src/features/menuedit.rs   W1 (tùy biến menu ngữ cảnh)
src/features/templates.rs  W2
src/features/openin.rs     W2 (Terminal và editor)
src/features/hash.rs       W2
src/features/sync.rs       W3
src/features/preview.rs    W4
src/features/rename.rs     W5
src/features/archive/mod.rs, bsdtar.rs, zip.rs, sevenz.rs   W6
src/features/stash.rs      W7
src/features/remote/mod.rs, ftp.rs, sftp.rs, s3.rs, rclone.rs, netfs.rs, keychain.rs, connections.rs   W8
src/features/desktop.rs    W9
ui/index.html              F1 khung trang; F2, F3 thêm phần lõi; W không sửa
ui/parts/00-core-*.js      F2, F3 (list, panes, address bar, sidebar, menu, sheets) nếu tách khỏi index.html
ui/parts/10-workspaces.js|css   W1
ui/parts/11-winkeys.js          W1
ui/parts/12-menuedit.js|css     W1
ui/parts/20-templates.js|css    W2
ui/parts/21-openin.js           W2
ui/parts/22-hash.js|css         W2
ui/parts/30-sync.js|css         W3
ui/parts/40-preview.js|css      W4
ui/parts/50-rename.js|css       W5
ui/parts/60-archive.js|css      W6
ui/parts/70-stash.js|css        W7
ui/parts/80-remote.js|css       W8
ui/parts/90-desktop.js|css      W9
scripts/bundle-macos.sh, release.sh, update-cask.sh, install.sh, smoke.sh, screenshots.sh   F1
packaging/homebrew/lazyspace.rb, README.md   F1
docs/design.md             tài liệu này
README.md, README.vi.md    F1 (ngắn, theo kiểu Lanes)
```

## 5. Hợp đồng IPC

### 5.1 Phong bì

Giữ nguyên hình dạng của Lanes (`call` và `app.receive` trong `lanes/ui/index.html` dòng 593 đến 610) nhưng đổi `cmd`
thành `method` có tiền tố:

```json
{ "id": 7, "method": "fs.list", "args": { "uri": "file:///Users/me/Desktop", "view": "p0t2" } }
{ "id": 7, "ok": true, "data": { "count": 1243, "generation": 3 } }
{ "id": 7, "ok": false, "error": "Không có quyền đọc thư mục này" }
{ "event": "jobs.progress", "data": { "id": 12, "done": 3072, "total": 9000, "current": "a.mov" } }
```

`id` là số tăng dần trong page; trả lời luôn có `id`; sự kiện đẩy không có `id`. Lỗi là một câu tiếng người theo ngôn
ngữ hiện tại (`tr()`), không phải mã. Mọi `args` được đọc bằng `serde_json::from_value` vào struct có kiểu; thiếu hoặc
sai kiểu trả lỗi ngay, không panic (mục 12).

### 5.2 Dispatcher (`src/ipc.rs`)

```rust
pub type Handler = Box<dyn Fn(&mut App, WindowId, Value) -> Result<Value, String>>;
pub struct Dispatcher { exact: HashMap<&'static str, Handler> }
impl Dispatcher {
    pub fn on(&mut self, method: &'static str, h: impl Fn(&mut App, WindowId, Value) -> Result<Value, String> + 'static);
    pub fn call(&self, app: &mut App, window: WindowId, method: &str, args: Value) -> Result<Value, String>;
}
```

`main.rs` chỉ làm: `let mut d = Dispatcher::new(); core::register(&mut d); features::register(&mut d);`. Một handler
trả `Ok(Value::Null)` ngay và làm việc dài qua `jobs::spawn`, trả `{"job": id}`. Vì handler nhận `&mut App`, nó có thể
`app.post(window, event)` hoặc `app.post_all(event)`. Feature không bao giờ sửa `main.rs`: nó chỉ có
`pub fn register(d: &mut Dispatcher)` trong tệp của mình, được `features/mod.rs` (F3 tạo sẵn) gọi.

`Dispatcher::on_start(hook: impl Fn(&mut App) + 'static)` (F1): hook chạy một lần khi vòng lặp bắt đầu
(`StartCause::Init`), trước khi cửa sổ chính hiện. W9 dùng để mở desktop surface khi `settings.desktop.on`, W7 để mở lại
shelf nếu lần trước đang mở. Đây là cách duy nhất một feature chạy mã lúc khởi động.

Quy tắc đặt tên: `<area>.<verb>` chữ thường, area là tên module: lõi dùng `app`, `fs`, `view`, `jobs`, `native`,
`settings`, `panes`, `menu`; feature dùng tên của mình: `workspaces.save`, `archive.list`, `remote.connect`,
`stash.add`. Sự kiện cũng vậy: `jobs.progress`, `view.changed`, `archive.ready`.

### 5.3 Phương thức lõi

Kiểu dùng chung:

```json
Entry: { "name": "a.txt", "uri": "file:///x/a.txt", "kind": "file|dir|link|app|volume", "size": 1234, "mtime": 1719999999,
         "ctime": 1719990000, "hidden": false, "ext": "txt", "perm": "rw-r--r--", "dirSize": null, "icon": "lazy://icon/32/file%3A%2F%2F%2Fx%2Fa.txt" }
Selection: { "names": ["a.txt", "b"] } hoặc { "all": true, "except": ["c"] }
Sort: { "by": "name|size|mtime|kind|ext", "desc": false, "foldersFirst": true }
```

| Phương thức | Args | Kết quả | Ghi chú |
|---|---|---|---|
| `app.ready` | `{}` | đẩy `app.hello { version, theme, settings, keymap, menu, features: [..], windowRole, glassAvailable }` | như Lanes `ready`; `features` là danh sách feature đã đăng ký để page bật phần tương ứng |
| `app.drag` / `app.zoom` | `{}` | null | kéo cửa sổ từ toolbar, port Lanes `"drag" \| "zoom"` |
| `app.new_window` | `{ "uri"? }` | `{ "window": 3 }` | Cmd+N |
| `app.open_url` | `{ "url" }` | null | chỉ http, https, mailto qua `NSWorkspace.openURL` |
| `settings.get` | `{}` | Settings | |
| `settings.set` | `{ "patch": {..} }` | Settings | gộp từng khóa, lưu, đẩy `settings.changed` cho mọi cửa sổ; đổi `theme` gọi `window.set_theme`, đổi `glass` gọi `GlassLayer::set` |
| `settings.choose_folder` | `{ "prompt" }` | đường dẫn hoặc null | NSOpenPanel |
| `fs.list` | `{ "view", "uri", "sort"?, "showHidden"? }` | `{ "count", "generation", "capabilities" }` | tạo hoặc thay listing của view (mục 6.3); nội dung lấy bằng `view.rows` |
| `view.rows` | `{ "view", "start", "count", "generation" }` | `{ "rows": [Entry], "generation" }` | cửa sổ hàng; generation lệch trả lỗi `stale` để page xin lại |
| `view.sort` | `{ "view", "sort" }` | `{ "generation" }` | sắp xếp trong Rust |
| `view.filter` | `{ "view", "text" }` | `{ "count", "generation" }` | lọc nhanh theo tên khi gõ |
| `view.find` | `{ "view", "prefix" }` | `{ "index" }` | gõ chữ nhảy tới mục |
| `view.index_of` | `{ "view", "name" }` | `{ "index" }` | chọn lại sau khi đổi tên |
| `view.close` | `{ "view" }` | null | bỏ watch và size job |
| `fs.stat` | `{ "uri" }` | Entry | |
| `fs.mkdir` | `{ "uri", "name" }` | Entry | tên "untitled folder" theo ngôn ngữ |
| `fs.create_file` | `{ "uri", "name", "bytes"? (base64) }` | Entry | W2 dùng cho mẫu |
| `fs.rename` | `{ "uri", "name" }` | Entry | từ chối tên chứa `/` hoặc rỗng; trùng tên hỏi `Conflict` |
| `fs.copy` | `{ "from": [uri], "to": uri, "move": false }` | `{ "job" }` | xuyên provider (mục 7.4) |
| `fs.trash` | `{ "uris": [..] }` | `{ "job" }` | mặc định của Delete |
| `fs.delete` | `{ "uris": [..] }` | `{ "job" }` | chỉ khi Trash không có (từ xa, ổ mạng); page hỏi xác nhận trước |
| `fs.read_text` | `{ "uri", "max": 1048576 }` | `{ "text", "truncated" }` | W4 soạn thảo |
| `fs.write_text` | `{ "uri", "text", "mtime"? }` | Entry | ghi vào tệp tạm rồi `rename` đè; có `mtime` mà tệp đã đổi từ lúc đọc thì từ chối (W4 dùng) |
| `fs.complete` | `{ "text" }` | `{ "items": ["/Users/me/Desktop/", ..] }` | gợi ý thanh địa chỉ: `~`, đường dẫn tuyệt đối, scheme đã đăng ký |
| `fs.sizes` | `{ "view", "on": true }` | null | bật cột dung lượng cho view; kết quả đẩy `view.sizes { view, generation, sizes: {name: bytes} }` theo lô |
| `clipboard.copy` / `clipboard.cut` | `{ "uris" }` | null | NSPasteboard `NSPasteboardTypeFileURL`; cut đánh dấu nội bộ |
| `clipboard.paste` | `{ "to": uri }` | `{ "job" }` | từ pasteboard, kể cả tệp Finder copy |
| `clipboard.state` | `{}` | `{ "hasFiles", "cut": [uri] }` | làm mờ mục đã cut |
| `jobs.list` | `{}` | `[ {id, kind, title, done, total, current, state} ]` | |
| `jobs.cancel` | `{ "id" }` | null | |
| `jobs.answer` | `{ "id", "answer", "applyAll" }` | null | |
| `native.open` | `{ "uris" }` | null | `NSWorkspace.openURL`; tệp từ xa qua bản tạm |
| `native.open_with` | `{ "uris", "app": "/Applications/X.app" }` | null | |
| `native.apps_for` | `{ "uri" }` | `[ { "path", "name", "icon", "default": true } ]` | `URLsForApplicationsToOpenURL` |
| `native.reveal` | `{ "uris" }` | null | `activateFileViewerSelectingURLs` |
| `native.quicklook` | `{ "uris", "index" }` | null | mở hoặc đóng (toggle) |
| `native.volumes` | `{}` | `[ { "name", "path", "ejectable", "icon", "free", "total" } ]` | |
| `native.eject` | `{ "path" }` | null | `unmountAndEjectDeviceAtURL_error` |
| `native.get_info` | `{ "uri" }` | null | mở Finder Get Info bằng AppleScript |
| `drag.arm` | `{ "uris", "window" }` | null | mục 8.2 |
| `drag.disarm` | `{}` | null | |
| `glass.panes` | `{ "panes": [[x,y,w,h,r], ..] }` | null | mục 9 |
| `panes.state` | `{ "state": LayoutState }` | null | page lưu bố cục hiện tại để F1 khôi phục khi mở lại và W1 đọc |
| `menu.show` | `{ "items": [MenuNode], "x", "y", "dynamic": ["openWith"], "uris" }` | null | mục 8.12; chọn xong đẩy `menu.chosen { id }` hoặc `menu.closed` |
| `keymap.get` | `{}` | Keymap | |

Sự kiện lõi đẩy: `app.hello`, `settings.changed`, `view.changed { view, generation, count }` (sau FS event hoặc
thao tác), `view.sizes`, `jobs.started|progress|ask|finished`, `drop { window, x, y, paths, operation }`,
`volumes.changed`, `theme.changed { theme: "light|dark" }`, `update.available { latest, notes }`, `toast { text }`.

## 6. Kiến trúc giao diện

### 6.1 Cấu trúc trang (`ui/index.html`)

```
html[lang][data-theme][data-glass]  -> script đầu trang đặt class dark/glass/mac như Lanes
  .backdrop                        -> ánh sáng màu dưới kính (Lanes)
  .app (grid: sidebar | main)
    aside.sidebar                  -> .side-top (chỗ traffic lights), nav: Favourites, iCloud/Home, Volumes (eject), Tags?, [slot sidebar.sections], .side-foot (jobs mini, settings)
    main
      .toolbar                     -> nút back/forward, [slot toolbar.left], .address (breadcrumb | input), [slot toolbar.right], view mode, search
      .workspace                   -> .pane-grid[data-layout=single|h2|v2|grid] chứa 1..4 .pane
        .pane[data-pane=p0]        -> .tabs (per-pane), .list (virtualized), .pane-overlay [slot pane.overlay], .status
      .preview-slot                -> [slot preview.right | preview.bottom], W4 lấp đầy
      .statusbar                   -> số mục, dung lượng chọn, dung lượng trống; [slot status]
  .sheets                          -> lớp sheet chung: settings, conflict, progress, [slot sheets]
  .toasts
  #templates (các <template> của lõi)
```

### 6.2 Mô hình trạng thái (JS, `window.S`)

```js
S = {
  window: { role: "main", id: 1 },
  layout: "single" | "h2" | "v2" | "grid",     // 1, 2 ngang, 2 dọc, 2x2
  panes: [ { id: "p0", tabs: [Tab], active: 0 } ],      // 1..4
  focus: "p0",
  viewMode: "list" | "icons" | "columns",              // columns là mục tiêu phụ, lõi giao "list" và "icons"
  showHidden: false,
  Tab: { id: "p0t2", uri: "file:///Users/me", history: [uri], hi: 0, sort: Sort, selection: Set<name>, anchor: name,
         count, generation, scrollTop, capabilities: ["write","trash","watch","sizes"] }
}
```

`view` trong IPC chính là `Tab.id`; Rust giữ listing, page giữ selection, scroll và lịch sử. Mỗi thay đổi bố cục gọi
`panes.state` (debounce 500 ms) để lưu `layout.json` và cho W1.

### 6.3 Danh sách ảo cho 100k mục

Listing sống trong Rust (`src/views.rs`): `Vec<Entry>` đã sắp xếp cộng chỉ số lọc. Page chỉ vẽ các hàng nhìn thấy:

- Một `.list` có `.spacer` cao `count * rowHeight` và một lớp hàng tái dùng (pool khoảng 60 phần tử).
- Khi cuộn: tính `start = floor(scrollTop / rowHeight) - 20`, xin `view.rows` cho `[start, start + visible + 40)`;
  cache thưa `Map<index, Entry>` theo `generation`; các khối đã có không xin lại; một yêu cầu đang bay thì gộp.
- Mỗi lần `view.changed` tăng `generation`: page xóa cache, giữ scroll và selection theo tên, hỏi lại `view.index_of`
  cho anchor.
- Icon là `<img loading="lazy" src="lazy://icon/32/<uri>">`; trình duyệt tự gộp và hủy khi hàng rời màn hình; Rust
  cache (mục 8.1).
- Chế độ icons: cùng cơ chế, hàng là một dòng ô.
- Chọn tất cả 100k mục là `{ all: true, except: [] }` nên không bao giờ gửi 100k tên; chọn bằng Shift gửi `{names}`
  nếu dưới 2000 tên, nếu không gửi `{ range: [a, b], names: [...] }` (Rust hiểu range theo chỉ số đã sắp).

### 6.4 UI extension API (`window.LZ`, F3 cung cấp trong index.html)

Feature parts chỉ gọi API này, không chạm DOM của lõi ngoài slot của mình:

```js
LZ.words({ vi: { stashAdd: "Thêm vào Stash" }, en: { stashAdd: "Add to Stash" } });   // gộp vào WORDS, t(key) dùng chung
LZ.menu.add({ id: "stash.add", label: "stashAdd", icon: "tray.and.arrow.down", when: ctx => ctx.items.length > 0, group: "feature", order: 70,
              run: ctx => call("stash.add", { uris: ctx.uris }) });
LZ.toolbar.add({ id: "stash.toggle", side: "right", icon: "tray", label: "stash", run: () => ... });
LZ.sheet.register("rename.batch", { title: "batchRename", build(el, ctx) {...}, onClose() {...} });  LZ.sheet.open("rename.batch", ctx)
LZ.settings.section({ id: "archive", title: "archive", order: 60, build(el, settings) {...} });   // vào sheet Settings
LZ.keys.add({ id: "rename.batch", mac: "Cmd+Shift+R", windows: "F2+Shift", when: "list", run: ctx => ... });
LZ.pane.overlay(paneId, element | null);            // phủ lên vùng list của pane (sync, archive progress, preview nhỏ)
LZ.sidebar.section({ id: "remote", title: "servers", order: 40, items: () => [{ label, icon, uri, menu }] });
LZ.vfs.scheme("archive", { label: "archive", icon: "archive", openEntry: (entry) => uri | null });  // mục 6.5
LZ.preview.register({ id: "video", match: entry => /\.(mp4|mov)$/i.test(entry.name), build(el, entry) {...} });  // W4 sở hữu slot, feature khác góp
LZ.on("view.changed", fn); LZ.off(...); LZ.emit(...)
LZ.state(); LZ.focusedTab(); LZ.selection(); LZ.navigate(paneId, uri); LZ.openTab(paneId, uri); LZ.refresh(view)
LZ.toast(text); LZ.confirm(text); LZ.prompt(text, value)
LZ.icons.add({ tray: "<svg ...>" })                 // SVG nội tuyến theo tên
```

`ctx` của menu và phím: `{ paneId, tabId, uri, items: [Entry], uris, where: "list" | "empty" | "sidebar" | "tab" | "desktop" }`.
Phần lõi tự đăng ký các mục menu và phím mặc định của mình qua cùng API, nên W1 chỉ cần sắp xếp lại một danh sách
thống nhất (mục 8.12).

### 6.5 Vị trí VFS trên page

Một tab chỉ biết `uri`. Mở một `Entry` kind `file` đi qua các `LZ.vfs.scheme(...).openEntry`: W6 đăng ký trả
`archive:///path/to/a.zip!/` cho đuôi nén, nếu không có ai nhận thì `native.open`. Breadcrumb tách theo `/` sau phần
authority, phần authority (`sftp://user@host`) là crumb đầu, W6 vẽ crumb `a.zip` rồi các thư mục trong archive.

## 7. VFS

### 7.1 URI

| Scheme | Dạng | Provider | Worker |
|---|---|---|---|
| `file` | `file:///Users/me/a.txt` | local | F2 |
| `archive` | `archive:///Users/me/a.zip!/dir/b.txt` (phần trước `!` là file:// path của archive; lồng nhau không hỗ trợ) | archive | W6 |
| `ftp`, `ftps` | `ftp://user@host:21/path` | ftp | W8 |
| `sftp` | `sftp://user@host:22/path` | sftp | W8 |
| `s3`, `oss` | `s3://conn-id/bucket/key` (conn-id là id kết nối đã lưu, chứa endpoint và region) | s3 | W8 |
| `rclone` | `rclone://remote-name/path` | rclone | W8 |
| `smb`, `afp`, `nfs`, `webdav` | chỉ xuất hiện trong danh sách kết nối; sau khi mount tab điều hướng tới `file:///Volumes/<share>` | netfs (mount rồi local) | W8 |
| `stash` | `stash://` một thư mục ảo liệt kê giỏ | stash | W7 |

`src/vfs/mod.rs`: `pub struct Uri { scheme: String, authority: String, path: String }` với `parse`, `to_string`,
`join(name)`, `parent()`, `name()`; đường dẫn được percent-encode bằng tập của RFC 3986 (tự viết bằng bảng 128 phần
tử, không thêm crate).

### 7.2 Provider trait

```rust
pub struct Capabilities { pub write: bool, pub rename: bool, pub trash: bool, pub watch: bool, pub sizes: bool, pub seek: bool, pub local_path: bool }
pub trait Provider: Send + Sync {
    fn scheme(&self) -> &'static str;
    fn capabilities(&self, uri: &Uri) -> Capabilities;
    fn list(&self, uri: &Uri, ctx: &Ctx) -> Result<Vec<Entry>, String>;
    fn stat(&self, uri: &Uri) -> Result<Entry, String>;
    fn read(&self, uri: &Uri) -> Result<Box<dyn Read + Send>, String>;
    fn write(&self, uri: &Uri, size_hint: Option<u64>) -> Result<Box<dyn Write + Send>, String>;  // ghi vào tên tạm, commit khi drop thành công
    fn mkdir(&self, uri: &Uri) -> Result<(), String>;
    fn rename(&self, from: &Uri, to: &Uri) -> Result<(), String>;      // cùng provider, cùng authority
    fn delete(&self, uri: &Uri, ctx: &Ctx) -> Result<(), String>;       // đệ quy
    fn local_path(&self, uri: &Uri) -> Option<PathBuf> { None }         // file:// và netfs trả Some
    fn watch(&self, uri: &Uri) -> Option<WatchHandle> { None }
}
pub struct Registry { by_scheme: RwLock<HashMap<&'static str, Arc<dyn Provider>>> }
pub fn registry() -> &'static Registry;   // OnceLock
```

F2 đăng ký `local`; F3 tạo sẵn stub đăng ký cho các scheme của W6, W7, W8 (provider trả lỗi "chưa có" cho tới khi
worker thay thân hàm). Mọi hàm chặn, chạy trong `jobs` hoặc thread của kết nối; `Ctx` để hủy và hỏi.

### 7.3 Thao tác chỉ cục bộ

Trash, Quick Look, Open With, Reveal, Get Info, drag-out bằng URL tệp, Terminal và editor đều cần `local_path()`.
Với mục từ xa hoặc trong archive: Quick Look, Open và Open With dùng `vfs::temp::materialize(uri, ctx)` (mục 7.5);
Trash đổi thành Delete có xác nhận; Reveal và Get Info ẩn khỏi menu (`when` của menu đọc `capabilities`).

### 7.4 Copy xuyên provider (`src/vfs/copy.rs`)

Một thuật toán cho mọi cặp: duyệt nguồn đệ quy (`list`), tính tổng bytes trước nếu provider rẻ (local, archive),
với mỗi tệp: kiểm tra đích bằng `stat`, nếu có thì `ctx.ask(Conflict)` trừ khi đã `apply_all`; `KeepBoth` thêm
" 2", " 3" như Finder; copy `read` sang `write` theo khối 1 MiB, báo `progress`; move = copy rồi delete nguồn khi
cùng provider không hỗ trợ `rename` (khác authority) hoặc khác provider; cùng provider cùng authority thì `rename`
(local: `fs::rename`, lỗi EXDEV thì rơi về copy+delete). Local sang local dùng `fs::copy` (copyfile của macOS giữ
xattr, clone trên APFS). Hủy giữa chừng xóa tệp đích đang ghi dở (tên tạm `.lazyspace-partial-<name>`).

### 7.5 Bản sao tạm (`src/vfs/temp.rs`)

`materialize(uri) -> PathBuf` chép mục vào `~/Library/Caches/LazySpace/tmp/<hash(uri)>/<name>`, giữ mtime; cache
theo `(uri, size, mtime)`; dọn khi khởi động và khi vượt 2 GiB (LRU theo atime). Mở để sửa (Open With) không đồng bộ
ngược: toast nói rõ "bản sao tạm" với mục từ xa. W4 soạn thảo văn bản nhỏ đi qua `fs.read_text`/`fs.write_text` nên
ghi ngược được.

### 7.6 Nhốt async cho SFTP

`sftp.rs`: mỗi kết nối một `thread` sở hữu `tokio::runtime::Builder::new_current_thread().enable_all().build()`,
`russh::client::connect`, `authenticate_password` hoặc `authenticate_publickey` (khóa trong `~/.ssh`, passphrase từ
Keychain), `channel_open_session`, `request_subsystem(true, "sftp")`, `SftpSession::new(channel.into_stream())`.
Trait `Provider` được cài bằng cách gửi lệnh qua `mpsc::Sender<Cmd>` và chờ `Receiver` trả lời; `read` trả một
`Box<dyn Read>` là adapter kéo từng khối 256 KiB qua kênh. Không có `.await` ngoài tệp này.

## 8. Cầu nối native (objc2), từng mục

Crate: `objc2 0.6`, `objc2-foundation 0.3`, `objc2-app-kit 0.3` (feature mặc định), `objc2-web-kit 0.3`,
`objc2-quick-look-ui 0.3.2`, `objc2-quick-look-thumbnailing 0.3.2`, `objc2-uniform-type-identifiers 0.3`,
`objc2-core-graphics 0.3`, `objc2-core-foundation 0.3`, `block2 0.6`, `dispatch2 0.3`.

Lấy NSWindow và NSView của tao: `use tao::platform::macos::WindowExtMacOS; let w = window.ns_window() as *mut NSWindow;
let w = unsafe { &*w };` (tao trả `*mut c_void`). WKWebView của wry: `use wry::WebViewExtMacOS; webview.webview()`
trả `Retained<WryWebView>` là con của WKWebView, deref được tới `NSView`.

### 8.1 Icon và thumbnail qua custom protocol, có cache (F2, `src/protocol.rs`, `src/native/icons.rs`)

- `with_asynchronous_custom_protocol("lazy", ...)`; trên macOS URL là `lazy://<host>/<path>` (verified doc wry
  dòng 1066). Host là loại: `lazy://icon/<px>/<uri đã encode>`, `lazy://thumb/<px>/<uri>`,
  `lazy://file/<uri>` (W4 xem trước ảnh, PDF, video với Range), `lazy://app/<px>/<path .app>`.
- Icon: `NSWorkspace::sharedWorkspace().iconForFile(path)` cho local; mục từ xa và trong archive dùng
  `iconForContentType(UTType::typeWithFilenameExtension(ext))`, thư mục dùng `UTType` folder. Vẽ về `px` bằng
  `image.setSize`, `CGImageForProposedRect_context_hints`, `NSBitmapImageRep::initWithCGImage`, rồi PNG như
  `fig/webview.rs png_of`. Cache hai tầng: theo `ext` (mọi tệp thường), theo `path` (app, thư mục có icon riêng,
  volume), `HashMap` 4096 mục LRU; trả `Cache-Control: max-age=3600` để WebKit cache nữa.
- Thumbnail: `QLThumbnailGenerationRequest::initWithFileAtURL_size_scale_representationTypes` với
  `representationTypes = Thumbnail`, `generateBestRepresentationForRequest_completionHandler`; completion gọi
  `RequestAsyncResponder::respond`; chỉ cho ảnh, video, PDF, và chỉ khi view mode là icons hoặc W4 xin; cache trên
  đĩa `~/Library/Caches/LazySpace/thumbs/<sha1(path,mtime,px)>.png`.
- Protocol từ chối mọi host khác và mọi URI không thuộc `file`, `archive` (bản tạm), `stash`; `lazy://file` chỉ phục
  vụ đường dẫn mà page đã mở trong một tab hoặc được chọn (danh sách cho phép `App.served: HashSet<PathBuf>` do
  `fs.list`, `view.rows` và W4 cập nhật), chống page bị lỗi đọc tệp tùy ý.

### 8.2 Kéo tệp ra Finder và app khác (F3, `src/native/drag.rs`)

Vấn đề: IPC `drag.start` tới main thread sau sự kiện chuột vài ms; `beginDraggingSessionWithItems_event_source`
cần một NSEvent chuột đang nhấn. Lanes `window.drag_window()` sống được vì tao dùng `currentEvent`, nhưng với kéo tệp
còn rủi ro WebKit tự mở phiên kéo HTML5 của nó.

Cách làm vững:

1. Page không đặt `draggable="true"` lên hàng; `dragstart` bị `preventDefault`. Khi `pointerdown` trúng một mục đã
   chọn (hoặc chọn mục đó), page gọi `drag.arm { uris }` ngay; `pointerup` hoặc `pointercancel` gọi `drag.disarm`.
   Thông điệp arm tới main thread trong khoảng 1 đến 3 ms, trước khi người dùng kéo quá ngưỡng.
2. Rust giữ `Armed { uris, window, down_at: NSPoint }`. Một local monitor
   `NSEvent::addLocalMonitorForEventsMatchingMask_handler(LeftMouseDragged | LeftMouseUp)` (như
   `fig/webview.rs close_outside`) được cài khi arm và gỡ khi disarm. Trên `LeftMouseDragged` cách `down_at` hơn
   4 pt: gọi `webview.beginDraggingSessionWithItems_event_source(items, event, source)` với chính `event` đó (một
   NSEvent chuột thật, không phải `currentEvent` suy đoán), rồi trả `nil` từ monitor để WebKit không thấy nữa; từ đó
   AppKit sở hữu phiên kéo. Page nhận `pointercancel` tự nhiên vì không còn sự kiện chuột.
3. `items`: mỗi URI local một `NSDraggingItem::initWithPasteboardWriter(NSURL)` với `setDraggingFrame_contents`
   là icon (mẫu `fig/shelf_ui.rs` dòng 328 đến 340). Mục từ xa hoặc trong archive dùng `NSFilePromiseProvider`
   (`initWithFileType_delegate`, delegate cài `filePromiseProvider_fileNameForType` và
   `filePromiseProvider_writePromiseToURL_completionHandler`, verified `generated/NSFilePromiseProvider.rs`); khi
   Finder gọi, delegate chạy `vfs::copy` sang URL đích trong một job.
4. `source` là một lớp `define_class!` `LZDragSource` cài `NSDraggingSource`:
   `draggingSession_sourceOperationMaskForDraggingContext` trả `Copy | Move | Link` ngoài app, `Copy | Move` trong
   app (mẫu `fig/shelf_ui.rs` dòng 148 đến 180); `draggingSession_endedAtPoint_operation` với `operation == Move` và
   nguồn là local gọi `view.changed` (Finder đã dời tệp đi; FS event cũng sẽ báo).
5. Nếu arm tới sau khi chuột đã nhả (nhấp nhanh): `pressedMouseButtons() & 1 == 0` thì bỏ qua, không bao giờ mở phiên
   kéo mồ côi.

### 8.3 Thả vào (F3)

Dùng `wry::WebViewBuilder::with_drag_drop_handler` (handler trả `true` để wry nhận, verified
`wry-0.57.1/src/wkwebview/drag_drop.rs`): `Enter` và `Over` cho `position` theo điểm logic từ góc trên trái của
webview, trùng hệ tọa độ CSS px vì webview phủ kín cửa sổ. Handler gửi `UserEvent::Post(drop.over {x, y})` tiết lưu
30 lần/giây cho page tô sáng pane hoặc thư mục dưới con trỏ (`document.elementFromPoint`), và `Drop {paths, position}`
thành event `drop { x, y, paths, operation }`. Page tìm đích: thư mục dưới con trỏ, nếu không thì thư mục của pane
dưới con trỏ, nếu không thì bỏ qua; rồi gọi `fs.copy { from: paths as file://, to, move }`. `operation`: wry chỉ
báo Copy, nên quy ước như Finder: cùng volume là move, khác volume là copy, giữ Option là copy, Cmd là move (page đọc
modifier từ sự kiện bàn phím gần nhất; `NSEvent::modifierFlags` trong handler là nguồn chính, gửi kèm). Kéo nội bộ
giữa hai pane cũng đi đúng đường này vì phiên kéo 8.2 là phiên native thật: thả lên webview của chính mình tạo
`DragDropEvent::Drop` với các file URL. Mục từ xa kéo nội bộ: promise provider ghi vào thư mục tạm, page nhận path
tạm và URI gốc (Rust nhớ `Armed.uris` để đổi path tạm ngược về URI gốc trong 2 giây sau drop).

Handler chỉ nhận (trả `true`) khi kéo có đường dẫn tệp. Không có (văn bản, URL, ảnh kéo từ trình duyệt thường không
mang file URL) thì trả `false` cho cả `Enter`, `Over`, `Drop` của lần kéo đó (`Over` không mang paths nên handler nhớ
kết quả của `Enter`); khi đó wry gọi `super` và WebKit giao drop HTML5 cho page (verified
`wry-0.57.1/src/wkwebview/drag_drop.rs`, các nhánh `msg_send![super(this), ...]`). W7 đọc `text/uri-list`,
`text/plain` và `File` ảnh từ `dataTransfer` của drop HTML5. HTML5 drop không dùng cho tệp vì WKWebView không lộ
đường dẫn tệp cho JS.

### 8.4 Quick Look (F3, `src/native/quicklook.rs`)

`QLPreviewPanel::sharedPreviewPanel(mtm)`; một `define_class!` `LZPreviewSource: NSObject` cài
`QLPreviewPanelDataSource` (`numberOfPreviewItemsInPreviewPanel`, `previewPanel_previewItemAtIndex` trả `NSURL`
vì `NSURL` tuân `QLPreviewItem`) và `QLPreviewPanelDelegate::previewPanel_sourceFrameOnScreenForPreviewItem` (hình
chữ nhật của hàng, page gửi kèm trong `native.quicklook`). Gọi `setDataSource`, `setDelegate`, `reloadData`,
`makeKeyAndOrderFront`; Space lần nữa gọi `orderOut`. Phím mũi tên trong panel đổi `currentPreviewItemIndex`, page đồng
bộ chọn qua event `quicklook.index`. QLPreviewPanel muốn một controller trong responder chain: gán data source khi
panel không có controller làm AppKit in "called while the panel has no controller - Fix this or this will raise soon".
Vì first responder là WKWebView của wry, F3 chèn một `define_class!` `LZPanelResponder: NSResponder` cài
`acceptsPreviewPanelControl:` (YES), `beginPreviewPanelControl:` (gán dataSource, delegate) và
`endPreviewPanelControl:` vào chuỗi bằng `window.setNextResponder` (nextResponder cũ thành của nó). Chưa kiểm chứng;
nếu không hoạt động thì gán trực tiếp và ghi cảnh báo console vào báo cáo. Mục không local: `materialize` trước.

### 8.5 Trash (F2)

Gọi thẳng `NSFileManager::defaultManager().trashItemAtURL_resultingItemURL_error` (objc2-foundation). Đánh đổi đã
chốt: không có "Put Back" trong Finder (giới hạn của NSFileManager, verified bảng so sánh trong
`trash-5.2.9/src/macos/mod.rs`; cách có Put Back phải gọi Finder bằng osascript, cần quyền Automation và chậm). Thay
vào đó là Undo trong LazySpace: mỗi lần Trash ghi `[(gốc, resultingItemURL)]` vào ngăn undo của cửa sổ, `Cmd+Z`
("Hoàn tác chuyển vào Thùng rác") chuyển từng mục về chỗ cũ nếu chỗ đó còn trống, nếu không thì hỏi `Conflict`. Lỗi
trên volume không có Trash (một số ổ mạng) trả về cho page để hỏi xóa hẳn.

### 8.6 Open With kèm icon app (F2)

`NSWorkspace.URLsForApplicationsToOpenURL(url)` và `URLForApplicationToOpenURL` cho mặc định; tên từ
`NSFileManager.displayNameAtPath`; icon qua `lazy://app/32/<path>`. Mở: `openURLs_withApplicationAtURL_configuration_completionHandler`
với `NSWorkspaceOpenConfiguration::new`. "Khác..." mở `NSOpenPanel` giới hạn `.app`.

### 8.7 Reveal in Finder, Get Info (F2)

`activateFileViewerSelectingURLs`; Get Info bằng `osascript -e 'tell application "Finder" to open information window of (POSIX file "...")'`.

### 8.8 Volumes và eject (F2)

Port `fig/volumes.rs`: `NSFileManager.mountedVolumeURLsIncludingResourceValuesForKeys_options`, resource keys
`NSURLVolumeLocalizedNameKey`, `NSURLVolumeIsEjectableKey`, `NSURLVolumeIsInternalKey`,
`NSURLVolumeTotalCapacityKey`, `NSURLVolumeAvailableCapacityForImportantUsageKey`; lắng nghe
`NSWorkspaceDidMountNotification` và `DidUnmount` trên `notificationCenter` của workspace, đẩy `volumes.changed`.
Eject: `unmountAndEjectDeviceAtURL_error`; thất bại vì đang bận thì toast nói app nào giữ (lấy từ `lsof` là quá tay:
chỉ hiện lỗi của hệ thống).

### 8.9 Mở Terminal và editor (W2)

Danh sách cố định `(label, bundle id)`: Terminal `com.apple.Terminal`, iTerm2 `com.googlecode.iterm2`, Warp
`dev.warp.Warp-Stable`, Ghostty `com.mitchellh.ghostty`, VS Code `com.microsoft.VSCode`, Sublime Text
`com.sublimetext.4`, Cursor `com.todesktop.230313mzl4w4u92`, Zed `dev.zed.Zed`. Có cài hay không:
`NSWorkspace.URLForApplicationWithBundleIdentifier` (verified `NSWorkspace.rs:216`). Mở: `/usr/bin/open -b <id>
<dir>`; Terminal.app nhận thư mục và mở cửa sổ tại đó; iTerm2 và Warp cũng vậy; Ghostty cần
`open -b com.mitchellh.ghostty --args --working-directory=<dir>` (chưa kiểm chứng trên máy này vì không cài). Người
dùng thêm app khác bằng cách chọn `.app` (W2 lưu `openin.json`).

### 8.10 Cửa sổ cấp desktop (W9) và panel nổi (W7) (`src/native/panel.rs`, F3 tạo helpers)

Cả hai là `tao::Window` thứ hai (để wry và IPC dùng y nguyên), rồi chỉnh bằng objc2 qua `ns_window()`:

- Desktop: `WindowBuilder::with_decorations(false).with_transparent(true).with_visible_on_all_workspaces(true)`;
  sau khi tạo: `setLevel(kCGDesktopIconWindowLevel as isize)`, `setCollectionBehavior(CanJoinAllSpaces | Stationary |
  IgnoresCycle)`, `setHasShadow(false)`, frame = `NSScreen.visibleFrame` của màn hình chính (và một cửa sổ cho mỗi
  màn hình phụ). Ở mức icon desktop, hình nền (kể cả động) của hệ thống vẫn nằm dưới và nhìn xuyên qua webview trong
  suốt. Ẩn icon Finder trên desktop bằng `defaults write com.apple.finder CreateDesktop -bool false` rồi `killall
  Finder`, khôi phục khi tắt tính năng (port `fig/desktop.rs show_icons`, có hỏi xác nhận).
- Shelf: `WindowBuilder::with_decorations(false).with_transparent(true).with_always_on_top(true)
  .with_visible_on_all_workspaces(true)` và `setCollectionBehavior(CanJoinAllSpaces | FullScreenAuxiliary)`; neo ở mép
  phải màn hình, kích thước theo page. Không phải NSPanel non-activating (tao không tạo được); nhấp vào shelf sẽ kích
  hoạt LazySpace, chấp nhận được vì drag-out vẫn hoạt động và đây là "lazy default". Nếu cần non-activating sau này,
  cách của `fig/capture_ui.rs panel()` với một WKWebView riêng là đường nâng cấp.

### 8.11 Lớp kính (F1): mục 9.

### 8.12 Menu ngữ cảnh: NSMenu native, điều khiển bằng dữ liệu, có icon (F3, `src/contextmenu.rs`, `src/native/menu.rs`)

Quyết định (người dùng chốt): NSMenu thật của macOS, không phải menu HTML. Lý do: từ macOS 26 tự có Liquid Glass,
không bị cắt ở mép cửa sổ, có VoiceOver và gõ chữ để chọn mục. Icon là SF Symbols
(`NSImage::imageWithSystemSymbolName_accessibilityDescription`, macOS 11 trở lên).

Phân vai: page vẫn giữ sổ đăng ký mục (`LZ.menu.add` với `when` và `run` là hàm JS), nên API cho feature không đổi. Khi
chuột phải, page lọc theo `ctx`, dịch nhãn theo ngôn ngữ, rồi gọi `menu.show { items: [MenuNode], x, y, dynamic, uris }`
với `MenuNode { id, label, icon?: "<tên SF Symbol>", enabled, checked?, shortcut?, separator?, submenu?: [MenuNode] }`.
Rust (`contextmenu.rs`) áp `menu.json` (thứ tự, ẩn, icon ghi đè, vạch ngăn; tệp do W1 soạn, định dạng và
`apply_layout` thuộc F3 nên menu chạy đúng cả trước khi W1 merge), rồi `native/menu.rs` dựng NSMenu, chèn phần động
(`openWith`: app và icon thật của app qua `NSWorkspace.iconForFile`, chạy thẳng `native.open_with` khi chọn), và hiện
bằng `popUpMenuPositioningItem_atLocation_inView` tại điểm đó trong webview của đúng cửa sổ (chính, desktop, shelf).
Target của mọi NSMenuItem là một `define_class!` `LZMenuTarget` với action `choose:` đọc `representedObject` (id). Chọn
xong đẩy event `menu.chosen { id }`, đóng không chọn đẩy `menu.closed`; page gọi `run(ctx)` của mục đó. `popUp...` chạy
vòng tracking lồng nhau: IPC tới trong lúc menu mở chờ tới khi menu đóng, chấp nhận.

Mục mặc định của lõi (Open, Open With, Quick Look, Get Info, Rename, Duplicate, Copy, Cut, Paste, Move to Trash,
New Folder, Reveal in Finder, Copy Path, Show hidden, Sort by, View as) và của feature đều đăng ký trên page bằng
`LZ.menu.add`. Feature khai báo icon bằng tên SF Symbol (ví dụ `tray.and.arrow.down`); tên không có trên macOS đang
chạy thì bỏ icon, không lỗi. Để HTML (Settings của W1, toolbar, sidebar) hiện cùng bộ icon, F3 thêm host
`lazy://symbol/<px>/<tên>` vào `protocol.rs`: vẽ SF Symbol thành PNG mẫu đen (`png_of`), page đảo màu bằng CSS ở chế độ
tối. Menu bar (muda, F1) và context menu (objc2 trực tiếp) là hai thứ riêng; muda không dùng cho context menu vì cần
icon SF Symbols và cây động.

## 9. Liquid Glass (beta)

Hai lớp hợp tác:

1. CSS (Lanes `ui/index.html` dòng 91 đến 156): `:root.glass` đổi biến màu, `.backdrop` ánh sáng màu mờ,
   `backdrop-filter` cho `.sidebar`, `.capsule`, `.panel`, `.toast`, `.group`. Đây là toàn bộ hiệu ứng trước
   macOS 26 và là fallback khi lớp native không có.
2. Native (`src/glass.rs`, port `fig/webview.rs glass_background`, `veil_color`, `GlassBed`, `lay_glass`): khi
   `settings.glass` bật, cửa sổ tao được tạo `with_transparent(true)` và wry `with_transparent(true)` (wry đặt
   `drawsBackground = false`, verified `wkwebview/mod.rs:416`). Sau `build`, `GlassLayer::attach(window, webview)`:
   lấy `contentView` của NSWindow, chèn một `NSGlassEffectView` (`AnyClass::get(c"NSGlassEffectView").is_some()`,
   macOS 26 trở lên) hoặc `NSVisualEffectView` material `UnderWindowBackground`, blending `BehindWindow` phủ kín
   bằng `addSubview_positioned_relativeTo(glass, Below, webview)`; trên đó một `NSBox` veil với `veil_color()`
   (0.8 alpha, màu theo appearance động); page gửi `glass.panes` (sidebar, các capsule, sheet đang mở) và
   `lay_glass` đặt các `NSGlassEffectView` con dưới chỗ page để trong suốt. `setOpaque(false)`,
   `setBackgroundColor(clearColor)` trên NSWindow. Page khi có `glassAvailable` dùng class `glass native` để bỏ
   `backdrop-filter` và nền `--sidebar` của chính nó ở các vùng đã có pane native (tránh kính kép).
3. Công tắc Settings > Appearance > "Liquid Glass (beta)" mặc định tắt: `settings.set { glass }` tạo lại cửa sổ
   (transparent không đổi được sau khi tạo trong tao) như Lanes làm với `set_glass`: lưu `panes.state`, đóng, mở lại.
4. Theme: `Settings.theme` là `system | light | dark`; `window_theme()` của Lanes trả `Option<Theme>` cho
   `WindowBuilder::with_theme` và `Window::set_theme`; `page()` đặt `data-theme` và `data-glass` lên `<html>` trước
   khung hình đầu (Lanes `page`, test `the_page_comes_in_the_language_and_look_of_the_settings`);
   `WindowEvent::ThemeChanged(theme)` của tao đẩy `theme.changed` để page cập nhật class `dark` khi theo hệ thống.
   `veil_color` dùng `colorWithName_dynamicProvider` nên tự đổi theo appearance của cửa sổ.

## 10. Lưu trữ

Thư mục `~/Library/Application Support/LazySpace/` (`settings::data_dir()`, như Lanes `data_dir`). Mọi tệp JSON
`serde(default)`, ghi qua tệp tạm rồi `rename`.

| Tệp | Chủ | Nội dung |
|---|---|---|
| `settings.json` | F1 | `language "vi"`, `theme "system"`, `glass false`, `keymap "mac" \| "windows"`, `show_hidden false`, `folder_sizes false`, `view_mode "list"`, `sort {by,desc,foldersFirst}`, `confirm_delete true`, `preview {side: "right", on: false}`, `desktop {on: false, hide_finder_icons: false}`, `check_updates true`, `favourites: [uri]`, `sidebar_sections` |
| `layout.json` | F1 | LayoutState của cửa sổ cuối: layout, panes, tabs (uri, sort), focus, kích thước cửa sổ |
| `workspaces.json` | W1 | `[{ id, name, created, layout: LayoutState }]` |
| `menu.json` | W1 ghi, F3 đọc | `{ order: [id], hidden: [id], icons: {id: tên SF Symbol}, separators: [after id] }` |
| `keymap.json` | W1 | ghi đè phím của người dùng trên bảng mac hoặc windows |
| `templates/` | W2 | tệp mẫu thật (Blank.txt, Blank.md, Blank.docx, Blank.xlsx, script.sh); `templates.json` thứ tự và tên hiển thị |
| `openin.json` | W2 | app Terminal và editor người dùng thêm |
| `sync-profiles.json` | W3 | `[{ id, name, left, right, mode: "ltr" \| "rtl" \| "both", rules }]` |
| `rename-undo.json` | W5 | nhật ký lần đổi tên cuối: `[{from, to}]`, cho Undo |
| `stash.json` | W7 | `[{ uri, added, note, origin: "local" \| "remote" \| "web" \| "clipboard" }]`; mục clipboard và web lưu thành tệp trong `stash/` |
| `connections.json` | W8 | `[{ id, name, scheme, host, port, user, path, region, endpoint, bucket, rclone_remote }]` không có bí mật |
| Keychain | W8 | service `com.eliasbui.lazyspace`, account `<connection id>`, data = mật khẩu hoặc secret key hoặc passphrase; `security-framework::passwords` |
| `~/Library/Caches/LazySpace/` | F2 | `thumbs/`, `tmp/` (bản sao tạm), xóa được bất kỳ lúc nào |

Nâng cấp từ bản cũ: khóa lạ giữ nguyên khi ghi lại (`#[serde(flatten)] extra: Map`) để tệp của bản mới hơn không
bị cắt khi hạ cấp.

## 11. Mục tiêu hiệu năng và cách đạt

| Mục tiêu | Cách |
|---|---|
| Mở thư mục 100k mục: hàng đầu tiên trong 300 ms, cuộn 60 fps | `read_dir` + `symlink_metadata` trên thread job theo lô 5000, gửi `view.changed` lần đầu khi lô đầu xong rồi lần cuối khi hết (page vẽ ngay 60 hàng đầu); sắp xếp trong Rust bằng `sort_unstable_by` với khóa tên đã `to_lowercase` cache sẵn; page chỉ giữ hàng nhìn thấy (mục 6.3); mỗi `view.rows` tối đa 200 hàng, trả lời dưới 2 ms |
| Icon không làm giật | `lazy://icon` bất đồng bộ, cache theo đuôi tệp nên 100k tệp cùng kiểu là một lần `iconForContentType`; `<img loading="lazy">` |
| Dung lượng thư mục nền | `sizes.rs`: hàng đợi theo view, 2 thread, mỗi thư mục con là một đơn vị, kiểm tra `ctx.cancelled()` mỗi 256 mục; kết quả gửi theo lô 100 ms; hủy khi đổi thư mục hoặc tắt cột; cache phiên theo path, vô hiệu khi FS event chạm dưới path đó; dùng `st_blocks * 512` để khớp Finder "on disk" (tùy chọn hiển thị logical) |
| FS watching không bão sự kiện | FSEvents qua notify, debounce 300 ms, một re-list cho mỗi view bị chạm; với view trên 20k mục debounce 1 s; chỉnh sửa do chính LazySpace gây ra vẫn đi qua watcher để một đường cập nhật |
| Copy lớn | `fs::copy` (clonefile trên APFS gần như tức thì), tiến độ theo tệp và theo bytes cho tệp trên 64 MiB bằng `io::copy` thủ công theo khối |
| Khởi động dưới 400 ms | Không đọc gì ngoài `settings.json` và `layout.json` trước khi hiện cửa sổ; listing và volumes sau `app.ready` |

Kiểm chứng: F2 thêm test ignored `cargo test --release -- --ignored bench_list_100k` tạo 100k tệp trong temp dir và
in thời gian `local.list` (ngưỡng 1 s) và `view.rows` (ngưỡng 5 ms).

## 12. Quy tắc an toàn

- Không bao giờ ghi đè khi chưa có quyết định xung đột rõ ràng (`Answer::Replace`); `KeepBoth` là mặc định của Enter
  trong sheet xung đột.
- Xóa mặc định là Trash. Xóa hẳn chỉ qua `fs.delete` có sheet xác nhận và chỉ khi Trash không khả dụng hoặc người dùng
  giữ Option.
- Sync (W3) và batch rename (W5) luôn xem trước: kết quả tính xong hiển thị thành danh sách thao tác; chỉ khi bấm
  "Apply" mới chạy. Batch rename đổi hai pha: mọi tên nguồn sang `.lz-rename-<uuid>-<i>` rồi sang tên đích, nên hoán
  vị a→b, b→a không mất tệp; nhật ký `rename-undo.json` và lệnh Undo đảo lại khi mọi tên đích còn khớp. Sync ghi
  `sync-journal.json` trước khi chạy và xóa sau; đồng bộ không bao giờ xóa ở phía đích trừ khi chế độ "mirror" bật và
  đã liệt kê trong xem trước.
- Giải nén (W6): mỗi đường dẫn mục được chuẩn hóa (`enclosed_name` của zip; với bsdtar và 7z tự kiểm tra: không bắt
  đầu bằng `/`, không chứa `..`, không rỗng); đích được `canonicalize` sau mỗi `mkdir` và phải bắt đầu bằng thư mục
  đích; symlink trong archive được tạo sau cùng và từ chối nếu mục tiêu trỏ ra ngoài; bsdtar chạy với
  `--no-same-owner --no-same-permissions -k` (không ghi đè) sang một thư mục tạm bên trong đích rồi di chuyển.
- Custom protocol chỉ phục vụ `icon`, `thumb`, `app`, và `file` trong danh sách cho phép (mục 8.1); mọi thứ khác
  404. Không có `fetch` ra ngoài từ page.
- `with_navigation_handler` trả `false` cho mọi URL không phải trang gốc (`about:blank` và chuỗi HTML của chính
  mình); link http/https mở bằng `NSWorkspace.openURL` như `fig/webview.rs NavDelegate`;
  `with_new_window_req_handler` luôn từ chối.
- IPC: `args` vào struct kiểu; đường dẫn phải là URI hợp lệ; tên tệp không được chứa `/` hoặc NUL; `view` phải tồn
  tại và thuộc cửa sổ gọi; `start`, `count` bị kẹp; kích thước đọc văn bản tối đa 1 MiB mặc định; `settings.set` chỉ
  nhận khóa đã biết.
- Bí mật: chỉ Keychain; log không in URL có mật khẩu; `connections.json` không có trường bí mật theo kiểu (không có
  chỗ để lỡ ghi).
- Lệnh ngoài: luôn đường dẫn tuyệt đối cho binary hệ thống; rclone, unar, 7zz tìm trong danh sách thư mục cố định;
  đối số là `OsStr`, không qua shell; đường dẫn bắt đầu bằng `-` được đưa sau `--`.
- Thư mục nhạy cảm: `fs.delete` và `fs.trash` từ chối `/`, `/System`, `/Users`, home, `/Applications` gốc.

## 13. Pipeline phát hành

Ánh xạ từ Lanes, chỉ phần macOS:

| Lanes | LazySpace | Thay đổi |
|---|---|---|
| `scripts/bundle-macos.sh` | giữ tên | `APP=dist/LazySpace.app`, binary `lazyspace`, bỏ ffmpeg, bundle id `com.eliasbui.lazyspace`, thêm `NSDesktopFolderUsageDescription`, `NSDocumentsFolderUsageDescription`, `NSDownloadsFolderUsageDescription`, `NSRemovableVolumesUsageDescription`, `NSNetworkVolumesUsageDescription` (TCC hỏi quyền khi lần đầu đọc), `LSMinimumSystemVersion 13.0`, `UNIVERSAL=1` lipo hai target |
| `scripts/release.sh` | giữ tên | bỏ `package-windows.sh`, `NO_WINDOWS`, `extension/manifest.json`; `ZIP=dist/LazySpace-$VERSION-macos.zip`; `latest.json` một asset |
| `scripts/update-cask.sh` | giữ tên | `REPO=eliasbui/lazyspace`, `TAP=eliasbui/homebrew-lazyspace`, cask `lazyspace.rb`, pattern `LazySpace-$VERSION-macos.zip` |
| `scripts/install.sh` | giữ tên | `REPO`, `LazySpace.app` |
| `packaging/homebrew/lanes.rb` | `lazyspace.rb` | `cask "lazyspace"`, name, desc "File manager with panes, archives, remote servers and a stash shelf", `depends_on macos: :ventura`, bỏ `uninstall launchctl` (không có login item), `zap trash: "~/Library/Application Support/LazySpace", "~/Library/Caches/LazySpace"` |
| `packaging/homebrew/README.md` | giữ tên | viết lại cho LazySpace |
| `src/update.rs` | giữ tên | `REPO = "eliasbui/lazyspace"`, `BUNDLE_ID`, `APP = "LazySpace.app"`, `STAGE = ".LazySpace-update"`, `OLD`; xóa mọi nhánh `cfg!(windows)`, `EXE`, `put_exe_in_place`, `check_exe`; `check_app` kiểm tra `Contents/MacOS/lazyspace`; ureq 3 thay 2 (`ureq::get(url).header("User-Agent", "lazyspace").call()`, `response.body_mut().read_to_string()`); giữ nguyên `parse`, `verify`, `swap`, `relaunch`, các test |
| `scripts/install.ps1`, `package-windows.sh`, `build-ffmpeg.sh`, `winresource`, `extension/` | bỏ | |

Checklist phát hành: `cargo test` xanh; `scripts/smoke.sh` xanh (mục 14); `scripts/screenshots.sh` xem bằng mắt ba
ảnh; `scripts/release.sh X.Y.Z` (bump, test, bundle universal, zip bằng `ditto`, tag, `gh release create`, upload
`latest.json`, cập nhật cask); mở app vừa cài từ cask một lần để xác nhận Gatekeeper không chặn và updater thấy
phiên bản mới nhất.

## 14. Chiến lược kiểm thử

- Unit test Rust theo module, dùng `std::env::temp_dir()` cộng tên ngẫu nhiên (không thêm tempfile): `vfs::local`
  (list, hidden, sort, rename), `vfs::copy` (xung đột, KeepBoth, hủy, move xuyên volume giả bằng EXDEV mock là quá tay:
  test copy+delete path trực tiếp), `views` (rows, generation, filter), `sizes`, `jobs` (ask/answer vòng tròn với
  thread giả), `keymap` (bảng windows ánh xạ Ctrl+C), `contextmenu` (lọc `when`), `update` (các test của Lanes),
  `settings` (tệp cũ giữ giá trị), và của từng W (mục 15). Test không chạm AppKit; mã objc2 được bọc bởi hàm mỏng
  không có logic.
- `scripts/smoke.sh`: `cargo build --release`, `scripts/bundle-macos.sh`, `open dist/LazySpace.app`, chờ 3 s,
  `pgrep -x lazyspace`, kiểm tra `~/Library/Application Support/LazySpace/settings.json` xuất hiện, `osascript -e
  'quit app "LazySpace"'`. Thoát khác 0 nếu bất kỳ bước nào hỏng.
- `scripts/screenshots.sh`: chạy app với biến môi trường `LAZYSPACE_SETTINGS=<tệp tạm>` (F1 hỗ trợ để test không
  đụng dữ liệu thật) lần lượt với `theme light`, `theme dark`, `glass true`; mỗi lần `screencapture -l <window id>
  dist/shot-<name>.png`; người review xem ảnh. Cần quyền Screen Recording một lần. Nếu không lấy được window id,
  đặt frame cố định trong `layout.json` tạm và chụp vùng bằng `screencapture -R x,y,w,h`.
- Kiểm thử thủ công bắt buộc trước merge của F3 và W7: kéo một tệp ra Finder, ra Mail, vào pane kia; Quick Look
  bằng Space; thả từ Finder vào pane.

## 15. Phân rã công việc

Thứ tự: F1 → F2 → F3 trên `main`, mỗi F kết thúc bằng commit theo kiểu Lanes (dòng đầu nói app giờ làm được gì,
không tiền tố) và `cargo test` xanh. Sau F3, tag `base-w`; master tạo cho mỗi W một worktree ngoài repo:
`git worktree add <thư mục do master chọn> -b w<n>/<name> base-w`. W chỉ sửa tệp mình sở hữu (cột
"Tệp") cộng dòng neo của mình trong `Cargo.toml`; `Cargo.lock` xung đột thì lấy của `main` và `cargo update
--offline` lại. Merge theo thứ tự W1, W2, W5, W4, W3, W6, W7, W8, W9 (ít tệp chung trước, W8 và W9 tạo cửa sổ hoặc
thread riêng sau cùng). Phụ thuộc W tới W: không có ở mức mã; W7 và W8 muốn dùng archive hay remote đều qua
`vfs::registry()`; W4 preview tệp trong archive hoạt động tự nhiên qua `Provider::read` khi W6 merge.

### 15.1 F1: khung ứng dụng và pipeline phát hành

Mục tiêu: app mở được một cửa sổ trống đúng kiểu Lanes (title bar trong suốt, sidebar giữ traffic lights, toolbar
kéo cửa sổ), có Settings (ngôn ngữ, theme, glass), menu bar, updater, custom protocol, lớp kính, dispatcher, và toàn bộ
script phát hành.

Tệp tạo: `Cargo.toml` (với neo, mục 15.4), `build.rs`, `assets/*`, `src/main.rs`, `src/settings.rs`, `src/ipc.rs`,
`src/menus.rs`, `src/update.rs`, `src/glass.rs`, `src/protocol.rs` (khung, chưa có icon), `src/native/mod.rs`,
`ui/index.html` (khung mục 6.1 với slot rỗng, CSS Lanes, `call`, `app.receive`, `WORDS`, `t()`, sheet Settings),
`ui/parts/.gitkeep`, `scripts/*` (5 script + `smoke.sh`, `screenshots.sh`), `packaging/homebrew/*`, `README.md`,
`README.vi.md`, `.gitignore` (thêm `dist/`).

Thêm so với Lanes: `App::open_surface` và `close_surface` (mục 3.1), `Dispatcher::on_start` (mục 5.2), nhiều cửa sổ
chính (`Cmd+N`), đóng cửa sổ cuối không thoát và `Event::Reopen` mở lại.

Port từ Lanes: `tr`, `ENGLISH`, `data_dir`, `Settings::load/save`, `page`, `window_theme`, `theme_name`,
`open_window` (WindowBuilder với `with_titlebar_transparent`, `with_title_hidden`, `with_fullsize_content_view`,
`with_traffic_light_inset(20, 20)`), `post`, `"drag" | "zoom"`, `decode_png`, `choose_folder` (đổi sang NSOpenPanel
qua objc2 hoặc giữ osascript: giữ osascript, ít mã), `menu_bar` (bỏ Lanes-specific, thêm File > New Window, New
Folder, Close Tab; View > as List, as Icons, Show Hidden; Go > Back, Forward, Enclosing Folder, Home, Desktop,
Downloads, Applications; các mục chỉ phát `UserEvent::Menu` cho page xử lý qua `menu.action { id }`), toàn bộ
`update.rs` và test của nó.

Từ figghost: `glass_background`, `veil_color`, `GlassBed`, `lay_glass`, `png_of`, cách `NavDelegate` chặn điều hướng
(bằng `with_navigation_handler` của wry thay vì delegate riêng).

Phụ thuộc thêm: tao, wry, muda, serde, serde_json, objc2, objc2-foundation, objc2-app-kit, objc2-web-kit, block2,
dispatch2, ureq, sha2, png, dirs.

IPC: `app.ready`, `app.drag`, `app.zoom`, `app.new_window`, `app.open_url`, `settings.*`, `glass.panes`,
`panes.state` (chỉ lưu `layout.json`), `update.check`, `update.install`, `update.relaunch`; event `app.hello`,
`settings.changed`, `theme.changed`, `update.*`, `toast`.

Tiêu chí nghiệm thu:

- `cargo test` xanh với các test: `older_settings_keep_defaults`, `the_page_comes_in_the_language_and_look_of_the_settings`,
  `dispatcher_routes_by_exact_method_and_rejects_unknown`, `ipc_args_are_validated`, toàn bộ test của `update.rs`.
- `scripts/smoke.sh` xanh. `scripts/screenshots.sh` cho ba ảnh light, dark, glass; ảnh glass trên macOS 26 trở lên
  thấy nền mờ qua cửa sổ (cửa sổ đặt trên một ảnh màu).
- `UNIVERSAL=1 scripts/bundle-macos.sh` tạo app; `lipo -archs dist/LazySpace.app/Contents/MacOS/lazyspace` in
  `x86_64 arm64`; `codesign --verify --strict` xanh.
- `DRY_RUN=1 scripts/update-cask.sh 0.0.1 dist/LazySpace-0.0.1-macos.zip` in cask đúng.

Không chạm: không viết logic tệp; không tạo `src/features`.

### 15.2 F2: trình duyệt lõi

Mục tiêu: duyệt thư mục cục bộ với mọi thao tác cơ bản, danh sách ảo, tab (một pane), thanh địa chỉ, sidebar, icon
hệ thống, dung lượng thư mục nền, theo dõi FS, job với tiến độ và xung đột.

Tệp tạo: `src/vfs/{mod,local,copy,temp}.rs`, `src/views.rs`, `src/fswatch.rs`, `src/jobs.rs`, `src/sizes.rs`,
`src/clipboard.rs`, `src/native/{icons,workspace,trash}.rs`, `src/protocol.rs` (hoàn thiện icon, thumb, app, file),
`ui/parts/00-core-list.js|css`, `00-core-tabs.js`, `00-core-address.js|css`, `00-core-sidebar.js`,
`00-core-jobs.js|css` (sheet tiến độ và xung đột). Sửa: `ui/index.html` (slot thật), `src/main.rs` (chỉ thêm `mod`
và `core::register`), `Cargo.toml` (khối lõi).

Phụ thuộc thêm: notify, notify-debouncer-full, objc2-quick-look-thumbnailing, objc2-uniform-type-identifiers.

IPC: toàn bộ `fs.*`, `view.*`, `jobs.*`, `clipboard.*`, `native.open`, `native.open_with`, `native.apps_for`,
`native.reveal`, `native.volumes`, `native.eject`, `native.get_info`; event `view.changed`, `view.sizes`, `jobs.*`,
`volumes.changed`.

Tiêu chí nghiệm thu:

- `cargo test vfs::` xanh: `list_sorts_folders_first_and_hides_dotfiles`, `rename_refuses_slash_and_asks_on_conflict`,
  `copy_asks_once_with_apply_all_and_keep_both_numbers_like_finder`, `move_across_providers_copies_then_deletes`,
  `cancelled_copy_removes_its_partial_file`, `uri_roundtrips_percent_encoding`.
- `cargo test views::` xanh: `rows_window_is_clamped_and_generation_is_checked`, `filter_and_find_prefix`.
- `cargo test jobs::` xanh: `ask_blocks_until_answered_and_apply_all_skips_later_asks`.
- `cargo test sizes::` xanh: `folder_size_sums_recursively_and_stops_when_cancelled`.
- `cargo test trash::` xanh: `undo_moves_items_back_or_asks_when_the_place_is_taken` (một thư mục tạm đóng vai Thùng
  rác; test không bao giờ chạm `~/.Trash`).
- `cargo test --release -- --ignored bench_list_100k` in thời gian dưới ngưỡng mục 11.
- Thủ công: mở `~`, tạo thư mục, đổi tên, chuyển vào Trash rồi `Cmd+Z` đưa mục về chỗ cũ; sửa thư mục bằng Finder thì
  LazySpace cập nhật trong dưới 1 s; cột Size hiện dung lượng thư mục khi bật.

Không chạm: không nhiều pane, không drag-out, không Quick Look, không menu ngữ cảnh ngoài mục tối thiểu tạm (một menu
tạm 5 mục được F3 thay).

### 15.3 F3: pane, kéo thả, Quick Look, menu, keymap và stub cho W

Mục tiêu: 1 đến 4 pane với tab riêng; kéo thả giữa pane, ra Finder, từ Finder vào; Quick Look; menu ngữ cảnh dữ
liệu; keymap dữ liệu; UI extension API; mọi stub và đăng ký cho W1 đến W9.

Tệp tạo: `src/native/{drag,quicklook,panel,menu}.rs`, `src/keymap.rs`, `src/contextmenu.rs`, `src/features/mod.rs`
và 9 stub (danh sách mục 4; mỗi stub: `pub fn register(d: &mut Dispatcher) {}` cộng với W6, W7, W8 một provider
stub đăng ký scheme trả lỗi "chưa sẵn sàng"), `ui/parts/00-core-panes.js|css`, `00-core-menu.js`,
`00-core-keys.js`, `00-core-ext.js` (`window.LZ`), và 9 cặp `ui/parts/<nn>-<name>.js` (mỗi tệp một dòng
`LZ.words({vi:{}, en:{}});` và comment chủ sở hữu) với `.css` rỗng. Sửa: `ui/index.html` (pane grid, slot), `Cargo.toml`
(neo W, mục 15.4), `src/main.rs` (`mod features;`, `features::register`), `src/protocol.rs` (host `symbol`, mục
8.12).

Phụ thuộc thêm: objc2-quick-look-ui.

IPC: `drag.arm`, `drag.disarm`, `native.quicklook`, `menu.show`, `keymap.get`; event `drop`, `drop.over`,
`quicklook.index`, `menu.chosen`, `menu.closed`.

Keymap: hai bảng trong `keymap.rs` (`MAC`, `WINDOWS`) ánh xạ `action -> [chord]`: mac `Cmd+C/X/V`, Enter đổi tên,
`Cmd+O` hoặc `Cmd+Down` mở, `Cmd+Delete` trash, Space Quick Look, `Cmd+1..4` layout, `Cmd+T` tab, `Cmd+W` đóng tab,
`Cmd+Up` thư mục cha, `Cmd+Shift+.` ẩn; windows `Ctrl+C/X/V`, Enter mở, `F2` đổi tên, `Delete` trash,
`Backspace` lên, `Alt+Left/Right` lịch sử, `Ctrl+Shift+N` thư mục mới. Page nhận bảng qua `app.hello` và áp dụng;
W1 chỉ đổi `settings.keymap` và ghi đè.

Tiêu chí nghiệm thu:

- `cargo test keymap::` xanh: `windows_map_uses_ctrl_and_enter_opens`, `user_overrides_win`.
- `cargo test contextmenu::` xanh: `layout_orders_hides_and_overrides_icons_but_keeps_unknown_ids`,
  `menu_nodes_reject_unknown_fields_and_too_deep_trees`.
- `cargo test features::` xanh: `every_feature_registers_without_panicking` (gọi `features::register` với
  dispatcher trống, kiểm tra 9 module hiện diện qua `Dispatcher::areas()`).
- `build.rs` ghép đúng 9 cặp parts (`cargo build` in cảnh báo nếu thiếu tệp, kiểm tra bằng
  `grep -c "LZ.words" target/*/build/lazyspace-*/out/parts.html` bằng 9 trở lên).
- Thủ công (ghi vào PR): kéo 2 tệp từ pane trái sang phải (move cùng volume), ra Desktop của Finder, vào Mail tạo
  đính kèm; thả từ Finder vào thư mục con trong pane; Space mở Quick Look và mũi tên đổi mục; chuột phải hiện menu có
  icon và Open With liệt kê app kèm icon; `Cmd+1..4` đổi layout và tab giữ nguyên.

Không chạm: không cài nội dung nào của W.

### 15.4 Neo trong Cargo.toml

F1 tạo khối `[dependencies]` lõi, rồi F3 thêm 9 khối, mỗi khối là một dòng comment chủ (chữ thường, không dải gạch
trang trí) và các khối cách nhau một dòng trống để phần thêm của hai W không bao giờ chạm nhau; W chỉ chèn dòng ngay
dưới comment của mình:

```toml
# W1 workspaces, winkeys, menuedit: no crates

# W2 templates, openin, hash

# W3 sync

# W4 preview

# W5 rename

# W6 archive

# W7 stash

# W8 remote

# W9 desktop
```

Các crate W cần đã liệt kê ở mục 2; mỗi W thêm đúng crate của mình (W2: md-5, sha1, crc32fast; W4:
objc2-av-foundation; W5: regex; W6: zip, sevenz-rust2; W8: suppaftp, russh, russh-sftp, tokio, hmac, quick-xml,
security-framework, objc2-core-foundation; W9: objc2-core-graphics). Cùng một crate không được hai W thêm; nếu cần,
W dùng crate đã có trong lõi (sha2, ureq, serde).

### 15.5 W1: Workspaces, chế độ phím Windows, tùy biến menu

Tệp: `src/features/{workspaces,winkeys,menuedit}.rs`, `ui/parts/10-workspaces.js|css`, `11-winkeys.js`,
`12-menuedit.js|css`. Phụ thuộc: không.

IPC: `workspaces.list|save|load|delete|rename` (lưu `LayoutState` từ `panes.state` mới nhất; `load` trả state cho
page áp dụng qua `LZ.applyLayout`); `winkeys.set { mode }` (gọi `settings.set` nội bộ và trả keymap hợp nhất);
`menuedit.get|set` (`menu.json`). UI: sidebar section "Workspaces", sheet đặt tên, toolbar nút workspace; Settings
section "Keyboard" (mac / Windows, bảng phím ghi đè); Settings section "Context menu" kéo thả sắp xếp, ẩn hiện, chọn
icon từ khoảng 60 tên SF Symbol tuyển sẵn (hiện bằng `lazy://symbol`), ghi `menu.json` theo định dạng của F3. Phụ
thuộc F3: mô hình pane (`LayoutState`), `LZ.menu`, `LZ.keys`, `contextmenu::MenuLayout`.

Nghiệm thu: `cargo test workspaces:: winkeys:: menuedit::` xanh (`save_then_load_roundtrips_layout`,
`windows_mode_merges_user_overrides`, `menuedit_set_validates_and_roundtrips_layout`); thủ công: lưu 2
workspace với layout khác nhau và khôi phục; bật Windows mode thì `Ctrl+C`, `Ctrl+V` copy dán và Enter mở; ẩn
"Get Info" khỏi menu và thấy mất.

### 15.6 W2: tạo tệp từ mẫu, mở trong Terminal và editor, hash

Tệp: `src/features/{templates,openin,hash}.rs`, `ui/parts/20-templates.js|css`, `21-openin.js`,
`22-hash.js|css`, `assets/templates/Blank.docx`, `assets/templates/Blank.xlsx` (OOXML tối thiểu hợp lệ, tạo một lần
bằng `/usr/bin/zip` từ vài tệp XML, commit dạng nhị phân). Phụ thuộc: md-5, sha1, crc32fast (sha2 có sẵn).

IPC: `templates.list|add|remove|create { uri, template, name }` (mẫu mặc định sinh trong mã: `.txt`, `.md`,
`.sh` có shebang và chmod 755, `.json`, `.docx` và `.xlsx` là zip tối thiểu hợp lệ viết bằng crate zip? W6 sở hữu
zip; W2 nhúng sẵn hai tệp nhị phân mẫu `assets/templates/Blank.docx|xlsx` qua `include_bytes!`, không cần crate);
`openin.apps` (có cài hay không), `openin.open { app, uri }`, `openin.add { path }`; `hash.start { uris, algos }` là
job đọc mỗi tệp một lần cập nhật cả bảy digest, kết quả đẩy `hash.result { uri, md5, sha1, sha224, sha256, sha384,
sha512, crc32 }`; `hash.compare { expected }` so sánh không phân biệt hoa thường. UI: menu "New file" submenu mẫu,
toolbar nút "+"; menu và toolbar "Open in" submenu; sheet Hash có ô dán giá trị đối chiếu và dấu khớp.

Nghiệm thu: `cargo test templates:: openin:: hash::` xanh (`created_file_gets_unique_name_and_template_bytes`,
`script_template_is_executable`, `known_vectors_for_all_seven_algorithms` với vector của "abc",
`compare_ignores_case_and_spaces`); thủ công: mở thư mục trong Terminal và VS Code nếu có cài.

### 15.7 W3: so sánh và đồng bộ thư mục

Tệp: `src/features/sync.rs`, `ui/parts/30-sync.js|css`. Phụ thuộc: không (sha2 cho so sánh nội dung tùy chọn).

IPC: `sync.compare { left, right, options: { by: "size_mtime" | "content", ignoreHidden, mode } }` là job trả
`sync.report { pairs: [{ rel, left: Entry?, right: Entry?, state: "same|leftNewer|rightNewer|leftOnly|rightOnly|conflict", action }] }`;
`sync.apply { reportId, actions: [{ rel, action: "ltr|rtl|skip|deleteLeft|deleteRight" }] }` chạy qua `vfs::copy`
nên hoạt động với mọi provider; `sync.profiles.*`. UI: sheet hai cột với bộ lọc theo trạng thái, nút đổi chiều từng
dòng, nút "Chỉ trái sang phải", "Phải sang trái", "Hai chiều"; mở từ menu khi đúng 2 thư mục được chọn hoặc từ hai
pane đang mở ("Compare panes").

Nghiệm thu: `cargo test sync::` xanh (`compare_classifies_every_state`, `two_way_picks_newer_and_never_deletes`,
`apply_only_runs_listed_actions`, `journal_is_written_before_and_removed_after`).

### 15.8 W4: side preview

Tệp: `src/features/preview.rs`, `ui/parts/40-preview.js|css`. Phụ thuộc: objc2-av-foundation.

IPC: `preview.info { uri }` trả `{ kind, size, mtime, dims?, pages?, video?: { width, height, fps, dataRate, duration, codecs }, audio?: {...} }`
(video qua `AVURLAsset` + `tracksWithMediaType(AVMediaTypeVideo)` → `nominalFrameRate`, `estimatedDataRate`,
`naturalSize`; chạy trên thread job, AVFoundation cho phép); `preview.text` dùng `fs.read_text`; lưu bằng
`fs.write_text`. `lazy://file/<uri>` phục vụ ảnh, PDF (`<embed>`), video và audio (`<video>`/`<audio>`) với
`Range` (protocol của F2 đã hỗ trợ 206; W4 chỉ thêm URI vào danh sách cho phép qua `App.served`). UI: slot
`preview.right` hoặc `preview.bottom` theo settings, toggle `Cmd+Shift+P`, bộ render: ảnh, PDF, video, audio, văn bản
và mã (textarea chỉnh sửa khi dưới 1 MiB, nút Save, cảnh báo khi tệp từ xa), markdown hiển thị thô, mặc định bảng
thông tin kèm icon lớn. `LZ.preview.register` cho feature khác (W6 không cần: tệp trong archive đọc qua Provider).

Nghiệm thu: `cargo test preview::` xanh (`info_detects_kind_by_extension_and_size_limit`,
`text_save_refuses_when_file_changed_since_read`); thủ công: xem một `.mov` thấy fps và data rate khớp `mdls`.

### 15.9 W5: đổi tên hàng loạt

Tệp: `src/features/rename.rs`, `ui/parts/50-rename.js|css`. Phụ thuộc: regex.

IPC: `rename.preview { uris, rules: [Rule] }` trả `{ rows: [{ from, to, conflict: bool }], errors }`; `rename.apply
{ uris, rules }` job hai pha, ghi `rename-undo.json`; `rename.undo`. `Rule`: `insert { text, at: "start|end|index" }`,
`remove { from, count }`, `replace { find, with, regex: bool, caseInsensitive }`, `number { start, step, pad, at }`,
`parent { at }`, `case { mode: "lower|upper|title" }`, `ext { set }`. Mọi quy tắc là hàm thuần trên tên nên xem trước
và áp dụng dùng cùng mã. UI: sheet với danh sách quy tắc kéo thả, bảng xem trước trực tiếp, mục trùng tên tô đỏ và
khóa nút Apply.

Nghiệm thu: `cargo test rename::` xanh (`rules_compose_in_order`, `regex_groups_and_invalid_pattern_error`,
`numbering_pads_and_steps`, `swap_two_names_uses_two_phases_and_undo_restores`, `preview_marks_collisions`).

### 15.10 W6: Enhanced Archiver

Tệp: `src/features/archive/{mod,bsdtar,zip,sevenz}.rs`, `ui/parts/60-archive.js|css`. Phụ thuộc: zip, sevenz-rust2.

Provider `archive`: `list` đọc mục lục một lần và cache theo `(path, mtime)`: zip qua crate zip (nhanh, random
access, mật khẩu), 7z qua sevenz-rust2 (`ArchiveReader::open`, mật khẩu), mọi định dạng khác qua `bsdtar -tvf`
(parse dòng `ls -l`) kể cả RAR4, RAR5, tar.*, iso, cab, xar, lha, cpio, ar (đã kiểm chứng đọc mẫu RAR4, RAR5, 7z,
zip64 bằng bsdtar của máy). `read` một mục: zip `by_index_decrypt`, 7z `for_each_entries` dừng ở mục cần, bsdtar
`bsdtar -xOf archive -- <entry>` (tuyến tính, chấp nhận). `write`, `mkdir`, `rename`, `delete`: không hỗ trợ
(capabilities `write: false`); thêm vào archive là tạo archive mới. IPC: `archive.extract { uris, to, password? }`
(job; zip và 7z bằng crate với kiểm tra zip-slip mục 12; còn lại `bsdtar -xf -C <tmp trong đích>` rồi move; mật khẩu
RAR: thử `unar -p` hoặc `7zz x -p` nếu cài, nếu không báo rõ); `archive.create { uris, to, format: "zip|7z|tar.gz|tar.xz|tar.bz2", password?, level, splitMb? }`
(zip bằng crate với `with_aes_encryption(Aes256, pw)` và `Deflated`; 7z bằng `ArchiveWriter` + `AesEncoderOptions`
+ `set_encrypt_header(true)`, LZMA2; tar.* bằng `bsdtar -a -cf`; chia nhỏ chỉ cho 7z theo byte thành `.7z.001`,
`.002` như 7-Zip, zip chia nhỏ không hỗ trợ); `archive.password_needed` event để page hỏi. UI: nhấp đúp tệp nén mở
như thư mục (`LZ.vfs.scheme("archive")`), breadcrumb có crumb archive; menu "Extract here", "Extract to...",
"Compress..." sheet chọn định dạng, mật khẩu, mức nén, chia nhỏ; kéo mục từ trong archive ra Finder qua promise
provider của F3 (vì `local_path` là None).

Nghiệm thu: `cargo test archive::` xanh (`zip_roundtrip_with_password_and_unicode_names`,
`sevenz_roundtrip_with_password_and_encrypted_header`, `bsdtar_lists_tar_gz_and_extracts_single_entry` (tạo tar.gz
bằng bsdtar trong test), `extract_refuses_zip_slip_and_absolute_paths`, `split_7z_volumes_rejoin_byte_exact`,
`uri_with_bang_splits_archive_and_inner_path`).

### 15.11 W7: Stash Shelf

Tệp: `src/features/stash.rs`, `ui/parts/70-stash.js|css`. Phụ thuộc: không.

Provider `stash://` liệt kê giỏ như một thư mục ảo (để mọi thao tác của lõi, kể cả kéo ra, hoạt động không viết thêm).
IPC: `stash.add { uris }`, `stash.add_clipboard` (ảnh hoặc văn bản từ `NSPasteboard` thành tệp trong `stash/`),
`stash.remove`, `stash.clear`, `stash.show { on }` (mở hoặc đóng cửa sổ Shelf, mục 8.10; page của shelf là cùng
`index.html` với `windowRole = "shelf"`, phần `70-stash.js` vẽ giao diện thu gọn và ẩn phần còn lại), `stash.list`,
`stash.add_data { name?, text? | url? | base64? }` (lưu thành tệp trong `stash/`). Thả tệp từ Finder và từ pane vào
shelf đi qua `drop` event của F3 với `window` là shelf; văn bản, URL và ảnh kéo từ trình duyệt không mang đường dẫn
tệp nên đi qua drop HTML5 (mục 8.3) rồi `stash.add_data`. Xử lý hàng loạt: chọn trong shelf rồi dùng mọi
menu bình thường (copy tới, nén, đổi tên hàng loạt), vì shelf là một view.

Nghiệm thu: `cargo test stash::` xanh (`add_dedupes_and_keeps_order`, `clipboard_text_becomes_a_file_in_stash_dir`,
`stash_provider_lists_items_as_entries`); thủ công: kéo từ Finder vào shelf, từ shelf ra Mail.

### 15.12 W8: Server Connections

Tệp: `src/features/remote/{mod,connections,keychain,ftp,sftp,s3,rclone,netfs}.rs`, `ui/parts/80-remote.js|css`.
Phụ thuộc: suppaftp, russh (ring), russh-sftp, tokio, hmac, quick-xml, security-framework, objc2-core-foundation.

- `connections.rs`: CRUD `connections.json`; bí mật `keychain.rs` bọc `security_framework::passwords`.
- `ftp.rs`: Provider trên `FtpStream`/`NativeTlsFtpStream`, `mlsd` rồi `list` fallback, `retr_as_stream` làm
  `Read`, `put_with_stream` làm `Write` (`finalize_put_stream` khi drop). Một kết nối một thread, lệnh qua kênh.
- `sftp.rs`: mục 7.6.
- `s3.rs`: SigV4 (sha2 + hmac), `ListObjectsV2` phân trang với `delimiter=/` thành thư mục ảo, GET với Range cho
  `read`, PUT đơn cho tệp dưới 5 GiB (multipart là mục tiêu phụ, báo lỗi rõ khi lớn hơn), DELETE, copy+delete cho
  rename. Aliyun OSS là cùng mã với endpoint `oss-<region>.aliyuncs.com` và region đó (OSS hỗ trợ SigV4; chưa kiểm
  chứng trên tài khoản thật).
- `rclone.rs`: tìm `rclone`; `rclone listremotes`, `lsjson`, `cat` (stream stdout làm `Read`), `rcat` (stdin làm
  `Write`), `mkdir`, `deletefile`, `purge`, `moveto`; thêm tài khoản bằng `rclone config create <name> dropbox|onedrive|drive`
  chạy trong Terminal.app (mở bằng `open -a Terminal` với script tạm) vì rclone mở trình duyệt cho OAuth bằng app id
  của chính nó; không cài rclone thì sheet hướng dẫn `brew install rclone`. Tên lệnh theo tài liệu rclone, chưa chạy
  trên máy này vì chưa cài.
- `netfs.rs`: `NetFSMountURLSync` khai báo `extern "C"` liên kết `NetFS.framework` (header có trong SDK, verified
  `NetFS.h:312`), `open_options` gồm `kNAUIOptionKey = kNAUIOptionNoUI`, `kNetFSUseAuthenticationInfoKey`; user và
  mật khẩu từ Keychain; trả mount point, tab điều hướng tới `file:///Volumes/...`; `smb://`, `afp://`, `nfs://`,
  `http(s)://` (WebDAV) đều qua đây; eject qua `native.eject`.

IPC: `remote.connections.*`, `remote.connect { id }` (mở tab tại root), `remote.disconnect`, `remote.test`,
`remote.rclone.remotes`, `remote.rclone.add { kind }`. UI: sidebar section "Servers" với nút +, sheet kết nối theo
scheme với các trường đúng, trạng thái kết nối, mật khẩu vào Keychain, tùy chọn "guest".

Nghiệm thu: `cargo test remote::` xanh (`sigv4_matches_aws_test_vector` (vector chính thức get-vanilla),
`list_objects_xml_parses_prefixes_and_keys`, `connections_json_never_contains_secret_fields`,
`ftp_list_line_parses_unix_and_mlsd`, `netfs_url_builds_with_share_and_without_password`); tích hợp ignored chạy
tay với biến môi trường `LZ_TEST_SFTP=user@host` và `LZ_TEST_FTP`: `sftp_roundtrip_small_file`,
`ftp_roundtrip_small_file`. Thủ công: mount một SMB share, duyệt, copy ra.

### 15.13 W9: LazySpace Desktop

Tệp: `src/features/desktop.rs`, `ui/parts/90-desktop.js|css`. Phụ thuộc: objc2-core-graphics.

IPC: `desktop.enable { on, hideFinderIcons }`, `desktop.layout.get|set` (vị trí icon lưới, lưu `desktop.json`),
`desktop.state`. Rust: tạo `Surface` vai `Desktop` cho mỗi màn hình (mục 8.10), lắng nghe
`NSApplicationDidChangeScreenParametersNotification` để đặt lại frame; page vai desktop ẩn sidebar, toolbar, tab,
hiện pane duy nhất ở view mode icons trên nền trong suốt tại `~/Desktop`, dùng y nguyên menu ngữ cảnh, keymap, kéo
thả, Quick Look của lõi. Hình nền động của hệ thống vẫn do macOS vẽ dưới cửa sổ. Khởi động: nếu `settings.desktop.on`
thì mở desktop surface trước cửa sổ chính; khi đóng cửa sổ chính cuối cùng app vẫn chạy nếu desktop bật (F1 đã có
`menu bar` nên không thành app vô hình).

Nghiệm thu: `cargo test desktop::` xanh (`icon_grid_snaps_and_keeps_positions_by_name`,
`finder_icons_setting_roundtrips_defaults_command_line`); thủ công: bật, thấy icon Desktop trên hình nền động, chuột
phải tạo thư mục mới, kéo tệp từ cửa sổ chính thả lên desktop, đổi Space vẫn thấy; tắt thì icon Finder quay lại.

## 16. Rủi ro và câu hỏi mở

| Rủi ro | Mặc định đề xuất |
|---|---|
| Drag-out: local monitor có thể không nhận `LeftMouseDragged` nếu WebKit bắt đầu phiên kéo của nó trước (hàng có text selectable). | Hàng dùng `-webkit-user-select: none` và `dragstart` bị chặn (page); nếu vẫn hỏng, phương án B là một `NSView` trong suốt phủ lên vùng list chỉ khi đã arm (0 ms sau arm) nhận mouseDragged và bắt đầu phiên kéo; mã chung giữ nguyên. F3 ghi kết quả thử vào PR. |
| `with_transparent` cửa sổ kính làm WKWebView vẽ chậm hơn trên máy Intel cũ. | Glass mặc định tắt; hiển thị cảnh báo "beta" trong Settings. |
| TCC: macOS hỏi quyền Desktop, Documents, Downloads, ổ tháo rời, ổ mạng ở lần đầu; app ký ad hoc nên quyền gắn với identifier và có thể bị hỏi lại sau khi cập nhật. | Chấp nhận; bundle-macos.sh giữ identifier cố định như Lanes để hạn chế hỏi lại. |
| LazySpace Desktop không thể thay hoàn toàn Finder: khi Finder bị ẩn icon, kéo thả từ app khác lên desktop vẫn tới cửa sổ của ta (ở mức icon desktop) nhưng một số app kiểm tra "Finder" bằng tên. | Chấp nhận; tài liệu người dùng ghi rõ. |
| russh với `ring` không có `aws-lc-rs`; một số máy chủ chỉ chấp nhận thuật toán mà ring không hỗ trợ (hiếm, như `ssh-dss`). | Chấp nhận; bật feature `dsa` nếu người dùng cần. |
| rclone OAuth: `rclone config create` mở trình duyệt; trải nghiệm là cửa sổ Terminal. | Chấp nhận vì đúng "lazy default" và không cần đăng ký app; cải tiến sau là `rclone authorize` với đọc token qua stdout. |
| RAR có mật khẩu: libarchive không giải mã. | Dùng `unar` hoặc `7zz` khi có; không có thì báo rõ và gợi ý `brew install unar`. |
| ZIP chia nhỏ (multi-part .z01) không làm. | Chỉ chia 7z theo byte; ghi trong tài liệu. |
| Aliyun OSS qua SigV4 chưa thử trên tài khoản thật. | Mặc định bật, test tích hợp ignored; nếu lỗi, OSS chỉ còn qua rclone (rclone có backend `oss` qua S3 API). |
| Cột dung lượng thư mục với `/` hoặc ổ mạng rất chậm. | Tắt mặc định; chỉ tính cho thư mục của volume cục bộ khi `capabilities.sizes`; ổ mạng mount qua NetFS có `sizes: false`. |
| Hai pane cùng mở một thư mục nhận hai lần re-list. | `fswatch` map path tới nhiều view; listing chạy một lần và chia sẻ `Arc<Vec<Entry>>` giữa các view cùng `(uri, showHidden)`, sắp xếp riêng theo chỉ số. |
| Chế độ "columns" (Miller) không trong danh sách của người dùng. | Không làm; list và icons đủ với danh sách yêu cầu. |
