<p align="center">
  <img src="assets/icon.png" width="112" alt="" />
</p>

<h1 align="center">LazySpace</h1>

<p align="center">
  Trình quản lý tệp cho macOS với tối đa bốn khung, workspace, tệp nén, máy chủ và khay tạm.<br />
  Giao diện và phím tắt như Finder, nhanh như một trình quản lý hai khung, trong cửa sổ Liquid&nbsp;Glass.
</p>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/English-grey?style=for-the-badge" alt="English" /></a>
  <a href="README.vi.md"><img src="https://img.shields.io/badge/Ti%E1%BA%BFng%20Vi%E1%BB%87t-blue?style=for-the-badge" alt="Tiếng Việt (đang xem)" /></a>
</p>

<p align="center">
  <a href="https://github.com/eliasbui/lazyspace/releases/latest"><img src="https://img.shields.io/github/v/release/eliasbui/lazyspace?label=release" alt="Bản mới nhất" /></a>
  <img src="https://img.shields.io/badge/macOS-13%2B-black" alt="macOS 13 trở lên" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="Giấy phép MIT" /></a>
</p>

LazySpace là trình quản lý tệp viết bằng Rust. Cửa sổ là một trang web đặt trên các thành phần gốc của macOS: biểu
tượng và ảnh thu nhỏ của hệ thống, Xem nhanh, Thùng rác, kéo thả với ứng dụng khác, menu chuột phải thật, Keychain.
Mọi thư mục được liệt kê và sắp xếp trong Rust, nên thư mục một trăm nghìn tệp vẫn mở trong chưa tới một giây; mọi
thao tác tệp chạy thành một tác vụ có tiến độ, có thể hủy và hoàn tác. Ứng dụng có tiếng Việt và tiếng Anh.

## Tính năng

- **Tối đa bốn khung, có tab.** Sáu bố cục: một khung, hai khung cạnh nhau hoặc trên dưới, ba khung, một trái hai phải,
  hoặc lưới bốn khung. Mỗi khung có tab, lịch sử và kiểu xem riêng (danh sách hoặc biểu tượng). Khung hẹp thì bớt cột,
  như QSpace.
- **Workspace.** Bố cục, các khung, các tab và vị trí của cửa sổ được lưu theo tên ở thanh bên, bấm là trở lại
  (Command-Option-W để lưu).
- **Thanh đường dẫn gõ được.** Bấm vào từng phần, hoặc gõ đường dẫn với gợi ý tên thư mục; `~` là thư mục nhà, và gõ
  được cả `sftp://`, `s3://` cùng các nơi khác.
- **Màn hình nền do LazySpace hiện (tùy chọn).** Các mục của thư mục Màn hình nền trên hình nền, dưới mọi cửa sổ và ở
  mọi Space, mỗi biểu tượng nằm đúng chỗ bạn đặt, có menu chuột phải, phím tắt, Xem nhanh và kéo thả như một khung.
  Biểu tượng của Finder có thể ẩn khi bật, và trở lại khi tắt.
- **Tạo tệp mới từ mẫu.** Văn bản, Markdown, tài liệu Word và Excel, script, HTML, JSON, và mọi tệp bạn thêm làm mẫu.
- **Mở trong Terminal hoặc trình soạn thảo.** Terminal, iTerm2, Warp, Ghostty, kitty, WezTerm, Hyper, Tabby; VS Code,
  Cursor, Zed, Sublime Text, Nova, BBEdit, Xcode, hoặc ứng dụng bạn thêm, có trên máy; ứng dụng dùng gần nhất là mặc định.
- **Mã băm.** MD5, SHA-1, SHA-224, SHA-256, SHA-384, SHA-512 và CRC32 trong một lần đọc tệp, so được với giá trị bạn
  dán vào.
- **So sánh và đồng bộ thư mục.** Theo kích thước và ngày hoặc theo nội dung, trái sang phải, phải sang trái hoặc hai
  chiều, xem trước mọi thay đổi và chọn cho từng mục trước khi làm. Mục bị xóa trên máy này đi vào Thùng rác.
- **Khung xem trước.** Ảnh, phim và âm thanh kèm kích thước, tốc độ khung hình và tốc độ dữ liệu, PDF, và tệp văn bản
  nhỏ sửa và lưu tại chỗ, ở bên phải hoặc bên dưới.
- **Phím tắt kiểu Windows.** Một công tắc cho phím của Windows Explorer: Control-C, X, V cho tệp, Enter để mở, F2 đổi
  tên, Delete chuyển vào Thùng rác, Backspace lên thư mục cha.
- **Menu chuột phải theo ý bạn.** Menu gốc của macOS; vị trí, ẩn hiện, biểu tượng và đường phân cách của từng mục chỉnh
  trong Cài đặt.
