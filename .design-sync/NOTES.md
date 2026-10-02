# design-sync notes: Paper Atlas

- **Source is `design-system/paper-atlas/`, not `src/`.** The app's `src/components/paper-atlas` runs an older token set (no Instrument Sans interface register, no Button/Panel/PlaceHeader). Sync from the bundle folder.
- The package is a thin wrapper: `components/bundle.js` is a classic ES5 script that reads `window.React` and assigns `window.PaperAtlas`; `index.mjs` loads it (after `react-global.mjs`) and re-exports each component. Add a new component in all three places: `bundle.js`, `index.mjs`, `components/index.d.ts`.
- Run `node design-system/paper-atlas/build.mjs` (cfg.buildCmd) before the converter: it regenerates `tokens.css` from `tokens.json` and writes `dist/paper-atlas.css` (tokens + `components/bundle.css`), which is `cfg.cssEntry`. There is no separate tokens package, so `tokens/` stays empty in the upload; tokens ship inside `_ds_bundle.css`.
- Component docs are each `components/<Name>/README.md` with `category:` frontmatter (sets the group). Discovery can't match README.md by name, hence the `docsMap` entries.
- Fonts are self-hosted TTFs from google/fonts (OFL) under `fonts/`, wired via `fonts/fonts.css` (cfg.extraFonts).
- Render check: playwright 1.59.1 matches the cached chromium-1217 in ~/Library/Caches/ms-playwright; install it into `.ds-sync/`.
- `/login` after `/design-login` dropped the DesignSync authorization mid-run; re-run `/design-login`.

- **Brand book and foundation cards.** `design-system/paper-atlas/build.mjs` also runs `foundations.mjs`, which writes:
  - one guideline page per README section into `design-system/guidelines/` (outside the package on purpose: the converter keeps package-relative paths but flattens outside ones, so they land at `guidelines/*.md`; picked up by `cfg.guidelinesGlob`);
  - foundation cards (Cover, Colours, Type, SpaceAndShape, Logos, Globe) plus their logo SVGs and globe PNGs into `dist/foundations/`.
- **Post-build step (the converter can't do this):** after every build or driver run, `mkdir -p ds-bundle/guidelines/foundations && cp -R design-system/paper-atlas/dist/foundations/. ds-bundle/guidelines/foundations/`. The converter only copies `.md` into `guidelines/`, and it wipes `ds-bundle/` on each build. Skip this and the close-out reconciliation would delete the cards from the project.
- Upload SVG/PNG with an explicit `mimeType`; the local review server serves them as octet-stream, so test those cards from `file://` instead.
- The globe stills (`assets/Globe/globe-*.png`) are captured from the running app with SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader`), then the Next dev badge in the bottom-left is covered with a cloned patch of grain.

## Known render warns

- `[RENDER_THIN]` on Route: benign. It's a dashed SVG arc with no text; the screenshot shows all three arcs.
- Cursor and Ticket are set to `cardMode: column` because their stories are wider than a grid cell (`[GRID_OVERFLOW]`).

## Re-sync risks

- `components/bundle.js` is hand-written ES5, not compiled from the app's TypeScript. Changes to `src/components/paper-atlas/*.tsx` do NOT reach Claude Design until they're ported into `bundle.js` by hand.
- `tokens.json` here and `src/design/tokens.json` are separate copies; they have drifted before. Diff them before a re-sync.
- The globe stills are screenshots: they go stale whenever the globe's look changes. Re-capture them before a re-sync if the globe changed.
- Fonts were fetched from github.com/google/fonts at sync time; versions aren't pinned.
- The Route `Searching` and Ticket `Searching` cells animate; the stills don't show motion, so motion was never machine-checked.
