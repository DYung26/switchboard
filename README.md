# Switchboard

A browser extension for instantly switching between multiple accounts on
websites that don't natively support account switching, without needing
separate browser profiles.

This repository captures a website's authenticated browser state (cookies,
local storage, session storage, IndexedDB, and Cache Storage) as a named
account snapshot, then restores it on demand — covering account save,
switch, and logout end to end.

## How to use Switchboard

> Keep every account signed in at once, and hop between them in one click.

Switchboard works on any site's own storage, so there's nothing to configure
per-website. Click the extension icon while on a site to get started.

- **Save Current** — snapshots whatever account you're currently signed into
  on this site (cookies, local storage, and more) and adds it to your list
  for that site.
- **Switch** — click any saved account to instantly swap in its session.
  The page reloads and you're signed in as that account, no typing a
  password required.
- **Replace** — already saved this account but signed in again with fresher
  cookies or a new session? Replace overwrites the saved snapshot with the
  site's current state.
- **Duplicate**, **Rename**, **View Raw** — housekeeping for your saved
  accounts, found in each account's `⋯` menu.
- **Delete** — removes a saved account from Switchboard. This only forgets
  it locally; it does not touch anything on the website itself.
- **Log Out** — signs the *currently active* session out of the website,
  right from the Switchboard popup.
- **Search and sort** — filter a site's saved accounts by name, and sort
  the list by custom order, most recently created, or most recently used.
- **Drag to reorder** — drag accounts to set a custom order. Only available
  while sort is set to **Custom order** and the search box is empty.
- **Side panel** — click the ⇥ button in the popup header to pop Switchboard
  out into the browser's side panel. Unlike the popup, the side panel stays
  open across tab and window switches and automatically follows whichever
  site is currently active.

> [!IMPORTANT]
> Use Switchboard's **Log Out** button instead of the website's own logout
> link or menu item. A site's own logout usually invalidates that session on
> its servers, which can silently break the saved account the next time you
> try to switch back to it. Switchboard's Log Out only clears what's stored
> in your browser, so every saved account stays switchable.

## Stack

- **Vite** + **@crxjs/vite-plugin** — bundles the extension and keeps the
  manifest, background worker, popup, options page, and content scripts in
  sync with HMR during development.
- **TypeScript** (strict mode) — shared across every context (background,
  popup, options, content).
- **React** — popup, side panel, and options UI.
- **Vitest** — unit tests for messaging and storage.
- **ESLint + Prettier** — linting and formatting.

## Installation

### 1. Install dependencies

```bash
npm install
```

### 2. Build the extension

Pick one of the following depending on whether you want a development build
or a production build.

**Development build (recommended while working on the extension):**

```bash
npm run dev
```

Starts Vite in watch mode and writes the unpacked extension to `dist/`.
Vite + CRXJS hot-reloads the extension as you edit source files, so you
generally only need to reload the extension in the browser when the
manifest itself changes (permissions, new entry points, etc.).

**Production build (for a one-off build, or before packaging/shipping):**

```bash
npm run build
```

Type-checks the project with `tsc --noEmit` and then produces an optimized,
minified build in `dist/`. This build does not watch for changes — re-run
it after any source changes.

Either command populates `dist/` with a ready-to-load unpacked extension
(manifest, background worker, popup, options page, side panel, and content
scripts included).

### 3. Load the unpacked extension

**Chrome / Edge / other Chromium browsers:**

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the `dist/` folder.
4. Switchboard's icon should now appear in the toolbar. Pin it for quick
   access.

If you rebuild with `npm run build` (rather than leaving `npm run dev`
running), click the reload icon on Switchboard's card at `chrome://extensions`
to pick up the new build. Under `npm run dev`, CRXJS reloads it for you
automatically for most changes.

### 4. Rebuilding after manifest changes

CRXJS's dev-mode HMR covers source file edits, but changes to
`manifest.config.ts` (new permissions, entry points, etc.) require a full
reload of the extension from `chrome://extensions` (or a restart of
`npm run dev`) to take effect.

### Packaging for distribution

To produce a `.zip` you can upload to the Chrome Web Store (or share for
manual installation), run a production build and zip the contents of
`dist/`:

```bash
npm run build
cd dist && zip -r ../switchboard.zip . && cd ..
```

## Scripts

| Command                | Description                                  |
| ----------------------- | --------------------------------------------- |
| `npm run dev`           | Start the dev build with HMR, output to `dist/`. |
| `npm run build`         | Type-check and produce a production build in `dist/`. |
| `npm run preview`       | Preview the production build.                |
| `npm test`              | Run the test suite once.                     |
| `npm run test:watch`    | Run tests in watch mode.                     |
| `npm run lint`          | Lint the codebase.                           |
| `npm run lint:fix`      | Lint and auto-fix.                            |
| `npm run format`        | Format the codebase with Prettier.           |
| `npm run format:check`  | Check formatting without writing changes.    |
| `npm run typecheck`     | Type-check without emitting output.          |
| `npm run icons`         | Regenerate placeholder extension icons.      |

## Icons

`src/assets/icons/*.png` are placeholder icons generated by
`scripts/generate-icons.mjs`. Replace them with real branded artwork before
shipping; the manifest already points at these exact filenames.

## Extension surfaces

| Surface | Entry point | Notes |
| --- | --- | --- |
| Popup | `src/popup/` | Default toolbar-icon UI. Closes when focus leaves it. |
| Side panel | `src/sidepanel/` | Reuses the popup's `App` component in a `sidepanel` variant that persists across tab/window switches. Opened via the ⇥ button in the popup, or the browser's built-in side panel picker. |
| Options page | `src/options/` | Reserved for future settings; currently a placeholder. |
| Background service worker | `src/background/` | Owns snapshot/switch/logout logic and the messaging bus. |
| Content script | `src/content/` | Injected on all pages; used by the background worker to read/write a page's storage. |

Switchboard's background worker also accepts messages from a small
allow-list of external origins (see `externally_connectable` in
`manifest.config.ts`), which lets trusted automation tools trigger account
switches without driving the popup UI directly.

