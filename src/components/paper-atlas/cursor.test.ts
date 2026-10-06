import { describe, expect, it } from "vitest";
import { cursorImageReach, cursorPullOutline, cursorUrl } from "./cursor";

/** A cursor image's size and hotspot. */
function image(url: string) {
  const svg = decodeURIComponent(/url\("data:image\/svg\+xml,(.*?)"\)/.exec(url)![1]);
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg)!;
  const [, x, y] = /"\) (\d+) (\d+), default$/.exec(url)!;
  return { width: +w, height: +h, hotspot: [+x, +y] };
}

describe("a cursor image", () => {
  it("fits in 32 px when it's plain, so it shows right up to the window's edge", () => {
    for (const shape of ["arrow", "compass", "map"] as const) {
      const { width, height, hotspot } = image(cursorUrl(shape, "member-1", "light"));
      expect(width).toBeLessThanOrEqual(32);
      expect(height).toBeLessThanOrEqual(32);
      expect(hotspot[0]).toBeLessThan(4);
      expect(hotspot[1]).toBeLessThan(4);
    }
  });

  it("is cut to fit what it draws once it lies, carries a ring, is offset or is pulled", () => {
    const big = (url: string) => Math.max(image(url).width, image(url).height) > 32;
    expect(big(cursorUrl("arrow", "member-1", "light", { marker: { angle: 0, squash: 1 }, lie: { angle: 0, squash: 0.6 }, noShadow: true }))).toBe(false);
    expect(big(cursorUrl("arrow", "member-1", "light", { pull: { angle: 90, gap: 20, flat: 0.4 }, noShadow: true }))).toBe(true);
    // the image reaches as far from the pointer as it says
    const pull = { angle: 0, gap: 20, flat: 0.4 };
    const { width, hotspot } = image(cursorUrl("arrow", "member-1", "light", { pull, noShadow: true }));
    const reach = cursorImageReach("arrow", { pull, noShadow: true });
    expect(hotspot[0]).toBe(reach.left);
    expect(width - hotspot[0]).toBe(reach.right);
  });

  it("pulled one way, reaches far that way but hardly the other, so it shows close to the window's edge", () => {
    // pulled off the right side of the globe it's held back to the left of the pointer
    const right = cursorImageReach("arrow", { pull: { angle: 0, gap: 20, flat: 0.4 }, noShadow: true });
    expect(right.left).toBeGreaterThan(20);
    expect(right.right).toBeLessThan(20);
    const left = cursorImageReach("arrow", { pull: { angle: 180, gap: 20, flat: 0.4 }, noShadow: true });
    expect(left.right).toBeGreaterThan(20);
    expect(left.left).toBeLessThan(6);
  });
});

/** The outline's points, and its extent along x and y. */
function bounds(d: string) {
  const n = d.match(/-?\d*\.?\d+/g)!.map(Number);
  const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
  return { xs, ys, top: Math.min(...ys), bottom: Math.max(...ys) };
}

/** An outline measured along a pull `angle` degrees clockwise: its near and far ends, and how wide its last quarter is. */
function along(d: string, angle: number) {
  const { xs, ys } = bounds(d);
  const a = (angle * Math.PI) / 180;
  const t = xs.map((x, i) => x * Math.cos(a) + ys[i] * Math.sin(a));
  const c = xs.map((x, i) => -x * Math.sin(a) + ys[i] * Math.cos(a));
  const near = Math.min(...t), far = Math.max(...t);
  const end = c.filter((_, i) => t[i] >= far - (far - near) / 4);
  return { near, far, end: Math.max(...end) - Math.min(...end) };
}

const SHAPES = ["arrow", "compass", "map"] as const;
const WAYS = [0, 90, 180, 270];

describe("a cursor pulled like taffy", () => {
  it("lies as it was with no pull", () => {
    const { top, bottom } = bounds(cursorPullOutline("arrow", { angle: 90, gap: 0, flat: 1 }));
    expect(top).toBeCloseTo(0);
    expect(bottom).toBeCloseTo(21);
    // still squashed along the pull as it lay on the surface
    expect(bounds(cursorPullOutline("arrow", { angle: 90, gap: 0, flat: 0.4 })).bottom).toBeCloseTo(21 * 0.4);
  });

  it("is pulled the same way whichever way it goes: stuck where it lay, its leading end out beside the pointer", () => {
    for (const shape of SHAPES) {
      for (const angle of WAYS) {
        const lay = along(cursorPullOutline(shape, { angle, gap: 0, flat: 0.4 }), angle);
        const upright = along(cursorPullOutline(shape, { angle, gap: 0, flat: 1 }), angle);
        const pulled = along(cursorPullOutline(shape, { angle, gap: 20, flat: 0.4 }), angle);
        // its end nearest the surface hasn't moved from where it lay, 20 px back from the pointer
        expect(pulled.near).toBeCloseTo(lay.near - 20, 0);
        // its leading end is back beside the pointer, risen part of the way from lying flat
        expect(pulled.far).toBeGreaterThanOrEqual(lay.far - 0.5);
        expect(pulled.far).toBeLessThanOrEqual(upright.far + 0.5);
      }
    }
  });

  it("draws its leading end out thin", () => {
    for (const angle of WAYS) {
      const upright = along(cursorPullOutline("arrow", { angle, gap: 0, flat: 1 }), angle);
      const pulled = along(cursorPullOutline("arrow", { angle, gap: 20, flat: 1 }), angle);
      expect(pulled.end).toBeLessThan(upright.end * 0.6);
    }
  });

  it("bunches up as it springs back past the pointer", () => {
    const upright = along(cursorPullOutline("arrow", { angle: 90, gap: 0, flat: 1 }), 90);
    const past = along(cursorPullOutline("arrow", { angle: 90, gap: -4, flat: 1 }), 90);
    expect(past.near).toBeCloseTo(upright.near + 4, 0);
    expect(past.end).toBeGreaterThanOrEqual(upright.end);
  });
});
