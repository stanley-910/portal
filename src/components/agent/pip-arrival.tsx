"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { beam, drawAsset, pip, pipBob, portal, ufo, UFO_SIZE, usePixelCanvas } from "@/components/agent/pixel";

// Pip arriving on page load: its saucer swoops into the corner, beams Pip down onto the launcher's spot, and zips
// off; or a portal opens in the corner and Pip rises out of it. Pip also hops between corners by portal. Each scene
// is drawn over the launcher, cell for cell where its sprite sits, so the hand-off is seamless.

/**
 * Once per page load: closing the chat or moving between panels doesn't replay it. `kind` is picked at random per
 * load: the saucer beams Pip down, or Pip rises out of a portal.
 */
export const arrival: { played: boolean; kind: "ufo" | "portal" | null } = { played: false, kind: null };

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

// —— Pip hopping corners by portal ——

export type PipSide = "right" | "left";

/** Which bottom corner Pip sits in, kept across the launcher and the chat panel mounting and unmounting. */
export const pipPlace: { side: PipSide } = { side: "right" };

const HOP_W = 40;
const HOP_H = 40;
// the launcher's sprite: its 20-cell canvas sits 1 cell in from the corner, Pip 2 cells inside that
const HOP_PIP = { right: { x: HOP_W - 19, y: HOP_H - 19 }, left: { x: 3, y: HOP_H - 19 } };
// portal opens, Pip sinks or rises, portal closes
const OPEN_END = 180;
const MOVE_END = 620;
export const HOP_MS = 800;

/**
 * A portal opens under Pip's spot in its corner and Pip drops through it (`leave`) or rises out of it (`arrive`),
 * then it closes. Drawn over the launcher's sprite, cell for cell.
 */
export function PipHop({ way, side }: { way: "leave" | "arrive"; side: PipSide }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  usePixelCanvas(canvas, (ctx, colors, tick, still) => {
    if (still) return;
    const t = tick * TICK_MS;
    if (t >= HOP_MS) return;
    const at = HOP_PIP[side];
    const open = t < OPEN_END ? easeOut(span(t, 0, OPEN_END)) : t < MOVE_END ? 1 : 1 - easeIn(span(t, MOVE_END, HOP_MS));
    const ring = portal(open, tick);
    const rx = at.x + 8 - ring.grid[0].length / 2;
    const ry = at.y + 15 - ring.grid.length / 2;
    drawAsset(ctx, colors, ring, rx, ry);
    // how many of Pip's 16 rows are below the ground, through the portal
    const p = span(t, OPEN_END, MOVE_END);
    const sunk = Math.round(16 * (way === "leave" ? easeIn(p) : 1 - easeOut(p)));
    if (sunk < 16) drawAsset(ctx, colors, pip("talk", tick), at.x, at.y + sunk, 16 - sunk);
    // the ring's front lip over Pip's middle
    drawAsset(ctx, colors, ring, rx, ry, Infinity, ring.grid.length / 2);
  }, TICK_MS);
  return (
    <canvas
      ref={canvas}
      width={HOP_W}
      height={HOP_H}
      aria-hidden
      className="pip-sprite pip-hop"
      style={{ width: HOP_W * SCALE, height: HOP_H * SCALE, [side]: 0 }}
    />
  );
}

/** Whether something other than the globe (a trip card, a panel) sits over Pip's spot in `side`'s corner. */
function cornerCovered(launcher: HTMLElement, porthole: HTMLElement, side: PipSide) {
  const box = (launcher.offsetParent ?? document.body).getBoundingClientRect();
  const r = porthole.getBoundingClientRect();
  // the porthole's spot in that corner, mirrored when it's the other one, with a margin
  const here = launcher.classList.contains("pip-launcher-left") ? "left" : "right";
  const left = side === here ? r.left : box.left + box.right - r.right;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const x = left - 12 + ((r.width + 24) * (i + 0.5)) / 4;
      const y = r.top - 12 + ((r.height + 24) * (j + 0.5)) / 4;
      const el = document.elementFromPoint(x, y);
      if (!el || launcher.contains(el) || el.closest("[data-globe-root]") || el.closest("nextjs-portal")) continue;
      return true;
    }
  }
  return false;
}

/** How often Pip checks its corner, and how many checks in a row decide a hop. */
const WATCH_MS = 400;
const HOP_AWAY = 2;
const HOP_BACK = 5;

/**
 * Keeps Pip out of the way: when something covers its corner and the other bottom corner is clear, it drops through
 * a portal and pops out there; once its home corner (bottom right) is clear again for a while, it hops back.
 * `paused` holds it still, say while it's arriving.
 */
export function usePipCorner(
  launcher: RefObject<HTMLElement | null>,
  porthole: RefObject<HTMLElement | null>,
  paused: boolean,
  /** "arrive" to start by rising out of a portal, as Pip does when the chat closes. */
  start: "arrive" | null = null,
) {
  const [side, setSide] = useState<PipSide>(pipPlace.side);
  const [hop, setHop] = useState<"leave" | "arrive" | null>(start);

  useEffect(() => {
    if (paused || hop) return;
    let away = 0;
    let back = 0;
    const other: PipSide = side === "right" ? "left" : "right";
    const timer = window.setInterval(() => {
      const l = launcher.current;
      const p = porthole.current;
      if (!l || !p) return;
      const blocked = cornerCovered(l, p, side);
      away = blocked && !cornerCovered(l, p, other) ? away + 1 : 0;
      back = !blocked && side === "left" && !cornerCovered(l, p, "right") ? back + 1 : 0;
      if (away >= HOP_AWAY || back >= HOP_BACK) setHop("leave");
    }, WATCH_MS);
    return () => window.clearInterval(timer);
  }, [launcher, porthole, paused, hop, side]);

  useEffect(() => {
    if (!hop) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => {
      if (hop === "arrive") return setHop(null);
      const next: PipSide = side === "right" ? "left" : "right";
      pipPlace.side = next;
      setSide(next);
      setHop(still ? null : "arrive");
    }, still ? 0 : HOP_MS);
    return () => window.clearTimeout(timer);
  }, [hop, side]);

  return { side, hop };
}
