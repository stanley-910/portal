# LogoReveal

`<portal-logo-reveal>` draws the horizontal Portal logo on first sight: the globe's rim, meridians and latitudes draw on, the stipple and the lower hemisphere are scribbled in, and the word is scribbled in last with a lightly aged print texture. Vanilla web component, no dependencies; works in any framework.

## Use

```html
<script src="design-system/paper-atlas/components/LogoReveal/logo-reveal.js"></script>
<portal-logo-reveal style="width:180px"></portal-logo-reveal>
```

Or in a bundled app (React, Vite, Next): `import './path/to/logo-reveal.js'` once on the client, then render `<portal-logo-reveal style={{ width: 180 }} />`. In Next.js, import it inside a `useEffect` or a `'use client'` component.

The SVGs are built into the file, so there are no asset paths to configure. Size it with `width`; the lockup keeps the horizontal logo's proportions.

Don't replace this with the static `portal-logo-horizontal-*.svg` as an `<img>`: that file can't animate. The animation only runs through `<portal-logo-reveal>`.

## Attributes

- `theme`: `day` or `night`. Default: `night` under a `data-theme="dark"` / `.dark` ancestor, otherwise `day`.
- `duration`: seconds, default `1.4`. `1.2` for a header.
- `grain`: `0`–`1` aged-ink amount on the word, default `.5`.
- `swing="false"`: no settle motion.
- `--portal-mark-scale` (CSS custom property): shrinks the globe beside the word, e.g. `.75`. Default `1`, the horizontal logo's proportions. The word keeps its size, leaving the freed width empty at the right.
- `replay-on-click="false"`: disable click to replay. Call `.play()` to replay yourself.

Fires `portal-logo-reveal:done` when finished. With reduced motion preferred it jumps to the end state.

## Navbar

Play once per session, then show the static `portal-logo-horizontal-*.svg`:

```js
if (!sessionStorage.getItem('portal-logo-seen')) {
  logo.addEventListener('portal-logo-reveal:done', () => sessionStorage.setItem('portal-logo-seen', '1'));
} else {
  logo.replaceWith(staticLogoImg);
}
```
