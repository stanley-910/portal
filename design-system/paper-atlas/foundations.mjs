// Builds the brand book and foundation pages for Claude Design from README.md,
// tokens.json and the logo files:
//   ../guidelines/*.md            one page per brand-book section (generated, outside the package so the sync flattens it into guidelines/)
//   dist/foundations/*.html       preview cards: cover, colour, type, space & shape, logos
//   dist/foundations/logos/*.svg  the logo files the logos card shows
//   dist/foundations/globe/*.png  stills of the app's globe, Day and Night
// The cards link ../../styles.css, so they belong at guidelines/foundations/ in the upload.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const t = JSON.parse(readFileSync(here('./tokens.json'), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// -- brand book: one markdown page per "## " section
function guidelines() {
  const out = here('../guidelines/');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const md = readFileSync(here('./README.md'), 'utf8');
  const [intro, ...sections] = md.split(/^## /m);
  const pages = [['Overview', intro.replace(/^# .*\n/, '').trim()]];
  for (const s of sections) {
    const [title, ...body] = s.split('\n');
    // the bundle's own reference folder isn't uploaded, so its section would point nowhere
    if (/^Reference material/.test(title)) continue;
    pages.push([title.trim(), body.join('\n').trim()]);
  }
  pages.forEach(([title, body], i) => {
    const n = String(i).padStart(2, '0');
    writeFileSync(new URL(`${n}-${slug(title)}.md`, out), `# ${title}\n\n${body}\n`);
  });
  return pages.length;
}

// -- foundation cards
const card = (group, viewport, title, body, extraCss = '') => `<!-- @dsCard group="${group}" viewport="${viewport}" -->
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="stylesheet" href="../../styles.css">
<style>
  body { margin: 0; padding: var(--space-5); background: var(--paper); color: var(--ink); font-family: var(--font-sans); }
  h2 { margin: 0 0 var(--space-3); }
  section + section { margin-top: var(--space-5); }
  .label { font-family: var(--font-typewriter); font-size: 12px; line-height: 16px; font-weight: 700; }
  .meta { font-family: var(--font-typewriter); font-size: 12px; line-height: 16px; color: var(--ink-muted); }
  .usage { font-size: 13px; line-height: 18px; color: var(--ink-muted); }
${extraCss}
</style>
</head><body>
${body}
</body></html>
`;

const themed = (v) => (typeof v === 'string' ? { light: v, dark: v } : { light: v.light, dark: v.dark ?? v.light });
const resolve = (v, theme) => {
  const raw = themed(v)[theme];
  const alias = /^\{(.+)\}$/.exec(raw);
  return alias ? resolve(t.color.tokens.find((x) => x.name === alias[1]).value, theme) : raw;
};

function colourCard() {
  const groups = [
    ['Paper and ink', ['paper', 'paper-raised', 'ink', 'ink-muted', 'ink-hover', 'on-ink', 'focus']],
    ['Controls and lines', ['control-hover', 'control-border', 'line', 'rule']],
    ['Print inks (globe and maps only)', ['sea', 'sea-deep', 'sage', 'moss']],
    ['Stickers (same in both themes)', ['sticker-fill', 'sticker-ink', 'star-light', 'star-edge', 'roundel', 'sticker-shadow']],
    ['Members (cursors and name labels only)', t.color.tokens.filter((x) => x.name.startsWith('member-')).map((x) => x.name)],
  ];
  const byName = new Map(t.color.tokens.map((x) => [x.name, x]));
  const body = groups.map(([title, names]) => `<section><h2 class="type-heading">${esc(title)}</h2><div class="grid">${names
    .filter((n) => byName.has(n))
    .map((n) => {
      const tok = byName.get(n);
      const day = resolve(tok.value, 'light');
      const night = resolve(tok.value, 'dark');
      return `<div class="swatch"><div class="chips"><span style="background:${esc(day)}"></span><span style="background:${esc(night)}"></span></div>
<div class="label">${esc(n)}</div><div class="meta">${esc(day)}${night !== day ? ` / ${esc(night)}` : ''}</div><div class="usage">${esc(tok.usage ?? '')}</div></div>`;
    })
    .join('')}</div></section>`).join('\n');
  return card('Colours', '1100x2100', 'Colour', `<p class="type-caption" style="margin:0 0 var(--space-4)">Each chip shows Day, then Night.</p>${body}`, `
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--space-4); }
  .swatch { background: var(--paper-raised); border: 1px solid var(--line); border-radius: var(--radius-ticket); padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-1); }
  .chips { display: flex; height: 48px; border-radius: var(--radius-tag); overflow: hidden; border: 1px solid var(--line); margin-bottom: var(--space-2); }
  .chips span { flex: 1; }`);
}

function typeCard() {
  const rows = t.type.groups.map((g) => `<section><h2 class="type-heading">${esc(g.name)}</h2>${g.styles
    .map((s) => `<div class="row"><div class="spec"><div class="label">${esc(s.name)}</div><div class="meta">${esc(s.family ?? g.family)} · ${esc(s.fontSize)} / ${esc(s.lineHeight)}</div></div>
<div class="type-${esc(s.name)}">${esc(s.sample)}</div><div class="usage">${esc(s.usage ?? '')}</div></div>`)
    .join('')}</section>`).join('\n');
  return card('Type', '1000x1300', 'Type', rows, `
  .row { display: grid; grid-template-columns: 160px 1fr 260px; gap: var(--space-4); align-items: baseline; padding: var(--space-3) 0; border-bottom: 1px solid var(--line); }`);
}

function shapeCard() {
  const fam = (k) => t[k]?.tokens ?? [];
  const space = fam('spacing').map((x) => `<div class="srow"><span class="label">${esc(x.name)}</span><span class="bar" style="width:var(--${esc(x.name)})"></span><span class="meta">${esc(x.value)}</span><span class="usage">${esc(x.usage ?? '')}</span></div>`).join('');
  const radius = fam('radius').map((x) => `<div class="tile"><span class="box" style="border-radius:var(--${esc(x.name)})"></span><span class="label">${esc(x.name)}</span><span class="meta">${esc(x.value)}</span></div>`).join('');
  const shadow = fam('shadow').map((x) => `<div class="tile"><span class="box" style="border-radius:var(--radius-ticket);box-shadow:var(--${esc(x.name)})"></span><span class="label">${esc(x.name)}</span><span class="usage">${esc(x.usage ?? '')}</span></div>`).join('');
  const lines = fam('line').map((x) => `<div class="srow"><span class="label">${esc(x.name)}</span><svg width="160" height="12" aria-hidden="true"><line x1="2" y1="6" x2="158" y2="6" stroke="var(--ink)" stroke-linecap="round" ${x.name.startsWith('dash') ? `stroke-width="2" stroke-dasharray="${esc(x.value)}"` : `stroke-width="${esc(parseFloat(x.value))}"`}/></svg><span class="meta">${esc(x.value)}</span><span class="usage">${esc(x.usage ?? '')}</span></div>`).join('');
  return card('Spacing', '1000x1200', 'Space and shape',
    `<section><h2 class="type-heading">Space</h2>${space}</section><section><h2 class="type-heading">Radius</h2><div class="tiles">${radius}</div></section><section><h2 class="type-heading">Shadow</h2><div class="tiles">${shadow}</div></section><section><h2 class="type-heading">Line</h2>${lines}</section>`, `
  .srow { display: grid; grid-template-columns: 140px 170px 90px 1fr; gap: var(--space-4); align-items: center; padding: var(--space-2) 0; }
  .bar { display: block; height: 12px; background: var(--ink); }
  .tiles { display: flex; flex-wrap: wrap; gap: var(--space-5); }
  .tile { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-1); width: 180px; }
  .box { display: block; width: 72px; height: 72px; background: var(--paper-raised); border: 1px solid var(--ink); margin-bottom: var(--space-2); }`);
}

function logosCard() {
  const out = here('./dist/foundations/logos/');
  mkdirSync(out, { recursive: true });
  const files = readdirSync(here('./assets/Logos/')).filter((f) => f.endsWith('.svg')).sort();
  for (const f of files) copyFileSync(new URL(f, here('./assets/Logos/')), new URL(f, out));
  const tile = (f) => {
    const dark = f.includes('-dark');
    return `<figure${dark ? ' data-theme="dark"' : ''}><img src="logos/${esc(f)}" alt="${esc(f.replace(/\.svg$/, ''))}"><figcaption class="meta">${esc(f)}</figcaption></figure>`;
  };
  return card('Brand', '1000x1150', 'Logos',
    `<p class="type-body" style="margin:0 0 var(--space-4)">Use the files as they are: never redraw, recolour or re-letter them. <code>-light</code> goes on Day paper, <code>-dark</code> on Night paper.</p><div class="logos">${files.map(tile).join('')}</div>`, `
  .logos { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-4); }
  figure { margin: 0; padding: var(--space-5); border-radius: var(--radius-ticket); border: 1px solid var(--line); display: flex; flex-direction: column; align-items: center; gap: var(--space-3); }
  figure { background: var(--paper); }
  img { max-width: 100%; max-height: 120px; }`);
}

function globeCard() {
  // the live globe is WebGL in the app; designs get these stills of it to sit panels and tickets over
  const out = here('./dist/foundations/globe/');
  mkdirSync(out, { recursive: true });
  for (const f of ['globe-day.png', 'globe-night.png']) copyFileSync(new URL(f, here('./assets/Globe/')), new URL(f, out));
  return card('Brand', '1000x1050', 'Globe',
    `<p class="type-body" style="margin:0 0 var(--space-4)">The globe is the whole screen; everything else floats over it. In the app it is live WebGL. In a design, use these stills as the backdrop: <code>globe/globe-day.png</code> by day, <code>globe/globe-night.png</code> by night.</p>
<figure><img src="globe/globe-day.png" alt="The globe by day"><figcaption class="meta">globe-day.png</figcaption></figure>
<figure data-theme="dark"><img src="globe/globe-night.png" alt="The globe by night"><figcaption class="meta">globe-night.png</figcaption></figure>`, `
  figure { margin: 0 0 var(--space-4); background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-ticket); overflow: hidden; }
  figure img { display: block; width: 100%; }
  figcaption { padding: var(--space-2) var(--space-3); }`);
}

function coverCard() {
  // the cover from the original design system, with the card header this app reads
  const src = readFileSync(here('./components/Cover/preview.html'), 'utf8')
    .replace(/^<!--.*-->\n/, '')
    .replace(/<link rel="stylesheet" href="https:\/\/fonts[^>]*>\n/, '<link rel="stylesheet" href="../../styles.css">\n');
  return `<!-- @dsCard group="Brand" viewport="960x288" -->\n${src}`;
}

export function buildFoundations() {
  const pages = guidelines();
  const out = here('./dist/foundations/');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const cards = { 'Cover.html': coverCard(), 'Colours.html': colourCard(), 'Type.html': typeCard(), 'SpaceAndShape.html': shapeCard(), 'Logos.html': logosCard(), 'Globe.html': globeCard() };
  for (const [f, html] of Object.entries(cards)) writeFileSync(new URL(f, out), html);
  return { pages, cards: Object.keys(cards).length };
}
