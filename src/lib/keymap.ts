// The keymap as the menus read it: chords ("Cmd+Shift+N") to action names. The keys feature (src/features/keys) owns the
// maps and installs the one in use here, so a menu can show an action's chord without importing a feature.

let current: () => Readonly<Record<string, string>> = () => ({});

/** Called by the keys feature: `map` gives the chords in use now (the Mac or the Windows keys, with the features' own). */
export function installKeymap(map: () => Readonly<Record<string, string>>): void {
  current = map;
}

/** The chords in use now. */
export function keymap(): Readonly<Record<string, string>> {
  return current();
}

/** The first chord of `action`, as the keymap writes it ("Cmd+Shift+N"), which the native menus show; none without one. */
export function shortcutOf(action: string): string | undefined {
  const map = current();
  return Object.keys(map).find((chord) => map[chord] === action);
}
