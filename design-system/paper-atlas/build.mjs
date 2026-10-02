// Builds dist/paper-atlas.css: the tokens (from tokens.json) followed by the
// component styles (components/bundle.css), plus the brand book pages and
// foundation cards (foundations.mjs). Run with `node build.mjs`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { buildFoundations } from './foundations.mjs';

const t = JSON.parse(readFileSync(new URL('./tokens.json', import.meta.url), 'utf8'));
const [base, night] = t.color.themes.map((x) => x.id);
const valueIn = (v, theme) => (typeof v === 'string' ? (theme === base ? v : undefined) : v[theme]);
const css = (v) => v.replace(/^\{(.+)\}$/, 'var(--$1)');
const families = Object.values(t).filter((v) => v && typeof v === 'object' && Array.isArray(v.tokens));

const block = (theme) =>
  families
    .flatMap((f) => f.tokens)
    .map((x) => [x.name, valueIn(x.value, theme)])
    .filter(([, v]) => v !== undefined)
    .map(([n, v]) => `  --${n}: ${css(String(v))};`);

const fonts = Object.entries(t.type.families).map(([k, s]) => `  --font-${k}: ${s};`);

const typeClasses = t.type.groups.flatMap((g) =>
  g.styles.map((s) => {
    const d = [
      `font-family: var(--font-${s.family ?? g.family});`,
      `font-size: ${s.fontSize};`,
      `line-height: ${s.lineHeight};`,
      `font-weight: ${s.fontWeight};`,
      s.fontStyle && `font-style: ${s.fontStyle};`,
      s.letterSpacing && `letter-spacing: ${s.letterSpacing};`,
      s.name === 'stamp' && 'text-transform: uppercase;',
    ].filter(Boolean);
    return `.type-${s.name} { ${d.join(' ')} }`;
  }),
);

const tokensCss = [
  `/* Paper Atlas tokens, generated from tokens.json by build.mjs. Day is the default; Night applies under [data-theme="dark"] or .dark. */`,
  ':root {', ...block(base), ...fonts, '}', '',
  '[data-theme="dark"], .dark {', ...block(night), '}', '',
  ...typeClasses, '',
].join('\n');

writeFileSync(new URL('./tokens.css', import.meta.url), tokensCss);
mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
const components = readFileSync(new URL('./components/bundle.css', import.meta.url), 'utf8');
writeFileSync(new URL('./dist/paper-atlas.css', import.meta.url), `${tokensCss}\n${components}`);
const f = buildFoundations();
console.log(`wrote tokens.css, dist/paper-atlas.css, ${f.pages} guideline pages and ${f.cards} foundation cards`);
