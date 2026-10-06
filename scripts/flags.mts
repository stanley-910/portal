// Generates src/components/ticket-search/flags.generated.ts: every country's flag as a 14×10 grid of flat colours,
// from flag-icons' flat SVGs, so a flag looks the same on every machine (no emoji font, no runtime sampling). Hand-drawn
// flags in flag-art.ts still win. Run with `pnpm flags`; `--check` exits 1 when the file is stale.
//
// Each SVG is stretched to the grid's 1.4:1 and rendered at CELL px a cell. The flag's inks are the colours that cover
// enough of it; each cell takes the ink covering most of it, with a nudge for rare inks so small stars and emblems
// aren't always outvoted by their field. Same input, same output.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

const FW = 14;
const FH = 10;
const CELL = 24;
/** An ink must cover this share of the flag. */
const MIN_SHARE = 0.004;
/** Colours closer than this are one ink (anti-aliasing and near-duplicate fills). */
const MERGE = 48;
const MAX_INKS = 8;
/** How much a rare ink is favoured in a cell: its coverage is divided by its share of the flag to this power. */
const RARITY = 0.3;
/** A cell needs this much of it opaque to be drawn (Nepal's shape). */
const OPAQUE = 0.5;
const LETTERS = "ABCDEFGHIJKLMNOP";

const require = createRequire(import.meta.url);
const SVGS = join(dirname(require.resolve("flag-icons/package.json")), "flags", "4x3");
const CODES = fileURLToPath(new URL("../src/lib/entry/iso-codes.json", import.meta.url));
const OUT = fileURLToPath(new URL("../src/components/ticket-search/flags.generated.ts", import.meta.url));

type RGB = [number, number, number];
const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hex = (c: RGB) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function render(svg: string): Uint8Array {
  const w = FW * CELL;
  const h = FH * CELL;
  const sized = svg.replace(/<svg\b[^>]*>/, (tag) =>
    tag.replace(/\s(width|height|preserveAspectRatio)="[^"]*"/g, "").replace(/^<svg/, `<svg width="${w}" height="${h}" preserveAspectRatio="none"`),
  );
  return new Resvg(sized, { fitTo: { mode: "original" }, shapeRendering: 2 }).render().pixels;
}

function flag(code: string): { inks: Record<string, string>; rows: string[] } {
  const px = render(readFileSync(join(SVGS, `${code.toLowerCase()}.svg`), "utf8"));
  const W = FW * CELL;
  const total = W * FH * CELL;

  // the inks: exact colours by how much they cover, merged when close, the commonest first
  const counts = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 250) continue;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const inks: { rgb: RGB; n: number }[] = [];
  for (const [key, n] of [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
    const rgb: RGB = [key >> 16, (key >> 8) & 255, key & 255];
    const near = inks.find((ink) => dist(ink.rgb, rgb) < MERGE);
    if (near) near.n += n;
    else if (n / total >= MIN_SHARE && inks.length < MAX_INKS) inks.push({ rgb, n });
  }
  const nearest = (rgb: RGB) => inks.reduce((best, ink, i) => (dist(ink.rgb, rgb) < dist(inks[best].rgb, rgb) ? i : best), 0);
  const weight = inks.map((ink) => (ink.n / total) ** RARITY);

  const cells: (number | null)[][] = [];
  for (let cy = 0; cy < FH; cy++) {
    const row: (number | null)[] = [];
    for (let cx = 0; cx < FW; cx++) {
      const cover = inks.map(() => 0);
      let opaque = 0;
      for (let y = cy * CELL; y < (cy + 1) * CELL; y++) {
        for (let x = cx * CELL; x < (cx + 1) * CELL; x++) {
          const i = (y * W + x) * 4;
          if (px[i + 3] < 128) continue;
          opaque++;
          cover[nearest([px[i], px[i + 1], px[i + 2]])]++;
        }
      }
      if (opaque < CELL * CELL * OPAQUE) {
        row.push(null);
        continue;
      }
      let best = 0;
      cover.forEach((c, i) => {
        if (c / weight[i] > cover[best] / weight[best]) best = i;
      });
      row.push(best);
    }
    cells.push(row);
  }

  // letters in order of first use, so the rows read the same run to run
  const used = [...new Set(cells.flat().filter((i): i is number => i !== null))];
  const letter = new Map(used.map((ink, i) => [ink, LETTERS[i]]));
  return {
    inks: Object.fromEntries(used.map((ink) => [letter.get(ink)!, hex(inks[ink].rgb)])),
    rows: cells.map((row) => row.map((i) => (i === null ? " " : letter.get(i))).join("")),
  };
}

const codes = Object.keys(JSON.parse(readFileSync(CODES, "utf8")) as Record<string, string>).sort();
const body = codes
  .map((code) => {
    const f = flag(code);
    const inks = Object.entries(f.inks).map(([k, v]) => `${k}: "${v}"`).join(", ");
    return `  ${code}: {\n    inks: { ${inks} },\n    rows: [\n${f.rows.map((r) => `      "${r}",`).join("\n")}\n    ],\n  },`;
  })
  .join("\n");
const out = `// Generated from flag-icons' SVGs by scripts/flags.mts. Do not edit by hand: run \`pnpm flags\`, or draw a flag
// in flag-art.ts to override it. A space is a cell outside the flag.
import type { FlagArt } from "./flag-art";

export const GENERATED_FLAGS: Record<string, FlagArt> = {
${body}
};
`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {}
  if (current !== out) {
    console.error("src/components/ticket-search/flags.generated.ts is out of date. Run `pnpm flags`.");
    process.exit(1);
  }
} else {
  writeFileSync(OUT, out);
  console.log(`flags: wrote ${codes.length} flags to src/components/ticket-search/flags.generated.ts`);
}
