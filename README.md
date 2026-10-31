<p align="center">
  <img src="assets/icon.png" width="112" alt="" />
</p>

<h1 align="center">LazySpace</h1>

<p align="center">
  A file manager for macOS with up to six panes, workspaces, archives, servers and a stash shelf.<br />
  Finder's look and keys, a dual-pane manager's speed, in a Liquid&nbsp;Glass window.
</p>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/English-blue?style=for-the-badge" alt="English (current)" /></a>
  <a href="README.vi.md"><img src="https://img.shields.io/badge/Ti%E1%BA%BFng%20Vi%E1%BB%87t-grey?style=for-the-badge" alt="Tiếng Việt" /></a>
</p>

<p align="center">
  <a href="https://github.com/eliasbui/lazyspace/releases/latest"><img src="https://img.shields.io/github/v/release/eliasbui/lazyspace?label=release" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/macOS-13%2B-black" alt="macOS 13 or later" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
</p>

LazySpace is a file manager written in Rust. Its window is a web page over native macOS parts: the system's own icons
and thumbnails, Quick Look, the Trash, drag and drop with other apps, a real context menu, the Keychain. Every folder
is listed and sorted in Rust, so a folder of a hundred thousand files opens in a fraction of a second, and every file
operation runs as a job you can watch, cancel and undo. It speaks English and Vietnamese.

<p align="center">
  <img src="docs/screenshots/en-main.png" width="880" alt="The LazySpace window: the sidebar, tabs, the path bar and a list of files" />
</p>

## Features

- **Up to six panes, with tabs as in File Explorer on Windows 11.** Drag a tab near a pane's edge to split it in two
  with the tab in the new half (left, right, top or bottom), onto a pane to move it there, or out of the window to open
  it in a window of its own; drag the line between two panes to give one more room, double-click it to share the room
  evenly. Command-\\ splits to the right and Command-Shift-\\ down. Presets too: one pane, two side by side or stacked,
  three, one on the left and two on the right, four side by side, a grid of four or of six. Each pane has its own
  tabs, history and view. Tabs share the bar evenly and the one shown joins the path bar under it; each is named
  after its folder, or renamed with a double click, and can be marked with a colour from its menu (which also splits,
  moves it to another pane or a window, and closes the others or those to the right). The last tab of a pane closes
  the pane. The middle button or Command and a double click open a folder in a new tab. Columns drop as a pane gets
  narrow, as in QSpace.
- **Workspaces.** The window's layout, panes, tabs and places saved under a name in the sidebar and brought back with a
  click (Command-Option-W saves one).
- **A path bar as File Explorer's.** Breadcrumbs to click, each with an arrow that lists the folders inside it, up and
  reload beside it, and the places gone to before at its end. Typed into, it offers those places first, then the
  folders that complete the path; `~` stands for the home folder, and `sftp://`, `s3://` and the other places can be
  typed too. Back and forward list where they go when right-clicked.
- **Search as fast as you type.** A quick index of the home folder and Applications, kept in memory and up to date by
  FSEvents, matched as fzf matches (the same scoring, in Rust; accents optional, so "bao cao" finds "Báo cáo"). The
  best matches show under the search field as you type; Enter searches the folder and every folder in it, best match
  first, with filters for the kind, the date, the size and the contents (Spotlight), or the whole Mac.
- **Four views, as in Finder.** Icons, list, columns (Miller) and gallery (Command-1 to 4). The list has the columns
  you choose (date modified, date created, size, kind, extension, where), right-click its header for them, and groups
  by kind, date or size.
- **Recents and tags.** The files used lately at the top of the sidebar; Finder's colour tags shown as dots, set from
  the context menu, each colour a search of the Mac in the sidebar.
- **Select by dragging a frame** beside the items, with Shift to add and Command to toggle.
- **Share** with the system's sheet (AirDrop, Messages, Mail) from the toolbar or the context menu.
- **Commands of your own** in the context menu: a line of zsh run with the selected items as its arguments, its
  output shown or run in Terminal.
