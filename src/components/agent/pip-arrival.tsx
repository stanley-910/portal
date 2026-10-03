"use client";

import { useRef } from "react";

import { beam, drawAsset, pip, pipBob, ufo, UFO_SIZE, usePixelCanvas } from "@/components/agent/pixel";

// Pip arriving on page load: its saucer swoops into the corner, beams Pip down onto the launcher's spot, and zips
// off. Drawn over the launcher, cell for cell where the launcher's sprite sits, so the hand-off is seamless.

/** Once per page load: closing the chat or moving between panels doesn't replay it. */
export const arrival = { played: false };

const TICK_MS = 40;
/** Cells; one cell is 2px, the launcher sprite's scale. */
const W = 120;
const H = 112;
const SCALE = 2;
/** How far the stage runs past the launcher's right edge, beyond the screen's (the launcher is 32px in), so the
 * saucer comes and goes from off-screen instead of popping in mid-air. */
const OVERHANG = 24;
// Pip's grid on the launcher: the sprite's 20-cell canvas sits 1 cell in from the corner, Pip 2 cells inside that
const LAND = { x: W - OVERHANG - 19, y: H - 19 };
const HOVER = { x: LAND.x - 1, y: LAND.y - 40 };
const FROM = { x: W, y: HOVER.y - 30 };
const AWAY = { x: W, y: -UFO_SIZE.h - 2 };

// the timeline, in ms
const FLY_END = 720;
const BEAM_END = 880;
const DROP_END = 1440;
const BEAM_OFF = 1600;
export const ARRIVAL_MS = 2080;

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const span = (t: number, from: number, to: number) => clamp((t - from) / (to - from));
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeIn = (p: number) => p ** 3;
const easeInOut = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
const mix = (a: number, b: number, p: number) => Math.round(a + (b - a) * p);

export function PipArrival() {
  const canvas = useRef<HTMLCanvasElement>(null);
  usePixelCanvas(canvas, (ctx, colors, tick, still) => {
    if (still) return;
    const t = tick * TICK_MS;
    if (t >= ARRIVAL_MS) return;

    // the saucer: swoops in from off-screen right, dipping as it slows, hovers, then zips off up and right
    const p = span(t, 0, FLY_END);
    const flyOut = easeIn(span(t, BEAM_OFF, ARRIVAL_MS));
    const wobble = t < BEAM_OFF ? Math.round(Math.sin(t / 90) * (1 - p) * 3) + (Math.floor(tick / 4) % 2) : 0;
    const sx = flyOut ? mix(HOVER.x, AWAY.x, flyOut) : mix(FROM.x, HOVER.x, easeOut(p));
    const sy = (flyOut ? mix(HOVER.y, AWAY.y, flyOut) : mix(FROM.y, HOVER.y, easeInOut(p))) - wobble;

    // the beam reaches the ground, holds while Pip drops, then pulls back up
    const top = HOVER.y + UFO_SIZE.h;
    const full = LAND.y + 16 - top;
    const reach = t < BEAM_END ? span(t, FLY_END, BEAM_END) : t < DROP_END ? 1 : 1 - span(t, DROP_END, BEAM_OFF);
    if (t > FLY_END && reach > 0) drawAsset(ctx, colors, beam(Math.round(full * reach), tick), HOVER.x, top);

    // Pip: in the dome until the beam lands, then floats down onto the launcher's spot
    const dropping = t >= BEAM_END;
    if (dropping) {
      const p = easeInOut(span(t, BEAM_END, DROP_END));
      const y = mix(top - 6, LAND.y, p);
      const mood = p < 1 ? "think" : "idle";
      drawAsset(ctx, colors, pip(mood, tick), LAND.x, p < 1 ? y : y - pipBob(mood, tick), Math.ceil(16 * Math.min(1, 0.3 + p * 2)));
    }
    drawAsset(ctx, colors, ufo(tick, { empty: dropping }), sx, sy);
  }, TICK_MS);

  return (
    <canvas
      ref={canvas}
      width={W}
      height={H}
      aria-hidden
      className="pip-sprite pip-arrival"
      style={{ width: W * SCALE, height: H * SCALE, right: -OVERHANG * SCALE }}
    />
  );
}
