"use client";

import { useRef } from "react";

import { usePixelCanvas, type Colors } from "@/components/agent/pixel";
import { countryName, flagEmoji } from "@/lib/nationality";

import { FLAG_ART, type FlagArt } from "./flag-art";
import { GENERATED_FLAGS } from "./flags.generated";

// A country's flag as one of Pip's pixel stickers: a 14×10 grid of flat colours, masked like Pip's speech bubble
// (stepped corners, a 1-cell ink outline, a dithered shade and a starlight glint). It dithers in and flutters once when
// it first shows. Flags with emblems too fine for the grid are hand-drawn (flag-art.ts); the rest are generated from
// flat SVGs by scripts/flags.mts (flags.generated.ts); an unknown country gets a generic one. `source="emoji"` samples
// the system's flag emoji instead, as flags were drawn before, for comparing in the playground.

const FW = 14;
const FH = 10;
/** The canvas in cells: the flag, its outline, and a cell below for the flutter. */
const W = FW + 2;
const H = FH + 3;
/** CSS px per cell: small enough to sit on a city name's line. */
const SCALE = 1;
const TICK_MS = 40;
/** Ticks to dither in, and to flutter after. */
const REVEAL = 8;
const SETTLE = 22;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

type Grid = (string | null)[][];

const sampled = new Map<string, Grid | null>();

const cells = (art: FlagArt): Grid => art.rows.map((row) => [...row].map((c) => art.inks[c] ?? null));

/** The flag's cells as CSS colours: hand-drawn, else generated; or, for `emoji`, sampled from the emoji. */
function flagCells(code: string, source: "art" | "emoji"): Grid | null {
  const art = source === "art" ? FLAG_ART[code.toUpperCase()] ?? GENERATED_FLAGS[code.toUpperCase()] : undefined;
  if (art) return cells(art);
  if (source === "art") return null;
  if (sampled.has(code)) return sampled.get(code)!;
  const grid = sample(code);
  sampled.set(code, grid);
  return grid;
}

/** The flag emoji sampled down to the grid, or null when there's no colour emoji (e.g. Windows draws letters). */
function sample(code: string): Grid | null {
  const emoji = flagEmoji(code);
  if (!emoji) return null;
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.font = `144px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, size / 2, size / 2);
  const { data } = ctx.getImageData(0, 0, size, size);
  const alpha = (x: number, y: number) => data[(y * size + x) * 4 + 3];

  // the flag's box, trimmed of the glyph's margins
  let [x0, y0, x1, y1] = [size, size, -1, -1];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (alpha(x, y) < 64) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return null;
  // inset past the emoji's own rim and edge shading
  const ix = Math.round((x1 - x0) * 0.04);
  const iy = Math.round((y1 - y0) * 0.05);
  [x0, x1, y0, y1] = [x0 + ix, x1 - ix, y0 + iy, y1 - iy];

  // each cell takes the most common colour among the pixels it covers, so stripes stay crisp and small emblems
  // aren't averaged away into their field
  const raw: ([number, number, number] | null)[][] = [];
  for (let cy = 0; cy < FH; cy++) {
    const row: ([number, number, number] | null)[] = [];
    for (let cx = 0; cx < FW; cx++) {
      const sx = x0 + ((x1 - x0 + 1) * cx) / FW;
      const sy = y0 + ((y1 - y0 + 1) * cy) / FH;
      const ex = x0 + ((x1 - x0 + 1) * (cx + 1)) / FW;
      const ey = y0 + ((y1 - y0 + 1) * (cy + 1)) / FH;
      const buckets = new Map<number, [number, number, number, number]>();
      for (let y = Math.floor(sy); y < Math.ceil(ey); y++) {
        for (let x = Math.floor(sx); x < Math.ceil(ex); x++) {
          const i = (y * size + x) * 4;
          if (data[i + 3] < 128) continue;
          const key = ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5);
          const b = buckets.get(key) ?? [0, 0, 0, 0];
          b[0] += data[i];
          b[1] += data[i + 1];
          b[2] += data[i + 2];
          b[3]++;
          buckets.set(key, b);
        }
      }
      let top: [number, number, number, number] | null = null;
      for (const b of buckets.values()) if (!top || b[3] > top[3]) top = b;
      row.push(top ? [top[0] / top[3], top[1] / top[3], top[2] / top[3]] : null);
    }
    raw.push(row);
  }

  // flatten to a few inks, the most common first, so stripes stay crisp and the emoji's gloss drops out
  const counts = new Map<string, { rgb: [number, number, number]; n: number }>();
  for (const rgb of raw.flat()) {
    if (!rgb) continue;
    const key = rgb.map((c) => Math.round(c / 16)).join();
    const hit = counts.get(key);
    if (hit) hit.n++;
    else counts.set(key, { rgb, n: 1 });
  }
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const inks: [number, number, number][] = [];
  for (const { rgb } of [...counts.values()].sort((a, b) => b.n - a.n)) {
    if (inks.length < 6 && inks.every((ink) => dist(ink, rgb) > 80)) inks.push(rgb);
  }
  // no colour at all: the system drew the code's letters, not a flag
  if (inks.every((c) => Math.max(...c) - Math.min(...c) < 32)) return null;
  const css = inks.map(([r, g, b]) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`);
  return raw.map((row) =>
    row.map((rgb) => {
      if (!rgb) return null;
      let best = 0;
      inks.forEach((ink, i) => {
        if (dist(ink, rgb) < dist(inks[best], rgb)) best = i;
      });
      return css[best];
    }),
  );
}

