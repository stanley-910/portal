"use client";

import { useRef } from "react";

import { drawAsset, pip, pipBob, ufo, UFO_SIZE, usePixelCanvas, type PipMood } from "@/components/agent/pixel";

// Pip and its saucer as standalone sprites. The art is in pixel.ts; these just place it on a small canvas with
// room for the outline and the bob.

export type { PipMood };

const PAD = 2;
const PIP_CELLS = 16 + 2 * PAD;

export function PipSprite({ size, mood = "idle", className }: { size: number; mood?: PipMood; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  usePixelCanvas(canvas, (ctx, colors, tick, still) => {
    if (still) return drawAsset(ctx, colors, { ...pip(mood, 3), extras: [] }, PAD, PAD);
    drawAsset(ctx, colors, pip(mood, tick), PAD, PAD - pipBob(mood, tick));
  }, 120, mood);
  return (
    <canvas
      ref={canvas}
      width={PIP_CELLS}
      height={PIP_CELLS}
      aria-hidden
      className={`pip-sprite ${className ?? ""}`}
      style={{ width: size, height: size }}
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
