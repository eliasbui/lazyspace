#!/bin/sh
# Builds "dist/LazySpace.app": the release binary, the icon, and the app metadata.
#
#   scripts/bundle-macos.sh               # for this Mac
#   UNIVERSAL=1 scripts/bundle-macos.sh   # Apple silicon and Intel in one binary (what a release ships)
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
APP="dist/LazySpace.app"
# Where cargo puts the build, which CARGO_TARGET_DIR or a config may move away from ./target.
TARGET_DIR=$(cargo metadata --format-version 1 --no-deps | plutil -extract target_directory raw -o - -)

if [ "${UNIVERSAL:-}" = 1 ]; then
    for TARGET in aarch64-apple-darwin x86_64-apple-darwin; do
        cargo build --release --target "$TARGET"
    done
    BIN=$(mktemp -d)/lazyspace
    lipo -create -output "$BIN" "$TARGET_DIR/aarch64-apple-darwin/release/lazyspace" "$TARGET_DIR/x86_64-apple-darwin/release/lazyspace"
else
    cargo build --release
    BIN="$TARGET_DIR/release/lazyspace"
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/en.lproj" "$APP/Contents/Resources/vi.lproj"
cp "$BIN" "$APP/Contents/MacOS/lazyspace"

ICONSET=$(mktemp -d)/AppIcon.iconset
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
    sips -z "$s" "$s" assets/icon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) assets/icon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

# "Open in LazySpace" (NSServices) in the menu Finder shows for any item and under Services in every app; an empty
# NSRequiredContext has it on without a visit to the Keyboard settings. Its name in Vietnamese is in ServicesMenu.strings.
# The questions macOS asks the first time the app reads a protected folder, in both languages of the app. Folders are
# declared so LazySpace can be made the app for them (Settings, "Use LazySpace instead of Finder"); as an alternate it
# never takes them unless asked. Files need no declaration: a reveal from another app reaches the file viewer as an
# open-documents event whatever the file's type.
cat >"$APP/Contents/Info.plist" <<EOT
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>LazySpace</string>
    <key>CFBundleDisplayName</key><string>LazySpace</string>
    <key>CFBundleIdentifier</key><string>com.eliasbui.lazyspace</string>
    <key>CFBundleExecutable</key><string>lazyspace</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleVersion</key><string>$VERSION</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>CFBundleDevelopmentRegion</key><string>en</string>
    <key>CFBundleLocalizations</key><array><string>en</string><string>vi</string></array>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSServices</key>
    <array>
        <dict>
            <key>NSMenuItem</key><dict><key>default</key><string>Open in LazySpace</string></dict>
            <key>NSMessage</key><string>openInLazySpace</string>
            <key>NSPortName</key><string>LazySpace</string>
            <key>NSRequiredContext</key><dict/>
            <key>NSSendFileTypes</key><array><string>public.item</string></array>
        </dict>
    </array>
    <key>CFBundleDocumentTypes</key>
    <array>
        <dict>
            <key>CFBundleTypeName</key><string>Folder</string>
            <key>CFBundleTypeRole</key><string>Viewer</string>
            <key>LSHandlerRank</key><string>Alternate</string>
            <key>LSItemContentTypes</key><array><string>public.folder</string></array>
        </dict>
    </array>
    <key>NSDesktopFolderUsageDescription</key><string>LazySpace shows the files in your Desktop folder.</string>
    <key>NSDocumentsFolderUsageDescription</key><string>LazySpace shows the files in your Documents folder.</string>
    <key>NSDownloadsFolderUsageDescription</key><string>LazySpace shows the files in your Downloads folder.</string>
    <key>NSRemovableVolumesUsageDescription</key><string>LazySpace shows the files on your external drives.</string>
    <key>NSNetworkVolumesUsageDescription</key><string>LazySpace shows the files on your network volumes.</string>
</dict>
</plist>
EOT
cat >"$APP/Contents/Resources/en.lproj/InfoPlist.strings" <<'EOT'
"NSDesktopFolderUsageDescription" = "LazySpace shows the files in your Desktop folder.";
"NSDocumentsFolderUsageDescription" = "LazySpace shows the files in your Documents folder.";
"NSDownloadsFolderUsageDescription" = "LazySpace shows the files in your Downloads folder.";
"NSRemovableVolumesUsageDescription" = "LazySpace shows the files on your external drives.";
"NSNetworkVolumesUsageDescription" = "LazySpace shows the files on your network volumes.";
EOT
cat >"$APP/Contents/Resources/vi.lproj/ServicesMenu.strings" <<'EOT'
"Open in LazySpace" = "Mở trong LazySpace";
EOT
cat >"$APP/Contents/Resources/vi.lproj/InfoPlist.strings" <<'EOT'
"NSDesktopFolderUsageDescription" = "LazySpace hiển thị các tệp trong thư mục Màn hình nền của bạn.";
"NSDocumentsFolderUsageDescription" = "LazySpace hiển thị các tệp trong thư mục Tài liệu của bạn.";
"NSDownloadsFolderUsageDescription" = "LazySpace hiển thị các tệp trong thư mục Tải xuống của bạn.";
"NSRemovableVolumesUsageDescription" = "LazySpace hiển thị các tệp trên ổ đĩa ngoài của bạn.";
"NSNetworkVolumesUsageDescription" = "LazySpace hiển thị các tệp trên ổ đĩa mạng của bạn.";
EOT

# An ad-hoc signature with a stable identifier, so the folder permissions and the update check hold across launches.
codesign --force --deep --sign - --identifier com.eliasbui.lazyspace "$APP"
echo "$APP ($VERSION)"
