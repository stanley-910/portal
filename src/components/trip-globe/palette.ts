// Globe colours, read from the design tokens so the WebGL and canvas layers match the CSS exactly.
import tokens from "@/design/tokens.json";

export type ThemeId = "light" | "dark";
export type RGB = [number, number, number];

type TokenValue = string | Partial<Record<ThemeId, string>>;
const byName = new Map<string, TokenValue>(
  [...tokens.color.tokens, ...tokens.shadow.tokens, ...tokens.print.tokens].map((t) => [t.name, t.value as TokenValue]),
);

/** A token's CSS value in a theme. Values missing a theme inherit the first (light) one, as in tokens.json. */
function token(name: string, theme: ThemeId): string {
  const v = byName.get(name);
  if (v === undefined) throw new Error(`Unknown design token: ${name}`);
  const raw = typeof v === "string" ? v : (v[theme] ?? v.light ?? "");
  const alias = /^\{(.+)\}$/.exec(raw);
  return alias ? token(alias[1], theme) : raw;
}

/** "#rrggbb" or "rgb(a)(r, g, b, a)" as 0–1 channels plus alpha. */
function parse(css: string): { rgb: RGB; a: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(css);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { rgb: [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255], a: 1 };
  }
  const fn = /rgba?\(([^)]+)\)/.exec(css);
  if (fn) {
    const [r, g, b, a = 1] = fn[1].split(",").map(Number);
    return { rgb: [r / 255, g / 255, b / 255], a };
  }
  throw new Error(`Unsupported colour: ${css}`);
}
const rgb = (name: string, theme: ThemeId) => parse(token(name, theme)).rgb;
/** The colour inside a shadow token, e.g. "2px 2px 0 rgba(…)" → "rgba(…)". */
const shadowColor = (name: string, theme: ThemeId) => /rgba?\([^)]+\)/.exec(token(name, theme))?.[0] ?? "transparent";

export interface Palette {
  dark: 0 | 1;
  paper: string;
  raised: string;
  ink: string;
  /** ink as "r,g,b" (0–255) for building rgba() strings with other alphas */
  inkRGB: string;
  muted: string;
  tagShadow: string;
  /** The viewer's own cursor's shadow, which the overlay draws so it can trail the pointer. */
  cursorShadow: string;
  /** Opacity of the sky's stippled ink. Light paper takes it a touch softer. */
  skyInk: number;
  gl: Record<"uPaper" | "uInk" | "uSea" | "uSeaDeep" | "uSage" | "uMoss" | "uShade", RGB>;
  stickerGL: { fill: RGB; ink: RGB; roundel: RGB };
}

// The tint of the plane's shadow on the ground. Not a token: it only exists inside the shader.
const SHADE: Record<ThemeId, RGB> = { light: [0.87, 0.86, 0.8], dark: [0.55, 0.55, 0.62] };
const SKY_INK: Record<ThemeId, number> = { light: 0.7, dark: 0.95 };

function build(theme: ThemeId): Palette {
  const ink = parse(token("ink", theme)).rgb;
  return {
    dark: theme === "dark" ? 1 : 0,
    paper: token("paper", theme),
    raised: token("paper-raised", theme),
    ink: token("ink", theme),
    inkRGB: ink.map((c) => Math.round(c * 255)).join(","),
    muted: token("ink-muted", theme),
    tagShadow: shadowColor("shadow-tag", theme),
    cursorShadow: token("sticker-shadow", theme),
    skyInk: SKY_INK[theme],
    gl: {
      uPaper: rgb("paper", theme),
      uInk: ink,
      uSea: rgb("sea", theme),
      uSeaDeep: rgb("sea-deep", theme),
      uSage: rgb("sage", theme),
      uMoss: rgb("moss", theme),
      uShade: SHADE[theme],
    },
    stickerGL: {
      fill: rgb("sticker-fill", theme),
      ink: rgb("sticker-ink", theme),
      roundel: rgb("roundel", theme),
    },
  };
}

/** Distance between halftone dots, in CSS pixels. */
export const HALFTONE_PITCH = parseFloat(token("halftone-pitch", "light"));

export const PALETTES: Record<ThemeId, Palette> = { light: build("light"), dark: build("dark") };

/** The `country` type style: country names printed on the globe. */
export const COUNTRY_TYPE = (() => {
  type Style = { name: string; fontSize: string; fontWeight: number; letterSpacing?: string };
  const styles = tokens.type.groups.flatMap((g) => g.styles as Style[]);
  const s = styles.find((st) => st.name === "country");
  if (!s) throw new Error("Missing design token: type country");
  return { size: parseFloat(s.fontSize), weight: s.fontWeight, spacing: parseFloat(s.letterSpacing ?? "0") };
})();
