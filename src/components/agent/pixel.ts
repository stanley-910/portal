"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// Pip's pixel assets and the one way they're drawn. Each asset is a grid of letters plus a `paint` that turns a
// letter into a palette colour; frames are functions of a tick, so an animation is "which asset, where, at which
// tick". Colours come from the Pip tokens at draw time, so themes work and nothing is hard-coded. Every asset gets
// the same 1-cell sticker outline. Scenes draw on a canvas in cells and are scaled up with pixelated rendering.

export type Colors = Record<"body" | "shade" | "ink" | "light" | "cheek" | "hull" | "under", string>;
type Key = keyof Colors;

export type Asset = {
  grid: string[][];
  /** The colour for one cell; null leaves it clear but still outlined, like the gaps in the UFO's glass. */
  paint: (c: string, x: number, y: number) => Key | null;
  /** Lone cells outside the grid, drawn without an outline: glints. */
  extras?: [x: number, y: number, key: Key][];
  /** False for light, like the beam, which has no sticker edge. */
  outline?: boolean;
};

export function readColors(el: Element): Colors {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    body: v("--pip-body"), shade: v("--pip-shade"), ink: v("--sticker-ink"), light: v("--star-light"), cheek: v("--pip-cheek"),
    hull: v("--sticker-fill"), under: v("--star-edge"),
  };
}

/**
 * Draws an asset with its top-left at cell (ox, oy). `rows` draws only that many rows from the top, for things
 * appearing a line at a time; `from` skips rows above it, to draw a front half over something.
 */
export function drawAsset(ctx: CanvasRenderingContext2D, colors: Colors, asset: Asset, ox: number, oy: number, rows = Infinity, from = 0) {
  const g = asset.grid;
  const h = Math.min(g.length, rows);
  const filled = (x: number, y: number) => y >= from && y < h && x >= 0 && x < g[y].length && g[y][x] !== ".";
  const put = (x: number, y: number, key: Key) => {
    ctx.fillStyle = colors[key];
    ctx.fillRect(ox + x, oy + y, 1, 1);
  };
  for (let y = from - 1; y <= (asset.outline === false ? -2 : h); y++) {
    for (let x = -1; x <= (g[0]?.length ?? 0); x++) {
      if (filled(x, y)) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) put(x, y, "ink");
    }
  }
  for (let y = from; y < h; y++) {
    for (let x = 0; x < g[y].length; x++) {
      if (g[y][x] === ".") continue;
      const key = asset.paint(g[y][x], x, y);
      if (key) put(x, y, key);
    }
  }
  for (const [x, y, key] of asset.extras ?? []) put(x, y, key);
}

/**
 * Runs a pixel canvas: draws at tick 0, then every `tickMs`, re-reading the theme every few seconds. Under reduced
 * motion it draws one still frame. A new `restart` value starts again from tick 0.
 */
export function usePixelCanvas(
  canvas: RefObject<HTMLCanvasElement | null>,
  draw: (ctx: CanvasRenderingContext2D, colors: Colors, tick: number, still: boolean) => void,
  tickMs: number,
  restart: unknown = null,
) {
  const latest = useRef(draw);
  useLayoutEffect(() => {
    latest.current = draw;
  });
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let colors = readColors(el);
    let tick = 0;
    const frame = () => {
      ctx.clearRect(0, 0, el.width, el.height);
      latest.current(ctx, colors, tick, still);
    };
    frame();
    if (still) return;
    const timer = window.setInterval(() => {
      tick++;
      if (tick % 25 === 0) colors = readColors(el);
      frame();
    }, tickMs);
    return () => window.clearInterval(timer);
  }, [canvas, tickMs, restart]);
}

// —— Pip: a 16×16 alien on green sticker paper (handoff §1) ——

export type PipMood = "idle" | "think" | "talk";

// . empty · B body · S shade · H hand · O eye · W shine · K cheek · M mouth · A bobble · T stalk
const PIP = [
  ".AA..........AA.",
  ".AA..........AA.",
  "...T........T...",
  "....T......T....",
  ".....BBBBBB.....",
  "...BBBBBBBBBB...",
  "..BBBBBBBBBBBB..",
  ".BBOOBBBBBBOOBB.",
  ".BOWWOBBBBWWOOB.",
  ".BOOOOBBBBOOOOB.",
  ".BBOOBBBBBBOOBB.",
  ".BKKBBMBBMBBKKB.",
  "..BBBBBMMBBBBB..",
  "....BBBBBBBB....",
  "....HSSSSSSH....",
  ".....SS..SS.....",
];

/** Pip's bob for a tick: 0 or 1 cell up. */
export const pipBob = (mood: PipMood, tick: number) => Math.floor(tick / (mood === "talk" ? 2 : 5)) % 2;

