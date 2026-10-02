# Building with Paper Atlas

Paper Atlas is ink printed on paper. Lay every screen on `var(--paper)`; put raised surfaces on `var(--paper-raised)`; set text and borders in `var(--ink)` (secondary text `var(--ink-muted)`). There is no accent colour.

## Setup

- No provider or wrapper. Components read CSS custom properties from `styles.css`, so they work anywhere that stylesheet is loaded.
- **Themes:** Day is the default. Night applies to everything under an element with `data-theme="dark"` (or class `dark`); put it on `<html>` for a whole screen.
- Fonts ship in the bundle: `--font-sans` (Instrument Sans), `--font-fell-sc`, `--font-fell` (IM Fell English), `--font-typewriter` (Courier Prime).

## Two registers

- **Interface** (anything a person operates): `Button`, `RoundButton`, `Panel`, and text in `.type-title`, `.type-heading`, `.type-body`, `.type-label`, `.type-button`, `.type-caption`. Soft corners (`--radius-control`, `--radius-panel`), soft shadow (`--shadow-float`).
- **Atlas** (the trip itself): `Ticket`, `Tag`, `Sticker`, `Route`, `Cursor`, `PlaceHeader`'s place name, and `.type-code`, `.type-destination`, `.type-city`, `.type-stamp`, `.type-meta`, `.type-tag`. Hard offset shadows (`--shadow-ticket`, `--shadow-tag`).
- Never set interface text in the serif, or a place name in the sans.

## Styling your own layout

Use the tokens as `var(--name)`, never raw values:
- Colour: `--paper`, `--paper-raised`, `--ink`, `--ink-muted`, `--line` (dividers), `--control-border`, `--rule` (faint non-text marks). `--sea`, `--sage`, `--moss` are map inks only, never UI.
- Space: `--space-1` 4, `--space-2` 6, `--space-gap` 10, `--space-control` 16, `--space-3` 18, `--space-4` 20, `--space-5` 26, `--space-6` 32 (px).
- Radius: `--radius-tag`, `--radius-ticket`, `--radius-control`, `--radius-panel`, `--radius-round`.
- Members: `--member-1` to `--member-6`, only for a person's cursor and name label; get one with `memberColor(slot)`.

## Content

Airport codes as three capitals (`HKG`); city names in their own spelling; dates like `Sat 3 Oct`; distances like `9,624 km`. Buttons are a verb plus object in sentence case (`Search flights`). One primary `Button` per view. No emoji or exclamation marks.

## Example

```jsx
const { Panel, PlaceHeader, Button } = window.PaperAtlas;

<div style={{ background: 'var(--paper)', padding: 'var(--space-6)' }}>
  <Panel onClose={() => {}}>
    <PlaceHeader eyebrow="Flights to" name="Shanghai" detail="Pudong · PVG" />
    <div style={{ height: 1, background: 'var(--line)' }} />
    <p className="type-body" style={{ margin: 0 }}>Six flights leave tomorrow morning.</p>
    <div style={{ display: 'flex', gap: 'var(--space-gap)' }}>
      <Button>Search flights</Button>
      <Button variant="secondary">Change date</Button>
    </div>
  </Panel>
</div>
```