- **What takes the space.** A map of a folder by size, as DaisyDisk draws it, and the files that are the same (by size,
  then their bytes), the extra copies picked for the Trash in a click.
- **Git in the list.** Each changed, new or conflicted file marked after its name, and the branch in the path bar.
- **Copies that wait and check.** Pause and resume any job; copies can run one at a time and be checked byte for byte
  afterwards.
- **Open in LazySpace from Finder.** A folder or a file's menu in Finder (and Services in every app) has "Open in
  LazySpace"; folders dropped on the Dock icon open in tabs.
- **Disks, phones and disk images as they are plugged in.** The sidebar follows a disk as it comes and goes, and a note
  in the corner says what came: a USB drive or a memory card with its free space, to open or eject; a DMG with an app
  inside, installed in Applications with one button (the copy there before goes to the Trash, the image is ejected and
  the DMG can follow it); an iPhone, a camera or an Android phone, which macOS mounts as no disk, with the apps that
  read it. Ejecting (Command-E, or a disk's menu) leaves the window free, names the apps that hold a disk that will not
  eject, and can force it. Tabs on a disk that goes return home. Settings can turn the notes off.
- **Quick Access.** Folders pinned at the top of the sidebar, as File Explorer pins them: from a folder's menu, the
  button beside the section's name or Command-Control-P (the folder open here), or by dropping folders on the section;
  dragged up and down to order them, unpinned from their menu.
- **The desktop, by LazySpace (optional).** The Desktop folder's icons on the wallpaper, under every window and on
  every Space, each icon where you put it, with the context menu, keys, Quick Look and drag and drop of a pane.
  Finder's own icons can be hidden while it is on, and come back when it is off.
- **New files from templates.** Text, Markdown, Word and Excel documents, scripts, HTML and JSON, and any file you add
  as a template of your own.
- **Open in Terminal or an editor.** Terminal, iTerm2, Warp, Ghostty, kitty, WezTerm, Hyper, Tabby; VS Code, Cursor,
  Zed, Sublime Text, Nova, BBEdit, Xcode, or any app you add, found on this Mac; the one used last is the default.
- **Hashes.** MD5, SHA-1, SHA-224, SHA-256, SHA-384, SHA-512 and CRC32 in one read of the file, checked against a
  value you paste.
- **Compare and sync folders.** By size and date or by content, left to right, right to left or both ways, with a
  preview of every change before anything is done and a choice per item. Items removed on this Mac go to the Trash.
- **Side preview.** Pictures, films and sound with their size, frame rate and data rates, PDFs, and small text files
  that can be edited and saved in place, on the right or at the bottom.
- **Windows keys.** One switch gives the keys of Windows Explorer: Control-C, X and V for files, Enter opens, F2
  renames, Delete moves to the Trash, Backspace goes up.
- **A context menu of your own.** A native macOS menu, with every item's place, visibility, icon and separators set in
  Settings.
- **Folder sizes in the list**, worked out in the background.
- **Servers.** SFTP (with keys, ssh-agent and a check of the server's key), FTP and FTPS, Amazon S3, Aliyun OSS and
  S3-compatible services such as MinIO, and SMB, AFP, NFS and WebDAV shares mounted by macOS. Passwords stay in the
  Keychain.
- **Clouds.** The sidebar's Cloud section shows iCloud Drive and the folders of the Google Drive, OneDrive, Dropbox and
  Box apps. Without those apps, Google Drive, OneDrive, Dropbox and other clouds are signed in to from LazySpace
  itself: the browser opens to sign in through [rclone](https://rclone.org), which is installed with Homebrew when it
  is missing. OneDrive for work or school and SharePoint are choices of their own, with an organisation's own app id
  under Advanced when it does not let rclone's in. Each cloud shows its account under its name, and files are dragged
  from one account to another, onto a pane or onto the cloud in the sidebar.
- **Archives as folders.** Zip (with AES passwords), 7z (with passwords and encrypted names), RAR, tar with gzip, xz or
  bzip2, ISO and more open as read-only folders. Extraction keeps every file inside the folder it goes to. Compress to
  zip, 7z or tar, with a password and split volumes where the format allows.
- **Stash Shelf.** A floating basket for files, pictures, links and text from anywhere, to drag out again later
  (Command-Option-T).
- **Batch rename.** Replace (with regular expressions), insert, remove, number, the folder's name, case and extension
  rules, with a live preview, a check for clashes, and undo.
- **Commands and shortcuts.** Command-P lists every command with its keys, found by name in either language and
  without accents. F5 and F6 copy and move to the other pane, Command-U swaps the panes, Command-Shift-T reopens a
  closed tab.
- **Your colours.** Light, dark or as the system, the Mac's accent colours, the sidebar's icons in grey or in colour,
  icons from 48 to 128 points, three text sizes for lists, and the font of the whole window: the system's, SF Pro
  Rounded, New York, SF Mono or any font installed on the Mac. Settings come in pages, as in System Settings, with a
  search.
- **Liquid Glass (beta).** As in Finder on macOS 26: a solid window whose sidebar is a pane of glass the desktop shows
  through, with the native glass of macOS 26 where it exists. The toolbar folds as the window narrows, as a native
  toolbar does, and its icons are the system's SF Symbols.
- **Undo.** Moves, renames, new items and the Trash are undone with Command-Z.
- **English or Vietnamese**, and in-app updates.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/en-panes.png" alt="Two panes in dark mode with Liquid Glass" /></td>
    <td width="50%"><img src="docs/screenshots/en-search.png" alt="Search with the best matches under the field" /></td>
  </tr>
  <tr>
    <td align="center">Two panes in dark mode with Liquid Glass, Git's state of each file and the branch</td>
    <td align="center">Search as you type: the best matches under the field, the results with filters</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/en-columns.png" alt="The column view" /></td>
    <td width="50%"><img src="docs/screenshots/en-disk.png" alt="The map of a folder by size" /></td>
  </tr>
  <tr>
    <td align="center">The column view, with a preview of the file selected</td>
    <td align="center">What a folder holds, as a map of its sizes</td>
  </tr>
</table>

## Keyboard

The Mac keys, as in Finder, plus these. Command-/ shows all of them in the app.

| Keys | What they do |
|---|---|
| Command-P, Command-/ | Commands and shortcuts |
| F5, F6 | Copy, move the selection to the other pane |
| Command-U | Swap the panes |
| Command-Option-O | Open the selected folder in the other pane |
| Tab, Shift-Tab | Next pane, previous pane |
| Command-T, Command-W, Command-Shift-T | New tab, close tab, reopen a closed tab |
| Control-Tab, Command-Shift-] and [ | Next tab, previous tab |
| Command-Option-1 to 6 | Layouts |
| Command-1, Command-2 | Icons, list |
| Command-= and Command-- | Bigger, smaller icons |
| Space | Quick Look |
| Command-Shift-P | Side preview |
| Command-R | List the folder again |
| Command-Option-V | Move what was copied here |
| Command-Shift-N, Command-Option-N | New folder, new file from a template |
| Command-Option-R | Batch rename |
| Command-Option-K | Compare and sync |
| Command-Option-H | Hashes |
| Command-K | Connect to a server |
| Command-Option-T | Stash Shelf |
| Command-Option-W | Save the workspace |
| Command-Control-T, Command-Control-E | Open in Terminal, in the editor |

## Install

An Apple silicon or Intel Mac with macOS 13 or later. With Homebrew:

    brew tap eliasbui/lazyspace
    brew install --cask eliasbui/lazyspace/lazyspace

Without Homebrew:

    curl -fsSL https://raw.githubusercontent.com/eliasbui/lazyspace/main/scripts/install.sh | sh

Writing the cask out in full installs it from the tap and trusts only that cask. The app is signed ad hoc and not
notarized, so both ways remove the quarantine flag after installing, as other open source apps do. macOS asks once
for each protected folder (Desktop, Documents, Downloads, external and network drives). `brew uninstall --cask
lazyspace` removes it, and `--zap` its settings in `~/Library/Application Support/LazySpace` and its cache too.

If you hid Finder's desktop icons from LazySpace, turn its desktop off in Settings before you remove it, so Finder
shows them again (or run `defaults delete com.apple.finder CreateDesktop; killall Finder`).

## Build and run

Rust 1.93 or later, and the Command Line Tools.

    cargo run

    cargo test                       # the browser, the jobs, the providers and the features
    scripts/check-ui.sh              # every script of the page parses
    cargo run --example make_icons   # redraw the icons in assets/
    scripts/bundle-macos.sh          # build dist/LazySpace.app for this Mac
    UNIVERSAL=1 scripts/bundle-macos.sh

The tests run in temporary folders only. Two tests talk to real servers and run by hand:
`LZ_TEST_SFTP=user@host cargo test sftp_roundtrip -- --ignored` and
`LZ_TEST_FTP=user:password@host cargo test ftp_roundtrip -- --ignored`.

## How it works

- `src/main.rs` - the windows (main, desktop and shelf), the event loop, and the glue between pages and Rust.
- `src/ipc.rs` - the messages between a page and the app; `ipc::defer` answers from a thread a call that waits on a
  disk or a server.
- `src/vfs/` - places by URI and the provider of each scheme; `copy.rs` copies and moves between any two of them,
  asking about each clash.
- `src/views.rs`, `src/browse.rs` - listings sorted and filtered in Rust, handed to the page a range of rows at a time;
  the file operations, the clipboard and undo.
- `src/jobs.rs` - long operations with progress, cancel and questions to the user.
- `src/native/` - the macOS parts through objc2: icons and thumbnails, Quick Look, the Trash, drag out, the context
  menu, the desktop's window, the disks and USB devices plugged in (NSWorkspace, DiskArbitration, IOKit).
- `src/features/` - one module per feature: `archive/` (libarchive through FFI, and sevenz-rust2), `remote/` (SFTP on
  russh, FTP on suppaftp, S3 signed by hand, NetFS, rclone, the Keychain), `sync.rs`, `rename.rs`, `preview.rs`,
  `stash.rs`, `desktop.rs`, `workspaces.rs`, `templates.rs`, `openin.rs`, `hash.rs`, `menuedit.rs`, `devices.rs`.
- `ui/index.html` and `ui/parts/` - the page, joined at build time; each feature adds its part through `LZ`.
- `docs/design.md` - the design, in Vietnamese.

## Data and privacy

Settings, workspaces, saved connections (without their secrets) and the desktop's icon places live in
`~/Library/Application Support/LazySpace`; passwords and secret keys live only in the login Keychain, under the
service `com.eliasbui.lazyspace`. Copies made to open an item from an archive or a server sit in
`~/Library/Caches/LazySpace` and are removed after a day. LazySpace talks to the servers you connect to, and to GitHub
for the update check (which a switch in Settings turns off). Nothing else leaves your Mac.

## Known limits

- Signing in to a cloud from LazySpace needs rclone, which LazySpace installs with Homebrew; without Homebrew, install
  Homebrew (brew.sh) or rclone (rclone.org/install) first.
- Aliyun OSS goes through its S3-compatible interface and was not tried on a real account; S3 uploads are single
  requests of at most 5 GB.
- RAR archives with a password are not opened, and zip files split into `.z01` parts are not made.
- The app is signed ad hoc: after an update macOS may ask again for folders, and the Keychain may ask once to let the
  new version read a saved password.

## Licence

MIT. See [LICENSE](LICENSE). LazySpace is an original program; it is not affiliated with Apple or with QSpace.