- **Dung lượng thư mục ngay trong danh sách**, tính ở chế độ nền.
- **Máy chủ.** SFTP (có khóa SSH, ssh-agent và kiểm tra khóa của máy chủ), FTP và FTPS, Amazon S3, Aliyun OSS và dịch
  vụ tương thích S3 như MinIO, cùng ổ chia sẻ SMB, AFP, NFS và WebDAV do macOS gắn. Google Drive, Dropbox, OneDrive và
  các đám mây khác đi qua [rclone](https://rclone.org) khi đã cài. Mật khẩu chỉ nằm trong Keychain.
- **Tệp nén mở như thư mục.** Zip (cả mật khẩu AES), 7z (cả mật khẩu và tên mã hóa), RAR, tar với gzip, xz hoặc bzip2,
  ISO và nhiều loại khác mở như thư mục chỉ đọc. Giải nén giữ mọi tệp trong thư mục đích. Nén thành zip, 7z hoặc tar,
  có mật khẩu và chia nhỏ khi định dạng cho phép.
- **Khay tạm.** Một giỏ nổi gom tệp, ảnh, liên kết và văn bản từ bất cứ đâu, để kéo ra lại sau (Command-Option-T).
- **Đổi tên hàng loạt.** Thay thế (cả biểu thức chính quy), chèn, xóa, đánh số, tên thư mục cha, chữ hoa thường và
  phần mở rộng; xem trước trực tiếp, kiểm tra trùng tên, và hoàn tác được.
- **Lệnh và phím tắt.** Command-P liệt kê mọi lệnh kèm phím tắt, tìm theo tên tiếng Việt hay tiếng Anh, gõ không dấu
  vẫn được. F5 và F6 chép và chuyển sang khung kia, Command-U đổi chỗ hai khung, Command-Shift-T mở lại tab vừa đóng.
- **Màu sắc của bạn.** Sáng, tối hoặc theo hệ thống, các màu nhấn của Mac, biểu tượng thanh bên xám hoặc có màu, biểu
  tượng từ 48 tới 128 điểm, và ba cỡ chữ cho danh sách.
- **Liquid Glass (beta).** Thanh bên, thanh công cụ và các bảng thành kính mờ trên màn hình nền, dùng kính gốc của
  macOS 26 khi có.
- **Hoàn tác.** Chuyển, đổi tên, tạo mới và đưa vào Thùng rác đều hoàn tác được bằng Command-Z.
- **Tiếng Việt hoặc tiếng Anh**, và tự cập nhật trong ứng dụng.

## Bàn phím

Các phím của Mac như trong Finder, cộng thêm những phím dưới đây. Command-/ hiện tất cả ngay trong ứng dụng.

| Phím | Tác dụng |
|---|---|
| Command-P, Command-/ | Lệnh và phím tắt |
| F5, F6 | Chép, chuyển mục đã chọn sang khung kia |
| Command-U | Đổi chỗ hai khung |
| Command-Option-O | Mở thư mục đã chọn ở khung kia |
| Tab, Shift-Tab | Khung sau, khung trước |
| Command-T, Command-W, Command-Shift-T | Tab mới, đóng tab, mở lại tab vừa đóng |
| Control-Tab, Command-Shift-] và [ | Tab sau, tab trước |
| Command-Option-1 tới 6 | Bố cục |
| Command-1, Command-2 | Biểu tượng, danh sách |
| Command-= và Command-- | Biểu tượng to hơn, nhỏ hơn |
| Space | Xem nhanh |
| Command-Shift-P | Khung xem trước |
| Command-R | Tải lại thư mục |
| Command-Option-V | Chuyển mục đã chép tới đây |
| Command-Shift-N, Command-Option-N | Thư mục mới, tệp mới từ mẫu |
| Command-Option-R | Đổi tên hàng loạt |
| Command-Option-K | So sánh và đồng bộ |
| Command-Option-H | Mã băm |
| Command-K | Kết nối máy chủ |
| Command-Option-T | Khay tạm |
| Command-Option-W | Lưu workspace |
| Command-Control-T, Command-Control-E | Mở trong Terminal, trong trình soạn thảo |

## Cài đặt

Máy Mac chip Apple hoặc Intel, macOS 13 trở lên. Với Homebrew:

    brew tap eliasbui/lazyspace
    brew install --cask eliasbui/lazyspace/lazyspace

Không dùng Homebrew:

    curl -fsSL https://raw.githubusercontent.com/eliasbui/lazyspace/main/scripts/install.sh | sh

Ghi đủ tên cask là cài từ tap và chỉ tin đúng cask đó. Ứng dụng ký ad hoc, không notarize, nên cả hai cách đều gỡ cờ
quarantine sau khi cài, như các ứng dụng mã nguồn mở khác. macOS hỏi một lần cho mỗi thư mục được bảo vệ (Màn hình
nền, Tài liệu, Tải xuống, ổ ngoài và ổ mạng). `brew uninstall --cask lazyspace` gỡ ứng dụng, thêm `--zap` để xóa cả cài
đặt trong `~/Library/Application Support/LazySpace` và bộ nhớ đệm.

Nếu bạn đã ẩn biểu tượng màn hình nền của Finder từ LazySpace, hãy tắt màn hình nền của LazySpace trong Cài đặt trước
khi gỡ để Finder hiện lại chúng (hoặc chạy `defaults delete com.apple.finder CreateDesktop; killall Finder`).

## Build và chạy

Rust 1.93 trở lên, và Command Line Tools.

    cargo run

    cargo test                       # trình duyệt tệp, tác vụ, các provider và tính năng
    scripts/check-ui.sh              # mọi script của trang đều đọc được
    cargo run --example make_icons   # vẽ lại biểu tượng trong assets/
    scripts/bundle-macos.sh          # build dist/LazySpace.app cho máy này
    UNIVERSAL=1 scripts/bundle-macos.sh

Test chỉ chạy trong thư mục tạm. Hai test nói chuyện với máy chủ thật và chạy bằng tay:
`LZ_TEST_SFTP=user@host cargo test sftp_roundtrip -- --ignored` và
`LZ_TEST_FTP=user:password@host cargo test ftp_roundtrip -- --ignored`.

## Cách hoạt động

- `src/main.rs` - các cửa sổ (chính, màn hình nền, khay tạm), vòng lặp sự kiện, và phần nối giữa trang với Rust.
- `src/ipc.rs` - tin nhắn giữa trang và ứng dụng; `ipc::defer` trả lời từ một luồng riêng cho lệnh phải chờ ổ đĩa hay
  máy chủ.
- `src/vfs/` - các nơi theo URI và provider của từng scheme; `copy.rs` chép và chuyển giữa hai nơi bất kỳ, hỏi khi
  trùng tên.
- `src/views.rs`, `src/browse.rs` - danh sách sắp xếp và lọc trong Rust, đưa cho trang từng đoạn dòng; thao tác tệp,
  bảng nhớ tạm và hoàn tác.
- `src/jobs.rs` - thao tác dài có tiến độ, hủy được và hỏi người dùng khi cần.
- `src/native/` - phần macOS qua objc2: biểu tượng và ảnh thu nhỏ, Xem nhanh, Thùng rác, kéo ra, menu chuột phải, cửa
  sổ màn hình nền.
- `src/features/` - mỗi tính năng một module: `archive/` (libarchive qua FFI và sevenz-rust2), `remote/` (SFTP trên
  russh, FTP trên suppaftp, S3 tự ký, NetFS, rclone, Keychain), `sync.rs`, `rename.rs`, `preview.rs`, `stash.rs`,
  `desktop.rs`, `workspaces.rs`, `templates.rs`, `openin.rs`, `hash.rs`, `menuedit.rs`.
- `ui/index.html` và `ui/parts/` - trang, ghép lúc build; mỗi tính năng thêm phần của mình qua `LZ`.
- `docs/design.md` - tài liệu thiết kế.

## Dữ liệu và quyền riêng tư

Cài đặt, workspace, kết nối đã lưu (không kèm bí mật) và vị trí biểu tượng màn hình nền nằm trong
`~/Library/Application Support/LazySpace`; mật khẩu và secret key chỉ nằm trong Keychain đăng nhập, dưới dịch vụ
`com.eliasbui.lazyspace`. Bản sao tạm để mở một mục trong tệp nén hay trên máy chủ nằm trong
`~/Library/Caches/LazySpace` và được xóa sau một ngày. LazySpace chỉ nói chuyện với máy chủ bạn kết nối, và với GitHub
để kiểm tra bản cập nhật (tắt được bằng một công tắc trong Cài đặt). Không có gì khác rời khỏi máy.

## Giới hạn đã biết

- Đám mây cần rclone (`brew install rclone`); thêm tài khoản sẽ mở Terminal, nơi rclone đăng nhập bằng trình duyệt.
- Aliyun OSS đi qua giao diện tương thích S3 và chưa thử trên tài khoản thật; tải lên S3 là một yêu cầu, tối đa 5 GB.
- Không mở RAR có mật khẩu, và không tạo zip chia thành các phần `.z01`.
- Ứng dụng ký ad hoc: sau khi cập nhật, macOS có thể hỏi lại quyền thư mục, và Keychain có thể hỏi một lần để bản mới
  đọc mật khẩu đã lưu.

## Giấy phép

MIT. Xem [LICENSE](LICENSE). LazySpace là chương trình độc lập, không liên quan tới Apple hay QSpace.