/** A plain flag for an unknown country: a starlight field with a band of Pip green. */
const generic = (colors: Colors): Grid =>
  Array.from({ length: FH }, (_, y) => Array.from({ length: FW }, () => (y >= 4 && y < 6 ? colors.body : colors.light)));

/** The corner cells the stepped mask cuts, as on Pip's speech bubble. */
const cut = (x: number, y: number) => (x === 0 || x === FW - 1) && (y === 0 || y === FH - 1);

/** `scale` is CSS px a cell: 1 on a city's line; larger to inspect a flag (the playground's Flags section). */
export function PixelFlag({ country, scale = SCALE, source = "art", className }: {
  country?: string | null;
  scale?: number;
  source?: "art" | "emoji";
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  usePixelCanvas(
    canvas,
    (ctx, colors, tick, still) => {
      const flag = (country && flagCells(country, source)) || generic(colors);
      const shown = still ? Infinity : tick;
      const amp = shown < SETTLE ? 1 : 0;
      // each column's drop for the flutter: a ripple running from the hoist to the fly
      const drop = (x: number) => (amp && Math.sin((x - shown * 0.9) / 2) > 0.3 ? 1 : 0);
      const at: Grid = Array.from({ length: H }, () => Array(W).fill(null));
      for (let y = 0; y < FH; y++) {
        for (let x = 0; x < FW; x++) {
          if (cut(x, y) || !flag[y][x]) continue;
          // dither in on a 4×4 Bayer order
          if (BAYER[(y % 4) * 4 + (x % 4)] >= ((shown + 1) * 16) / REVEAL) continue;
          at[y + 1 + drop(x)][x + 1] = flag[y][x];
        }
      }
      const put = (x: number, y: number, color: string, alpha = 1) => {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      };
      const filled = (x: number, y: number) => !!at[y]?.[x];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const color = at[y][x];
          if (color) {
            put(x, y, color);
            // the shade: a checker of ink over the lower-right, like Pip's body
            const fx = x - 1;
            const fy = y - 1 - drop(fx);
            if ((fx - FW / 2) * 0.5 + (fy - FH / 2) * 0.9 > 3 && (fx + fy) % 2 === 0) put(x, y, colors.ink, 0.22);
            if ((fx === 1 && fy === 1) || (fx === 2 && fy === 1)) put(x, y, colors.light, 0.7);
          } else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
            put(x, y, colors.ink);
          }
        }
      }
      ctx.globalAlpha = 1;
    },
    TICK_MS,
    country,
  );
  const name = country ? countryName(country) : null;
  return (
    <canvas
      ref={canvas}
      width={W}
      height={H}
      role="img"
      aria-label={name ? `${name} flag` : "Flag"}
      title={name ?? undefined}
      className={className ? `ts-flag ${className}` : "ts-flag"}
      style={{ width: W * scale, height: H * scale }}
    />
  );
}
