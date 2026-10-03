import { describe, expect, it } from "vitest";

import { openArea, openAreaAround, type Rect } from "./free-area";

const under = (...rects: Rect[]) => (x: number, y: number) => rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);

describe("openArea", () => {
  it("is the whole box with nothing over it", () => {
    expect(openArea(960, 720, under())).toEqual({ x: 0, y: 0, w: 960, h: 720 });
  });

  it("goes beside a tall panel on the left, below the nav bar, with a cell's gap", () => {
    const nav = { x: 0, y: 0, w: 960, h: 72 };
    const ticket = { x: 24, y: 96, w: 432, h: 600 };
    expect(openArea(960, 720, under(nav, ticket))).toEqual({ x: 480, y: 96, w: 480, h: 624 });
  });

  it("goes below a short panel when that leaves more room", () => {
    const ticket = { x: 24, y: 24, w: 600, h: 240 };
    expect(openArea(720, 960, under(ticket))).toEqual({ x: 0, y: 288, w: 720, h: 672 });
  });

  it("gives up when the page covers nearly everything", () => {
    expect(openArea(960, 720, under({ x: 0, y: 0, w: 900, h: 720 }))).toBeNull();
  });
});


describe("registered obstruction geometry", () => {
  it("matches sampled panel coverage without DOM hit testing", () => {
    const panels = [{ x: 24, y: 96, w: 432, h: 600 }, { x: 0, y: 0, w: 960, h: 72 }];
    expect(openAreaAround(960, 720, panels)).toEqual(openArea(960, 720, under(...panels)));
    expect(openAreaAround(960, 720, [])).toEqual({ x: 0, y: 0, w: 960, h: 720 });
  });
});
