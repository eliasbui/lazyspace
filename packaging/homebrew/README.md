# Homebrew tap for LazySpace

[LazySpace](https://github.com/eliasbui/lazyspace) is a file manager for macOS: panes and tabs, archives, remote
servers and a stash shelf, in English and Vietnamese. The macOS build is universal (Apple silicon and Intel) and needs
macOS 13 or later.

    brew tap eliasbui/lazyspace
    brew install --cask eliasbui/lazyspace/lazyspace

Writing the cask out in full installs it from the tap and trusts only that cask, so no `brew trust` is needed. The
app is signed ad hoc and not notarized, so the cask removes the quarantine flag after installing so macOS will open
it.

Update with `brew upgrade --cask lazyspace`; the app also tells you when a new version is out and installs it itself.
`brew uninstall --cask lazyspace` removes the app; add `--zap` to delete its settings in
`~/Library/Application Support/LazySpace` and its cache in `~/Library/Caches/LazySpace` too.

This tap is updated automatically each time LazySpace publishes a release, by `scripts/update-cask.sh` in the app repo.