/** Pip at a tick: blinks, looks up when thinking, talks, wiggles its antennae and glints. */
export function pip(mood: PipMood, tick: number): Asset {
  const g = PIP.map((row) => row.split(""));
  const beat = pipBob(mood, tick);
  if (tick % 34 < 2) {
    // blink: only the eyes' bottom row stays
    for (const y of [7, 8, 9]) for (let x = 0; x < 16; x++) if (g[y][x] === "O" || g[y][x] === "W") g[y][x] = "B";
  } else if (mood === "think") {
    // looking up: the shine moves to the top of each eye
    for (let x = 0; x < 16; x++) {
      if (g[8][x] === "W") g[8][x] = "O";
      if (g[7][x] === "O") g[7][x] = "W";
    }
  }
  if (mood === "talk" && beat) {
    g[11][6] = g[11][9] = "B";
    g[11][7] = g[11][8] = g[12][7] = g[12][8] = "M";
  }
  if (mood !== "idle" && beat) {
    // antennae wiggle 1px outward
    for (const y of [0, 1]) g[y] = ["A", "A", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", "A", "A"];
  }
  return {
    grid: g,
    paint: (c, x, y) => {
      if (c === "B") return (x - 7.5) * 0.6 + (y - 9) * 0.8 > 4.4 && (x + y) % 2 === 0 ? "shade" : "body";
      return ({ S: "shade", H: "shade", T: "shade", O: "ink", M: "ink", W: "light", A: "light", K: "cheek" } as const)[c as "S"] ?? null;
    },
    // the bobbles glow every fourth beat
    extras: Math.floor(tick / 5) % 4 === 0 ? [[1, -1, "light"], [14, -1, "light"]] : [],
  };
}

// —— The UFO: Pip's saucer, Pip in the dome ——

// . empty · G glass · A antenna · P Pip · O eye · K cheek · H hull · L rim light · U underside
const UFO = [
  ".....GGGGGGGG.....",
  "....GGAGGGGAGG....",
  "....GPPPPPPPPG....",
  "....GPOPPPPOPG....",
  "...GGPKPPPPKPGG...",
  "..HHHHHHHHHHHHHH..",
  ".HHHHHHHHHHHHHHHH.",
  "LHHLHHLHHLHHLHHLHL",
  ".UUUUUUUUUUUUUUUU.",
  "....UUUUUUUUUU....",
];
export const UFO_SIZE = { w: 18, h: 10 };
const LIGHTS = [...UFO[7]].flatMap((c, x) => (c === "L" ? [x] : []));

/**
 * The saucer at a tick: the rim lights chase round so it reads as spinning, and Pip's eyes follow them. `empty`
 * leaves the dome without Pip, once it has beamed down.
 */
export function ufo(tick: number, { empty = false } = {}): Asset {
  const g = UFO.map((row) => row.split(""));
  const look = [-1, 0, 1, 0][Math.floor(tick / 3) % 4];
  for (const x of [6, 11]) {
    g[3][x] = "P";
    g[3][x + look] = "O";
  }
  return {
    grid: g,
    paint: (c, x, y) => {
      if (c === "L") return (LIGHTS.indexOf(x) - tick) % 3 === 0 ? "light" : "shade";
      // glass is a checker of light over whatever's behind it
      if (c === "G" || (empty && "APOK".includes(c))) return (x + y) % 2 ? null : "light";
      return ({ A: "shade", P: "body", O: "ink", K: "cheek", H: "hull", U: "under" } as const)[c as "A"] ?? null;
    },
  };
}

/** The tractor beam under the saucer: a widening dithered cone `height` cells tall, shimmering with the tick. */
export function beam(height: number, tick: number): Asset {
  const grid = Array.from({ length: Math.max(0, height) }, (_, y) => {
    const half = 4 + Math.floor((y * 5) / Math.max(1, height));
    return Array.from({ length: 18 }, (_, x) => (Math.abs(x - 8.5) < half ? "Y" : "."));
  });
  return { grid, paint: (_, x, y) => ((x + y + tick) % 2 ? "light" : null), outline: false };
}

// —— The portal: a flat pixel ring on the ground that Pip drops into and pops out of ——

/** Its full size in cells. */
export const PORTAL_SIZE = { w: 22, h: 6 };

/**
 * The portal `open` (0 to 1) of the way, at a tick: a starlight rim around a dark well whose sparks swirl. Flat on
 * the ground, so it's much wider than tall.
 */
export function portal(open: number, tick: number): Asset {
  const w = 2 * Math.max(1, Math.round((PORTAL_SIZE.w / 2) * open));
  const h = 2 * Math.max(1, Math.round((PORTAL_SIZE.h / 2) * open));
  const grid = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      const dx = (x + 0.5 - w / 2) / (w / 2);
      const dy = (y + 0.5 - h / 2) / (h / 2);
      const d = dx * dx + dy * dy;
      return d > 1 ? "." : d > 0.5 ? "R" : "V";
    }),
  );
  return {
    grid,
    paint: (c, x, y) => {
      if (c === "R") return (x + tick) % 4 === 0 ? "cheek" : "light";
      // the well: ink, with sparks that drift round
      return (x * 3 + y * 5 + tick) % 7 === 0 ? "body" : "ink";
    },
  };
}
