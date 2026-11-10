# The front end

LazySpace's window is a React 19 and TypeScript page built from shadcn/ui components (the `aria` base, React Aria
Components), Tailwind CSS 4 and a Liquid Glass design. Rust (`src-tauri`) is the engine and holds all state; the page asks
for rows and tells what the user did. This file is the guide for whoever writes a feature. The older, long architecture note
is `docs/design.md` (Vietnamese); its sections 5 (the protocol) and 6.3 (the virtual list) still hold.

## Layout

```
index.html           Vite's entry only: a root div and one module script
src/main.tsx App.tsx the entry; the shell of a window (App.tsx lays the sidebar, toolbar, panes, sheets out)
src/services/        the ONLY place that imports @tauri-apps/api: the typed protocol, the host, the mock
src/lib/             helpers (uri, format), the registry, the state, the facades of the panes and the sidebar
src/i18n/            typed vi/en dictionaries (words/<part>.ts) and t()
src/components/ui/   shadcn components, edited freely (glass variants)
src/components/macos/ the glass compositions every feature shares
src/features/<name>/ one folder per feature: components, hooks, store, types, tests, index.ts with register()
src/styles/index.css the ONLY stylesheet: Tailwind, tokens, glass utilities, keyframes
```

## Rules

1. Only `src/services` imports `@tauri-apps`. Everything else calls the typed functions: `import { api, on } from '@/services'`
   (`api.fs.list({...})`, `api.jobs.cancel({ id })`, `on('view.changed', fn)`).
2. State arrives from Rust (events and results). The page keeps view state only: selection, open sheets, scroll, the rows it
   has been given. A feature keeps its state in a zustand store inside its own folder.
3. No UI string outside `src/i18n`. A word is a typed key of `src/i18n/words/<feature>.ts` (the old page's keys are kept; both
   languages carry the same keys, which `src/architecture.test.ts` checks). Use `useT()` in a component and `t()` outside one.
   Titles, placeholders and `aria-label`s are words too.
4. No CSS file, no `<style>`, no `style=""` except a value computed at run time (a progress width, a drag offset, a virtual
   row's position). Use Tailwind utilities, `cva` variants and the shadcn components. Colours and radii come from the tokens in
   `src/styles/index.css` (`bg-pane`, `text-fg-2`, `border-hair`, `bg-tint`, `rounded-card`, `ease-spring`); never a literal colour.
5. Icons are Phosphor (`@phosphor-icons/react`, the `*Icon` names). SF Symbol names appear only in menu nodes sent to Rust
   (`MenuItemDef.icon`), which draws them natively.
6. No emoji or decorative symbol anywhere. No `any`, no `@ts-ignore`, no disabling a check.
7. A feature plugs in through `src/lib/registry.ts` (context menu items, toolbar buttons, sidebar and settings sections, sheets,
   previews, views, pane badges, keys, actions, places) and reads the panes through `src/lib/panes-api.ts` and the sidebar
   through `src/lib/sidebar-api.ts`. The core never imports an optional feature; `src/features/index.ts` lists them and calls
   each `register()`.

## The three levels of glass

1. The window material: native (Rust). The page lays a veil of its own colour over it (`html.glass body`).
2. Navigation that floats: the sidebar (`glass` panel), toolbar capsules (`Capsule`), menus, sheets (`SheetFrame`), tooltips.
3. Controls on a card: `gl` (a lit rim, a soft drop, no blur) through the shadcn `Button` variants.

Content (lists, tables, text, previews) is never glass: `pane` / `ContentPane`. One accent (`--tint`, the system's); state
colours (`good`, `warn`, `bad`) say a state and nothing else. Type is the system font at 13 px; a 4 pt grid; concentric radii
(window 26, panels 18, cards 14, fields 8). Less text: a description goes behind an `InfoTip`, an icon button carries its
words in a tooltip (`IconButton`). Honour Reduce Transparency, Increase Contrast and Reduce Motion (the root carries the
classes `reduce-transparency`, `increase-contrast`, `reduce-motion`; the media queries are in the stylesheet).

## Running the page without the app

`pnpm dev --port <port>` serves the page; outside Tauri it talks to the mock host (`src/services/mock`), a believable fake file
system with a folder of 100000 items. Query parameters: `?lang=vi|en&theme=light|dark&role=main|desktop|shelf&glass=1&update=1&sheet=<id>
&folder=<path>`. Photograph with `tools/webshot` (see the run folder): `webshot --w 1100 --h 720 --dark --strict URL out.png`.

## Build, release and the page's policy

`pnpm build` type-checks and writes the page to `dist-web`, which Tauri embeds (`src-tauri/tauri.conf.json`,
`frontendDist`). `scripts/bundle-macos.sh` runs `pnpm tauri build --bundles app` for you, adds the licence and
`THIRD_PARTY_NOTICES.md`, and signs; `scripts/release.sh` builds the universal app, zips it and describes the release.

The Content Security Policy of the page allows no inline script and no `eval`: scripts only from the app itself, styles from
the app and as `style` attributes (some values are computed at run time), pictures and media from the app, `data:`,
`blob:` and the `lazy://` scheme of Rust, calls to Rust through `ipc:`. A feature that wants more (a font, a frame, a
network address) changes the policy in `src-tauri/tauri.conf.json` on purpose and says why in its commit.

A library or a component copied into the page carries its licence: add it to `THIRD_PARTY_NOTICES.md`. A tooltip (`Tip`,
`IconButton`) wraps only React Aria components, which are focusable on their own; for anything else, give the element
`tabIndex={0}` and wrap it in React Aria's `Focusable` yourself.
