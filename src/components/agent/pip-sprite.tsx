"use client";

import { useEffect, useRef } from "react";

// Pip, the agent: a 16×16 pixel alien on green sticker paper (handoff §1). Drawn on a 20×20 canvas, 2px of padding
// for the outline and the bob, and scaled up with pixelated rendering.

export type PipMood = "idle" | "think" | "talk";

// . empty · B body · S shade · H hand · O eye · W shine · K cheek · M mouth · A bobble · T stalk
const FRAME = [
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

const CELLS = 20;
const PAD = 2;
const TICK_MS = 120;

type Palette = Record<"body" | "shade" | "ink" | "light" | "cheek" | "glow", string>;

function palette(el: Element): Palette {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { body: v("--pip-body"), shade: v("--pip-shade"), ink: v("--sticker-ink"), light: v("--star-light"), cheek: v("--pip-cheek"), glow: v("--star-light") };
}

function grid(mood: PipMood, tick: number): string[][] {
  const g = FRAME.map((row) => row.split(""));
  const beat = Math.floor(tick / (mood === "talk" ? 2 : 5)) % 2;
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
    for (const y of [0, 1]) {
      g[y] = ["A", "A", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", "A", "A"];
    }
  }
  return g;
}

function draw(ctx: CanvasRenderingContext2D, colors: Palette, mood: PipMood, tick: number, still: boolean) {
  ctx.clearRect(0, 0, CELLS, CELLS);
  const g = grid(mood, still ? 3 : tick);
  const bob = still ? 0 : Math.floor(tick / (mood === "talk" ? 2 : 5)) % 2;
  const filled = (x: number, y: number) => y >= 0 && y < 16 && x >= 0 && x < 16 && g[y][x] !== ".";
  const put = (x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + PAD, y + PAD - bob, 1, 1);
  };
  // outline: every empty cell beside a filled one
  for (let y = -1; y <= 16; y++) {
    for (let x = -1; x <= 16; x++) {
      if (filled(x, y)) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) put(x, y, colors.ink);
    }
  }
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const c = g[y][x];
      if (c === ".") continue;
      const shaded = c === "B" && (x - 7.5) * 0.6 + (y - 9) * 0.8 > 4.4 && (x + y) % 2 === 0;
      const color = {
        B: shaded ? colors.shade : colors.body, S: colors.shade, H: colors.shade, T: colors.shade,
        O: colors.ink, M: colors.ink, W: colors.light, A: colors.light, K: colors.cheek,
      }[c];
      if (color) put(x, y, color);
    }
  }
  // bobble glow every 4th beat
  if (!still && Math.floor(tick / 5) % 4 === 0) {
    put(1, -1, colors.glow);
    put(14, -1, colors.glow);
  }
}

export function PipSprite({ size, mood = "idle", className }: { size: number; mood?: PipMood; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let colors = palette(el);
    let tick = 0;
    draw(ctx, colors, mood, tick, still);
    if (still) return;
    const timer = window.setInterval(() => {
      tick++;
      // the theme can change under us; re-read cheaply every few seconds
      if (tick % 25 === 0) colors = palette(el);
      draw(ctx, colors, mood, tick, false);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [mood]);

  return (
    <canvas
      ref={canvas}
      width={CELLS}
      height={CELLS}
      aria-hidden
      className={`pip-sprite ${className ?? ""}`}
      style={{ width: size, height: size }}
    />
  );
}
