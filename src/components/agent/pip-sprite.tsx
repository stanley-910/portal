"use client";

import { useRef } from "react";

import { getAway, PORTAL_MS, usePipAway } from "@/components/agent/pip-away";
import { drawAsset, pip, pipBob, portal, PORTAL_SIZE, ufo, UFO_SIZE, usePixelCanvas, type PipMood } from "@/components/agent/pixel";

// Pip and its saucer as standalone sprites. The art is in pixel.ts; these just place it on a small canvas with
// room for the outline and the bob.

export type { PipMood };

const PAD = 2;
const PIP_CELLS = 16 + 2 * PAD;
// with its portal: wide enough for the ring, which spills past Pip's cells on both sides without moving the layout
const PORTAL_CELLS = PORTAL_SIZE.w + 2;
const SIDE = (PORTAL_CELLS - PIP_CELLS) / 2;

// the portal's timeline, in ms: it opens, then Pip sinks into it; Pip rises out, then it closes
const OPEN_MS = 260;
const SINK_MS = 800;
const RISE_MS = 520;

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const span = (t: number, from: number, to: number) => clamp((t - from) / (to - from));
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeIn = (p: number) => p ** 3;

/**
 * Pip. With `portal`, this is Pip at its spot: when its saucer goes out over the globe (pip-away.ts) it drops through
 * a portal that stays open, and rises back out once the saucer is gone.
 */
export function PipSprite({ size, mood = "idle", className, portal: withPortal = false }: { size: number; mood?: PipMood; className?: string; portal?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const x = withPortal ? PAD + SIDE : PAD;
  // the portal runs at a quick tick; Pip at home keeps its own easy pace
  const portalOut = usePipAway().phase !== "home" && withPortal;
  usePixelCanvas(canvas, (ctx, colors, tick, still) => {
    const away = withPortal && !still ? getAway() : null;
    if (away && away.phase !== "home") {
      const t = Math.min(performance.now() - away.since, PORTAL_MS);
      const open = away.phase === "leaving" ? easeOut(span(t, 0, OPEN_MS)) : away.phase === "returning" ? 1 - easeIn(span(t, RISE_MS, PORTAL_MS)) : 1;
      // how many of Pip's 16 rows are through the portal
      const sunk = away.phase === "leaving" ? 16 * easeIn(span(t, OPEN_MS, SINK_MS)) : away.phase === "returning" ? 16 * (1 - easeOut(span(t, 0, RISE_MS))) : 16;
      const ring = portal(open, tick);
      const rx = x + 8 - ring.grid[0].length / 2;
      const ry = PAD + 14 - ring.grid.length / 2;
      drawAsset(ctx, colors, ring, rx, ry);
      const below = Math.round(sunk);
      if (below < 16) drawAsset(ctx, colors, pip("idle", tick), x, PAD + below, 16 - below);
      // the ring's front lip over Pip's middle
      drawAsset(ctx, colors, ring, rx, ry, Infinity, ring.grid.length / 2);
      return;
    }
    if (still) return drawAsset(ctx, colors, { ...pip(mood, 3), extras: [] }, x, PAD);
    drawAsset(ctx, colors, pip(mood, tick), x, PAD - pipBob(mood, tick));
  }, portalOut ? 40 : 120, mood);
  const cells = withPortal ? PORTAL_CELLS : PIP_CELLS;
  const cell = size / PIP_CELLS;
  return (
    <canvas
      ref={canvas}
      width={cells}
      height={PIP_CELLS}
      aria-hidden
      className={`pip-sprite ${className ?? ""}`}
      style={{ width: cells * cell, height: size, marginInline: withPortal ? -SIDE * cell : undefined }}
    />
  );
}

/** Pip thinking: the saucer spins its lights and bobs. */
export function PipUfo({ size, label = "Pip is thinking" }: { size: number; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  usePixelCanvas(canvas, (ctx, colors, tick, still) => {
    drawAsset(ctx, colors, ufo(still ? 0 : tick), PAD, PAD - (still ? 0 : Math.floor(tick / 4) % 2));
  }, 110);
  const w = UFO_SIZE.w + 2 * PAD;
  const h = UFO_SIZE.h + 2 * PAD;
  return (
    <canvas ref={canvas} width={w} height={h} role="img" aria-label={label} className="pip-sprite" style={{ width: size, height: (size * h) / w }} />
  );
}
