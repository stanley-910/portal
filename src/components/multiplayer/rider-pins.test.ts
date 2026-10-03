import { describe, expect, it } from "vitest";

import { arrivals, riderPins } from "./rider-pins";

const stop = (id: string) => ({ id, lat: 0, lng: 0, hub: null, name: id });

describe("arrivals", () => {
  it("gathers everyone travelling to a stop, once each, in drawing order", () => {
    const list = arrivals([
      { to: stop("sha"), riders: ["mei", "ada"] },
      { to: stop("sha"), riders: ["joon", "mei"] },
      { to: stop("tyo"), riders: ["sam"] },
    ]);
    expect(list.map((a) => [a.stop.id, a.riders])).toEqual([
      ["sha", ["mei", "ada", "joon"]],
      ["tyo", ["sam"]],
    ]);
  });

  it("leaves out a stop nobody rides to", () => {
    expect(arrivals([{ to: stop("osa"), riders: [] }])).toEqual([]);
  });
});

describe("riderPins", () => {
  it("gives each rider a pin at each stop they arrive at, in their member colour slot", () => {
    const list = [{ stop: { ...stop("sha"), lat: 31, lng: 121 }, riders: ["mei", "ghost"] }];
    expect(riderPins(list, { mei: { color: 2 } })).toEqual([
      { key: "sha:mei", stop: "sha", at: { lat: 31, lng: 121 }, color: 1 },
      // someone no longer in the member list keeps a pin, in sticker paper
      { key: "sha:ghost", stop: "sha", at: { lat: 31, lng: 121 }, color: null },
    ]);
  });
});
