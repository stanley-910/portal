// Generates src/design/tokens.css from src/design/tokens.json (the Paper Atlas design system).
// Run with `pnpm tokens`; `pnpm dev` and `pnpm build` run it first. `--check` exits 1 when the CSS is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Themed = string | Record<string, string>;
type Token = { name: string; value: Themed; usage?: string };
type Family = { tokens: Token[] };
type TypeStyle = {
  name: string;
  /** Overrides the group's family, e.g. the italic `city` in the fell-sc group. */
  family?: string;
  fontSize: string;
  lineHeight: string | number;
  fontWeight: number | string;
  fontStyle?: string;
  letterSpacing?: string;
};
type Tokens = {
  name: string;
  color: { themes: { id: string; name: string }[]; tokens: Token[] };
  type: {
    families: Record<string, string>;
    groups: { name: string; family: string; styles: TypeStyle[] }[];
  };
  [family: string]: unknown;
};

const SRC = fileURLToPath(new URL("../src/design/tokens.json", import.meta.url));
const OUT = fileURLToPath(new URL("../src/design/tokens.css", import.meta.url));

const tokens = JSON.parse(readFileSync(SRC, "utf8")) as Tokens;
const [base, ...others] = tokens.color.themes.map((t) => t.id);

// "{ink}" is an alias for another token
const css = (v: string) => v.replace(/^\{([A-Za-z0-9_.-]+)\}$/, "var(--$1)");
const valueIn = (v: Themed, theme: string) => (typeof v === "string" ? (theme === base ? v : undefined) : v[theme]);
const length = (v: string | number) => (typeof v === "number" ? String(v) : v);

const families: [string, Family][] = Object.entries(tokens)
  .filter(([k, v]) => k !== "color" && k !== "type" && typeof v === "object" && v !== null && "tokens" in v)
  .map(([k, v]) => [k, v as Family]);
const all: Token[] = [...tokens.color.tokens, ...families.flatMap(([, f]) => f.tokens)];

const block = (selector: string, theme: string) => {
  const lines = all
    .map((t) => [t.name, valueIn(t.value, theme)] as const)
    .filter(([, v]) => v !== undefined)
    .map(([name, v]) => `  --${name}: ${css(String(v))};`);
  return lines.length ? `${selector} {\n${lines.join("\n")}\n}\n` : "";
};

const fontVars = Object.entries(tokens.type.families)
  .map(([name, stack]) => `  --font-${name}: ${stack};`)
  .join("\n");

const typeUtilities = tokens.type.groups
  .flatMap((g) =>
    g.styles.map((s) => {
      const decls = [
        `font-family: var(--font-${s.family ?? g.family});`,
        `font-size: ${s.fontSize};`,
        `line-height: ${length(s.lineHeight)};`,
        `font-weight: ${s.fontWeight};`,
        s.fontStyle && `font-style: ${s.fontStyle};`,
        s.letterSpacing && `letter-spacing: ${s.letterSpacing};`,
        s.name === "stamp" && "text-transform: uppercase;",
      ].filter(Boolean);
      return `@utility type-${s.name} {\n  ${decls.join("\n  ")}\n}`;
    }),
  )
  .join("\n");

const colorTheme = tokens.color.tokens.map((t) => `  --color-${t.name}: var(--${t.name});`).join("\n");
const utilities = (family: string, prefix: string, property: string) =>
  ((tokens[family] as Family | undefined)?.tokens ?? [])
    .map((t) => `@utility ${prefix}-${t.name.replace(new RegExp(`^${family}-`), "")} {\n  ${property}: var(--${t.name});\n}`)
    .join("\n");

const out = `/* Generated from src/design/tokens.json by scripts/tokens.mts. Do not edit by hand: change the JSON and run \`pnpm tokens\`. */

/* Theme "${base}" is the default; ${others.map((t) => `"${t}"`).join(", ")} apply under html.${others[0]} (next-themes). */
${block(":root", base)}
${others.map((t) => block(`.${t}`, t)).join("\n")}
/* Font stacks at zero specificity, so the next/font variables set on <html> in src/app/fonts.ts win when present. */
:where(:root) {
${fontVars}
}

/* Tailwind: bg-paper, text-ink, border-ink, font-fell-sc, type-code, rounded-ticket, shadow-tag, ... */
@theme inline {
${colorTheme}
}

${Object.keys(tokens.type.families)
  .map((f) => `@utility font-${f} {\n  font-family: var(--font-${f});\n}`)
  .join("\n")}
${typeUtilities}
${utilities("radius", "rounded", "border-radius")}
${utilities("shadow", "shadow", "box-shadow")}
`;

if (process.argv.includes("--check")) {
  const current = (() => {
    try {
      return readFileSync(OUT, "utf8");
    } catch {
      return "";
    }
  })();
  if (current !== out) {
    console.error("src/design/tokens.css is out of date. Run `pnpm tokens`.");
    process.exit(1);
  }
} else {
  writeFileSync(OUT, out);
  console.log(`tokens: wrote ${all.length} tokens (${tokens.color.themes.length} themes) to src/design/tokens.css`);
}
